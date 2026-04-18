import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getPipelineConfig, runPipelineText } from '../_shared/ai-pipeline.ts';
import { recordLedgerSync } from '../_shared/hardline-ledger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isLinkedInUrl(url: string): boolean {
  try { return new URL(url).hostname.includes('linkedin.com'); } catch { return false; }
}

function unwrapLinkedInSafetyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isSafetyRedirect =
      parsed.hostname.includes('linkedin.com') &&
      parsed.pathname.includes('/safety/go');

    if (!isSafetyRedirect) return url;

    const target = parsed.searchParams.get('url');
    if (!target) return url;

    const decoded = decodeURIComponent(target);
    return decoded.startsWith('http://') || decoded.startsWith('https://')
      ? decoded
      : `https://${decoded}`;
  } catch {
    return url;
  }
}

import { 
  extractLinkedInJobId as sharedExtractId, 
  fetchLinkedInJobHtml, 
  getLinkedInCookieHeader,
  enrichLinkedInJob, 
  normaliseJobFields,
  extractAllLinkedInJobIds,
  isLinkedInSearchUrl
} from '../_shared/linkedin-job.ts';
import { parseLinkedInJobCards } from '../_shared/linkedin-search.ts';
import { fetchLinkedInSearch } from '../_shared/linkedin-search.ts';
import { normalizeLinkedInJob } from '../_shared/linkedin-normalize.ts';

function extractLinkedInJobId(url: string): string | null {
  return sharedExtractId(url);
}

function markNormalizationStatus(job: any, evidenceLength: number) {
  const description = String(job?.description || '').trim();
  const valid = evidenceLength >= 200 && description.length >= 250;
  return { ...job, normalization_status: valid ? 'valid' : 'incomplete' };
}

function dedupeLinkedInJobs(jobs: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];

  for (const job of jobs) {
    const key =
      String(job?.linkedin_job_id || job?.external_id || job?.apply_url || job?.source_url || '')
        .trim()
        .toLowerCase() ||
      `${String(job?.title || '').trim().toLowerCase()}|${String(job?.company || '').trim().toLowerCase()}`;

    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }

  return out;
}

function deriveLinkedInSearchSeed(job: any): { keywords: string; location?: string } | null {
  const title = String(job?.title || '').trim();
  if (!title) return null;

  const location = String(job?.location || '').trim();
  return {
    keywords: title,
    location: location || undefined,
  };
}

function buildLinkedInSearchVariants(seed: { keywords: string; location?: string }): Array<{ keywords: string; location?: string }> {
  const variants: Array<{ keywords: string; location?: string }> = [{ keywords: seed.keywords, location: seed.location }];

  if (seed.location) {
    // Some LinkedIn collection pages expose broad region labels like EMEA,
    // which can overly constrain search. Retry the same keyword without the
    // location if the first pass is sparse.
    variants.push({ keywords: seed.keywords });
  }

  return variants;
}

async function expandLinkedInCollectionWithSearch(seedJobs: any[], userId: string, supabaseClient: any): Promise<any[]> {
  const expanded: any[] = [];
  const seeds = seedJobs.slice(0, 2);

  for (const seed of seeds) {
    const searchSeed = deriveLinkedInSearchSeed(seed);
    if (!searchSeed) continue;

    try {
      const variants = buildLinkedInSearchVariants(searchSeed);
      for (const variant of variants) {
        const snippets = await fetchLinkedInSearch({
          keywords: variant.keywords,
          location: variant.location,
          pageNum: 0,
          limit: 10,
          postedWithin: 'month',
        });

        const normalized = snippets.map((snippet) =>
          markNormalizationStatus(normalizeLinkedInJob(snippet), 1000)
        );

        if (normalized.length > 0) {
          try {
            await recordLedgerSync(supabaseClient as any, userId, 'linkedin-search-scrape', 'linkedin', normalized, {
              baseUrl: `search:${variant.keywords}|${variant.location || ''}`,
              configJson: { source: 'linkedin_collection_search_fallback', keywords: variant.keywords, location: variant.location || null },
              normalizationStatus: 'valid',
              runMode: 'collect',
            });
          } catch (ledgerError) {
            console.warn('Ledger sync failed for LinkedIn collection search fallback:', ledgerError);
          }
          expanded.push(...normalized);
        }

        // Stop early once we have enough supplemental LinkedIn jobs.
        if (expanded.length >= 6) break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('LinkedIn search fallback failed for collection seed:', searchSeed.keywords, msg);
    }
  }

  return dedupeLinkedInJobs(expanded);
}

/** Try LinkedIn's guest/public job posting endpoint */
async function fetchLinkedInJob(jobId: string): Promise<string> {
  return await fetchLinkedInJobHtml(jobId);
}

async function fetchLinkedInPageHtml(url: string): Promise<string> {
  const cookieHeader = getLinkedInCookieHeader();
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    },
  });
  if (!res.ok) throw new Error(`LinkedIn page fetch failed: ${res.status}`);
  return await res.text();
}



/** Fetch raw HTML from a URL and extract text */
async function fetchPageText(url: string): Promise<string> {
  const readerUrl = `https://r.jina.ai/http://${url}`;
  const hostname = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const preferReaderFirst = [
    'bayt.com',
    'gulftalent.com',
    'indeed.',
    'naukrigulf.com',
    'tanqeeb.com',
    'qatarliving.com',
    'akhtaboot.com',
    'glassdoor.com',
    'weworkremotely.com',
  ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`) || hostname.includes(domain));

  const toReadableText = (html: string) => html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 12000);

  const looksBlocked = (text: string) => /just a moment|access denied|captcha|verify you are human|blocked|enable javascript/i.test(text);

  const fetchDirect = async () => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      throw new Error(`Direct fetch failed with ${res.status}`);
    }
    const html = await res.text();
    const readable = toReadableText(html);
    if (readable.length < 200 || looksBlocked(readable)) {
      throw new Error('Direct fetch returned sparse or blocked content');
    }
    return readable;
  };

  const fetchReader = async () => {
    const readerRes = await fetch(readerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/plain, text/markdown, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!readerRes.ok) {
      throw new Error(`Reader fetch failed with ${readerRes.status}`);
    }
    const readerText = await readerRes.text();
    const readable = toReadableText(readerText);
    if (readable.length < 100) {
      throw new Error('Reader returned too little content');
    }
    return readable;
  };

  const attempts = preferReaderFirst
    ? [fetchReader, fetchDirect]
    : [fetchDirect, fetchReader];

  const attemptErrors: string[] = [];
  for (const attempt of attempts) {
    try {
      const text = await attempt();
      if (text.length >= 100) return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attemptErrors.push(message);
      console.warn(`Page text fetch attempt failed for ${url}: ${message}`);
    }
  }

  throw new Error(attemptErrors.length > 0 ? attemptErrors.join(' | ') : 'Could not fetch enough content from this page.');
}

/**
 * Shape returned from AI extraction — single job, multiple jobs, or listing page.
 * type === 'single'   → job field is populated
 * type === 'multiple' → jobs array is populated (each distinct role on the page)
 * type === 'listing'  → jobs array with individual URLs + total_count from page
 */
type ExtractionResult =
  | { type: 'single'; job: Record<string, unknown> }
  | { type: 'multiple'; jobs: Record<string, unknown>[] }
  | { type: 'listing'; jobs: Record<string, unknown>[]; total_count: number };

/** Normalise a raw extracted job object into a clean, consistently shaped record */
function normaliseJob(raw: Record<string, unknown>, fallbackUrl: string): Record<string, unknown> {
  return {
    title: raw.title || 'Untitled Job',
    company: raw.company || 'Unknown Company',
    location: raw.location || '',
    remote_type: raw.remote_type || 'unknown',
    description: raw.description || '',
    salary_min: raw.salary_min || null,
    salary_max: raw.salary_max || null,
    salary_currency: raw.salary_currency || null,
    employment_type: raw.employment_type || 'full-time',
    seniority_level: raw.seniority_level || '',
    requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
    apply_url: (raw.apply_url as string) || fallbackUrl,
    source_created_at: (raw.source_created_at as string | null) || null,
  };
}

function isMeaningfulText(value: unknown): boolean {
  return Boolean(String(value ?? '').trim());
}

async function persistHydratedJobRow(
  supabaseClient: any,
  userId: string,
  jobId: string,
  sourceUrl: string,
  hydratedJob: Record<string, unknown>,
) {
  const { data: existingJob, error: existingError } = await supabaseClient
    .from('jobs')
    .select('id, description, posted_at, raw_data, updated_at')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existingJob) {
    return null;
  }

  const existingRaw = (existingJob.raw_data as Record<string, unknown> | null) ?? {};
  const currentDescription = String(existingJob.description || '').trim();
  const currentPostedAt = String(existingJob.posted_at || '').trim();
  const hydratedDescription = isMeaningfulText(hydratedJob.description) ? String(hydratedJob.description).trim() : '';
  const hydratedPostedAt = isMeaningfulText(hydratedJob.source_created_at)
    ? String(hydratedJob.source_created_at).trim()
    : isMeaningfulText(hydratedJob.posted_at)
      ? String(hydratedJob.posted_at).trim()
      : '';

  const mergedHydration = {
    ...(existingRaw.hydration as Record<string, unknown> | undefined),
    status: 'hydrated',
    hydrated_at: new Date().toISOString(),
    source_url: sourceUrl,
    description_hydrated: Boolean(hydratedDescription),
    posted_at_hydrated: Boolean(hydratedPostedAt),
  };

  const updates: Record<string, unknown> = {
    raw_data: {
      ...existingRaw,
      hydration: mergedHydration,
      hydrated_job: hydratedJob,
    },
    updated_at: new Date().toISOString(),
  };

  if (!currentDescription && hydratedDescription) {
    updates.description = hydratedDescription;
  }

  if (!currentPostedAt && hydratedPostedAt) {
    updates.posted_at = hydratedPostedAt;
  }

  if (isMeaningfulText(hydratedJob.apply_url)) {
    updates.apply_url = String(hydratedJob.apply_url).trim();
  }

  if (isMeaningfulText(hydratedJob.source_url)) {
    updates.source_url = String(hydratedJob.source_url).trim();
  }

  if (isMeaningfulText(hydratedJob.title)) {
    updates.title = String(hydratedJob.title).trim();
  }

  if (isMeaningfulText(hydratedJob.company)) {
    updates.company = String(hydratedJob.company).trim();
  }

  if (isMeaningfulText(hydratedJob.location)) {
    updates.location = String(hydratedJob.location).trim();
  }

  if (isMeaningfulText(hydratedJob.remote_type)) {
    updates.remote_type = String(hydratedJob.remote_type).trim();
  }

  if (isMeaningfulText(hydratedJob.employment_type)) {
    updates.employment_type = String(hydratedJob.employment_type).trim();
  }

  if (isMeaningfulText(hydratedJob.seniority_level)) {
    updates.seniority_level = String(hydratedJob.seniority_level).trim();
  }

  if (Array.isArray(hydratedJob.requirements) && hydratedJob.requirements.length > 0) {
    updates.requirements = hydratedJob.requirements;
  }

  if (Array.isArray(hydratedJob.nice_to_haves) && hydratedJob.nice_to_haves.length > 0) {
    updates.nice_to_haves = hydratedJob.nice_to_haves;
  }

  if (hydratedJob.salary_min !== undefined && hydratedJob.salary_min !== null && hydratedJob.salary_min !== '') {
    updates.salary_min = Number(hydratedJob.salary_min);
  }

  if (hydratedJob.salary_max !== undefined && hydratedJob.salary_max !== null && hydratedJob.salary_max !== '') {
    updates.salary_max = Number(hydratedJob.salary_max);
  }

  if (isMeaningfulText(hydratedJob.salary_currency)) {
    updates.salary_currency = String(hydratedJob.salary_currency).trim();
  }

  if (!currentDescription && hydratedDescription) {
    updates.normalized = hydratedDescription.length >= 250;
  }

  const { error: updateError } = await supabaseClient
    .from('jobs')
    .update(updates)
    .eq('id', jobId)
    .eq('user_id', userId);

  if (updateError) {
    throw updateError;
  }

  return updates;
}

/** Use AI to extract structured job data from raw text.
 *  Returns a single job, multiple individual jobs, or a listing page with many job cards. */
async function extractJobWithAI(text: string, sourceUrl: string, userId: string): Promise<ExtractionResult> {
  const today = new Date().toISOString().split('T')[0];
  const prompt = `Analyse this web page content from: ${sourceUrl}
Today's date: ${today}

DETERMINE PAGE TYPE:
• SINGLE_JOB  — One specific role with complete description + requirements
• MULTI_JOB   — 2-10 complete, distinct job postings on one page (each has full description)
• LISTING_PAGE — A search-results or aggregator showing many job CARDS that each link to individual job pages
  (Signs: "N jobs found" / "N results", pagination, minimal card info, no full descriptions per entry)

Return ONLY valid JSON (no markdown, no explanation):

SINGLE_JOB  → {"type":"single","job":{fields}}
MULTI_JOB   → {"type":"multiple","jobs":[{fields},...]}
LISTING_PAGE → {"type":"listing","total_count":N,"jobs":[{fields},...]}
  where total_count = the total number shown on page (e.g. "487 Jobs" → 487)

Fields per job object:
{
  "title": string,
  "company": string,
  "location": string,
  "remote_type": "remote"|"hybrid"|"onsite"|"unknown",
  "description": string  // full text for SINGLE/MULTI; empty "" for LISTING cards
  "salary_min": number|null,
  "salary_max": number|null,
  "salary_currency": string|null,
  "employment_type": "full-time"|"part-time"|"contract"|"internship",
  "seniority_level": "Junior"|"Mid"|"Senior"|"Lead"|"Executive"|"",
  "requirements": string[]  // max 5 for SINGLE/MULTI; [] for LISTING cards
  "apply_url": string,     // individual job URL from the card link; fallback to "${sourceUrl}"
  "source_created_at": string|null  // ISO 8601; convert "3 days ago" using today's date; null if no date
}

For LISTING_PAGE: extract ALL visible job cards; find each card's link (href) and use as apply_url.

PAGE CONTENT:
${text}`;
  const config = await getPipelineConfig(userId);
  const { result: content, providerChain } = await runPipelineText({
    config,
    systemPrompt: 'You extract structured job data from web pages and return only valid JSON.',
    userPrompt: prompt,
    reviewInstruction: 'Return only valid JSON that matches the requested schema. Do not add markdown, commentary, or code fences.',
  });

  console.log(`AI extraction provider chain: ${providerChain.join(' -> ')}`);

  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!jsonMatch) {
    throw new Error('AI provider did not return valid JSON');
  }
  const parsed = JSON.parse(jsonMatch[0]);

  if (Array.isArray(parsed)) {
    const jobs = parsed.map((j: Record<string, unknown>) => normaliseJob(j, sourceUrl));
    console.log(`AI extraction: ${jobs.length} jobs (bare array)`);
    return jobs.length === 1 ? { type: 'single', job: jobs[0] } : { type: 'multiple', jobs };
  }
  if (parsed.type === 'listing' && Array.isArray(parsed.jobs)) {
    const jobs = parsed.jobs.map((j: Record<string, unknown>) => normaliseJob(j, sourceUrl));
    console.log(`AI extraction: ${jobs.length} listing cards (total on page: ${parsed.total_count})`);
    return { type: 'listing', jobs, total_count: Number(parsed.total_count) || jobs.length };
  }
  if (parsed.type === 'multiple' && Array.isArray(parsed.jobs)) {
    const jobs = parsed.jobs.map((j: Record<string, unknown>) => normaliseJob(j, sourceUrl));
    console.log(`AI extraction: ${jobs.length} jobs (multiple)`);
    return jobs.length === 1 ? { type: 'single', job: jobs[0] } : { type: 'multiple', jobs };
  }

  const rawJob = parsed.type === 'single' && parsed.job ? parsed.job as Record<string, unknown> : parsed as Record<string, unknown>;
  console.log('AI extraction: 1 job (single)');
  return { type: 'single', job: normaliseJob(rawJob, sourceUrl) };
}

/** Scrape a single LinkedIn job by ID, return structured job or null */
async function scrapeSingleLinkedInJob(jobId: string, userId: string): Promise<Record<string, unknown> | null> {
  try {
    const pageText = await fetchLinkedInJob(jobId);
    if (pageText.length < 200) {
      console.warn(`Job ${jobId}: insufficient content (${pageText.length} chars)`);
      return null;
    }
    const jobUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;
    const result = await extractJobWithAI(pageText, jobUrl, userId);
    // LinkedIn guest API always returns a single job page — take the first if multi detected
    const job = result.type === 'multiple'
      ? result.jobs[0]
      : ('job' in result ? result.job : null);
    return job ?? null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to scrape LinkedIn job ${jobId}:`, msg);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const authHeader = req.headers.get('Authorization');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    let userId: string;
    let supabaseClient: any;

    if (serviceRoleKey && bearerToken === serviceRoleKey) {
      userId = body?.user_id;
      if (!userId) {
        return new Response(JSON.stringify({ error: 'Missing user_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
    } else {
      supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    }

    const { url, manualDescription, job_id } = body;
    const debugMode = body?.debug === true;
    const hydratedJobId = isMeaningfulText(job_id) ? String(job_id).trim() : '';
    
    // Handle manual paste mode
    if (manualDescription) {
      console.log('Using manually pasted job description');
      const safeManualDescription = manualDescription.slice(0, 12000);
      const extracted = await extractJobWithAI(safeManualDescription, url || '', userId);
      if (extracted.type === 'multiple') {
        const jobs = extracted.jobs.map((job) => markNormalizationStatus({
          ...job,
          description: job.description || safeManualDescription.substring(0, 5000),
        }, safeManualDescription.length));
        try {
          await recordLedgerSync(supabaseClient as any, userId, 'manual-job-description', 'manual', jobs, {
            baseUrl: url || '',
            configJson: { source: 'manual_description' },
            normalizationStatus: safeManualDescription.length >= 250 ? 'valid' : 'incomplete',
            runMode: 'collect',
          });
        } catch (ledgerError) {
          console.warn('Ledger sync failed for manual description:', ledgerError);
        }
        return new Response(JSON.stringify({
          success: true,
          multiple: true,
          jobs,
          total_found: jobs.length,
          failed_count: 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const extractedJob = 'job' in extracted ? extracted.job : null;
      if (!extractedJob) {
        return new Response(JSON.stringify({
          success: false,
          error: 'EXTRACTION_FAILED',
          message: 'Could not extract structured data from the pasted description.',
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const job = markNormalizationStatus({
        ...extractedJob,
        description: extractedJob.description || safeManualDescription.substring(0, 5000),
      }, safeManualDescription.length);
      try {
        await recordLedgerSync(supabaseClient as any, userId, 'manual-job-description', 'manual', [job], {
          baseUrl: url || '',
          configJson: { source: 'manual_description' },
          normalizationStatus: safeManualDescription.length >= 250 ? 'valid' : 'incomplete',
          runMode: 'collect',
        });
      } catch (ledgerError) {
        console.warn('Ledger sync failed for manual description:', ledgerError);
      }
      return new Response(JSON.stringify({ success: true, job }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!url) {
      return new Response(JSON.stringify({ error: 'URL or description is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let formattedUrl = unwrapLinkedInSafetyUrl(url.trim());
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Scraping job URL:', formattedUrl);
    const isLinkedin = isLinkedInUrl(formattedUrl);
    let job: any;
    let extracted = false;

    // === LinkedIn Search/Collection URL: extract MULTIPLE jobs ===
    if (isLinkedin && isLinkedInSearchUrl(formattedUrl)) {
      try {
        const html = await fetchLinkedInPageHtml(formattedUrl);
        const cards = parseLinkedInJobCards(html);
        const jobs = cards.map((card) => markNormalizationStatus({
          title: card.title,
          company: card.company,
          location: card.location,
          apply_url: card.apply_url,
          source_url: formattedUrl,
          source_created_at: card.source_created_at_text || null,
          description: '',
          remote_type: 'unknown',
          employment_type: 'full-time',
          seniority_level: '',
          requirements: [],
          linkedin_job_id: card.linkedin_job_id,
          raw_data: card.raw_card_payload,
        }, html.length));

        let normalizedJobs = dedupeLinkedInJobs(jobs.map((job) => markNormalizationStatus(job, 1000)));

        if (normalizedJobs.length < 5) {
          const expandedJobs = await expandLinkedInCollectionWithSearch(normalizedJobs, userId, supabaseClient);
          if (expandedJobs.length > normalizedJobs.length) {
            normalizedJobs = dedupeLinkedInJobs([...normalizedJobs, ...expandedJobs]);
          }
        }

        if (normalizedJobs.length > 0) {
          try {
            await recordLedgerSync(supabaseClient as any, userId, 'linkedin-search-scrape', 'linkedin', normalizedJobs, {
              baseUrl: formattedUrl,
              configJson: { source: 'linkedin_search_url', fallback: normalizedJobs.length < 5 ? 'seed_job_search' : 'page_cards' },
              normalizationStatus: 'valid',
              runMode: 'collect',
            });
          } catch (ledgerError) {
            console.warn('Ledger sync failed for LinkedIn search URL:', ledgerError);
          }
          console.log(`Successfully extracted ${normalizedJobs.length} LinkedIn jobs from collection/search URL`);
          return new Response(JSON.stringify({
            success: true,
            multiple: true,
            jobs: normalizedJobs,
            total_found: normalizedJobs.length,
            failed_count: 0,
            ...(debugMode ? {
              debug: {
                source: 'collection_search_branch',
                initial_cards: jobs.length,
                final_jobs: normalizedJobs.length,
              },
            } : {}),
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('LinkedIn collection page fetch failed, falling back to URL job IDs:', msg);
      }

      const allJobIds = extractAllLinkedInJobIds(formattedUrl);
      console.log(`LinkedIn search URL fallback detected. Found ${allJobIds.length} job IDs:`, allJobIds);

      if (allJobIds.length > 0) {
        const jobs: any[] = [];
        const failedIds: string[] = [];

        for (const jobId of allJobIds) {
          const result = await scrapeSingleLinkedInJob(jobId, userId);
          if (result) {
            jobs.push(result);
            console.log(`✓ Job ${jobId}: ${result.title} at ${result.company}`);
          } else {
            failedIds.push(jobId);
          }
        }

        if (jobs.length > 0) {
          let normalizedJobs = dedupeLinkedInJobs(jobs.map((job) => markNormalizationStatus(job, 1000)));

          if (normalizedJobs.length < 5) {
            const expandedJobs = await expandLinkedInCollectionWithSearch(normalizedJobs, userId, supabaseClient);
            if (expandedJobs.length > normalizedJobs.length) {
              normalizedJobs = dedupeLinkedInJobs([...normalizedJobs, ...expandedJobs]);
            }
          }

          try {
            await recordLedgerSync(supabaseClient as any, userId, 'linkedin-search-scrape', 'linkedin', normalizedJobs, {
              baseUrl: formattedUrl,
              configJson: { source: 'linkedin_search_url', fallback: normalizedJobs.length < 5 ? 'seed_job_search' : 'url_job_ids' },
              normalizationStatus: 'valid',
              runMode: 'collect',
            });
          } catch (ledgerError) {
            console.warn('Ledger sync failed for LinkedIn search URL:', ledgerError);
          }
          console.log(`Successfully extracted ${normalizedJobs.length}/${allJobIds.length} jobs from LinkedIn search URL`);
          return new Response(JSON.stringify({
            success: true,
            multiple: true,
            jobs: normalizedJobs,
            total_found: Math.max(allJobIds.length, normalizedJobs.length),
            failed_count: failedIds.length,
            ...(debugMode ? {
              debug: {
                source: 'collection_url_id_branch',
                url_ids: allJobIds.length,
                final_jobs: normalizedJobs.length,
              },
            } : {}),
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'LINKEDIN_LOGIN_REQUIRED',
        message: 'Could not extract jobs from this LinkedIn page. Use the "Paste Description" tab to manually paste job details.',
        fallback: true,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === LinkedIn Single Job URL ===
    if (isLinkedin) {
      const jobId = extractLinkedInJobId(formattedUrl);
      if (jobId) {
        try {
          const pageText = await fetchLinkedInJob(jobId);
          if (pageText.length > 200) {
            const aiResult = await extractJobWithAI(pageText, formattedUrl, userId);
            // LinkedIn guest API is always a single job page — take first if multi was returned
            const aiJob = aiResult.type === 'multiple'
              ? aiResult.jobs[0]
              : ('job' in aiResult ? aiResult.job : null);
            if (aiJob) {
              job = markNormalizationStatus(aiJob, pageText.length);
              extracted = true;
              console.log('LinkedIn guest API + AI extracted:', job.title);
            }
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('LinkedIn guest API fallback failed:', msg);
        }
      }

      if (!extracted) {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'LINKEDIN_LOGIN_REQUIRED',
          message: 'This LinkedIn job requires login to view. Use the "Paste Description" tab to manually paste the job details.',
          fallback: true,
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // === Non-LinkedIn: try Firecrawl first ===
    if (!extracted) {
      const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (apiKey) {
        try {
          const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: formattedUrl,
              formats: ['markdown', {
                type: 'json',
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' }, company: { type: 'string' },
                    location: { type: 'string' }, remote_type: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'] },
                    description: { type: 'string' }, salary_min: { type: 'number' }, salary_max: { type: 'number' },
                    salary_currency: { type: 'string' }, employment_type: { type: 'string' }, seniority_level: { type: 'string' },
                    requirements: { type: 'array', items: { type: 'string' } }, apply_url: { type: 'string' },
                  },
                  required: ['title', 'company'],
                },
              }],
              onlyMainContent: true,
            }),
          });

          if (scrapeResponse.ok) {
            const scrapeData = await scrapeResponse.json();
            const md = scrapeData.data?.markdown || scrapeData.markdown || '';
            // Firecrawl may surface a publishedDate in metadata
            const firecrawlDate = scrapeData.data?.metadata?.publishedDate
              || scrapeData.data?.metadata?.datePublished
              || scrapeData.data?.metadata?.datePosted
              || null;

            // Always run through AI extraction on the full markdown so we can detect multiple jobs or listing pages.
            // The Firecrawl JSON schema result (ext) is only used as a seed title/company fallback.
            const ext = scrapeData.data?.json || scrapeData.json || {};
            const aiText = md.length >= 200 ? md.substring(0, 12000) : JSON.stringify(ext);
        const aiResult = await extractJobWithAI(aiText, formattedUrl, userId);

            if (aiResult.type === 'listing') {
              // Listing page with individual job URLs
              const jobs = aiResult.jobs.map(j => markNormalizationStatus({
                ...j,
                source_created_at: (j.source_created_at as string | null) || firecrawlDate || null,
              }, md.length));
              try {
          await recordLedgerSync(supabaseClient as any, userId, 'firecrawl-listing-scrape', 'search', jobs, {
                  baseUrl: formattedUrl,
                  configJson: { source: 'firecrawl_listing', url: formattedUrl, total_count: aiResult.total_count },
                  normalizationStatus: 'valid',
                  runMode: 'collect',
                });
              } catch (ledgerError) {
                console.warn('Ledger sync failed for Firecrawl listing scrape:', ledgerError);
              }
              console.log(`Firecrawl + AI extracted ${jobs.length} listing cards (total: ${aiResult.total_count})`);
              return new Response(JSON.stringify({
                success: true,
                multiple: true,
                listing: true,
                total_count: aiResult.total_count,
                jobs,
                total_found: jobs.length,
                failed_count: 0,
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            if (aiResult.type === 'multiple') {
              // Patch firecrawlDate onto any job that lacks source_created_at
              const jobs = aiResult.jobs.map(j => markNormalizationStatus({
                ...j,
                source_created_at: (j.source_created_at as string | null) || firecrawlDate || null,
              }, md.length));
              try {
          await recordLedgerSync(supabaseClient as any, userId, 'firecrawl-search-scrape', 'search', jobs, {
                  baseUrl: formattedUrl,
                  configJson: { source: 'firecrawl_scrape', url: formattedUrl },
                  normalizationStatus: 'valid',
                  runMode: 'collect',
                });
              } catch (ledgerError) {
                console.warn('Ledger sync failed for Firecrawl multi scrape:', ledgerError);
              }
              console.log(`Firecrawl + AI extracted ${jobs.length} jobs`);
              return new Response(JSON.stringify({
                success: true,
                multiple: true,
                jobs,
                total_found: jobs.length,
                failed_count: 0,
              }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            job = {
              ...aiResult.job,
              // Fall back to Firecrawl schema values if AI left these empty
              title: (aiResult.job.title as string) || ext.title || 'Untitled Job',
              company: (aiResult.job.company as string) || ext.company || 'Unknown Company',
              source_created_at: (aiResult.job.source_created_at as string | null) || firecrawlDate || null,
            };
            job = markNormalizationStatus(job, md.length);
            extracted = true;
            console.log('Firecrawl + AI extracted:', job.title);
          } else {
            console.warn('Firecrawl failed, trying direct fetch fallback');
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('Firecrawl error:', msg);
        }
      }
    }

    // === Final fallback: direct fetch + AI ===
    if (!extracted) {
      try {
        const pageText = await fetchPageText(formattedUrl);
        if (pageText.length < 100) {
          return new Response(JSON.stringify({ success: false, error: 'Could not fetch enough content from this page.', fallback: true }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const aiResult = await extractJobWithAI(pageText, formattedUrl, userId);
        if (aiResult.type === 'listing') {
          const jobs = aiResult.jobs.map((job) => markNormalizationStatus(job, pageText.length));
          try {
          await recordLedgerSync(supabaseClient as any, userId, 'direct-fetch-listing-scrape', 'web', jobs, {
              baseUrl: formattedUrl,
              configJson: { source: 'direct_fetch_listing', url: formattedUrl, total_count: aiResult.total_count },
              normalizationStatus: pageText.length >= 250 ? 'valid' : 'incomplete',
              runMode: 'collect',
            });
          } catch (ledgerError) {
            console.warn('Ledger sync failed for direct fetch listing scrape:', ledgerError);
          }
          console.log(`Direct fetch + AI extracted ${jobs.length} listing cards (total: ${aiResult.total_count})`);
          return new Response(JSON.stringify({
            success: true,
            multiple: true,
            listing: true,
            total_count: aiResult.total_count,
            jobs,
            total_found: jobs.length,
            failed_count: 0,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (aiResult.type === 'multiple') {
          const jobs = aiResult.jobs.map((job) => markNormalizationStatus(job, pageText.length));
          try {
          await recordLedgerSync(supabaseClient as any, userId, 'direct-fetch-scrape', 'web', jobs, {
              baseUrl: formattedUrl,
              configJson: { source: 'direct_fetch', url: formattedUrl },
              normalizationStatus: pageText.length >= 250 ? 'valid' : 'incomplete',
              runMode: 'collect',
            });
          } catch (ledgerError) {
            console.warn('Ledger sync failed for direct fetch multi scrape:', ledgerError);
          }
          console.log(`Direct fetch + AI extracted ${jobs.length} jobs`);
          return new Response(JSON.stringify({
            success: true,
            multiple: true,
            jobs,
            total_found: jobs.length,
            failed_count: 0,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        job = markNormalizationStatus(aiResult.job, pageText.length);
        extracted = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('All extraction methods failed:', msg);
        return new Response(JSON.stringify({ success: false, error: msg || 'Could not extract job data. Try using the "Paste Description" tab.', fallback: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (hydratedJobId && job) {
      try {
        await persistHydratedJobRow(supabaseClient as any, userId, hydratedJobId, formattedUrl, job);
      } catch (hydrationError) {
        const msg = hydrationError instanceof Error ? hydrationError.message : String(hydrationError);
        console.warn(`Failed to persist hydrated job ${hydratedJobId}:`, msg);
      }
    }

    try {
      await recordLedgerSync(supabaseClient as any, userId, 'single-job-scrape', isLinkedin ? 'linkedin' : 'web', [job], {
        baseUrl: formattedUrl,
        configJson: { source: 'single_job_scrape', url: formattedUrl },
        normalizationStatus: job.normalization_status || 'incomplete',
        runMode: 'collect',
      });
    } catch (ledgerError) {
      console.warn('Ledger sync failed for single scrape:', ledgerError);
    }

    return new Response(JSON.stringify({ success: true, job }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error:', err);
    const msg = err instanceof Error ? err.message : 'Failed to scrape';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
