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
  isLinkedInSearchUrl,
  buildLinkedInGuestSearchUrl
} from '../_shared/linkedin-job.ts';
import { parseLinkedInJobCards } from '../_shared/linkedin-search.ts';
import { fetchLinkedInSearch } from '../_shared/linkedin-search.ts';
import { normalizeLinkedInJob } from '../_shared/linkedin-normalize.ts';
import { searchIndeedQatar } from '../_shared/indeed-search.ts';
import { searchAllSources } from '../_shared/multi-source-search.ts';
import { buildLinkedInSearchVariants, loadLinkedInProfileContext, scoreLinkedInJobAgainstProfile } from '../_shared/linkedin-profile-search.ts';

function extractLinkedInJobId(url: string): string | null {
  return sharedExtractId(url);
}

function isIndeedSearchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return parsed.hostname.includes('indeed.com') && path.includes('/jobs') && !path.includes('/viewjob');
  } catch {
    return false;
  }
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

type LinkedInProfileContext = {
  desiredTitles: string[];
  headline: string;
  location: string;
  country: string;
  remotePreference: string;
  skills: string[];
  salaryFloor: number;
};

function normalizeProfileText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTitleTokens(value: string): string[] {
  return normalizeProfileText(value)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function extractCountryFromLocation(location: string): string {
  const parts = String(location || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join(', ');
  return '';
}

async function loadLinkedInProfileContext(supabaseClient: any, userId: string): Promise<LinkedInProfileContext | null> {
  const [profileRes, skillsRes] = await Promise.all([
    supabaseClient
      .from('profiles_v2')
      .select('headline, location, country, remote_preference, desired_salary_min, desired_titles')
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseClient
      .from('profile_skills')
      .select('skill_name')
      .eq('user_id', userId),
  ]);

  const profile = profileRes?.data as Record<string, unknown> | null;
  if (!profile) return null;

  const desiredTitles = Array.isArray(profile.desired_titles)
    ? profile.desired_titles.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const headline = String(profile.headline || '').trim();
  const titleSeeds = desiredTitles.length > 0 ? desiredTitles : headline ? [headline] : [];
  const skills = (skillsRes.data || [])
    .map((row: any) => String(row?.skill_name || '').trim())
    .filter(Boolean);

  return {
    desiredTitles: titleSeeds,
    headline,
    location: String(profile.location || '').trim(),
    country: String(profile.country || '').trim(),
    remotePreference: String(profile.remote_preference || '').trim(),
    skills,
    salaryFloor: Number(profile.desired_salary_min || 0),
  };
}

function scoreLinkedInJobAgainstProfile(job: any, profile: LinkedInProfileContext): number {
  const jobTitle = normalizeProfileText(String(job?.title || ''));
  const jobBlob = normalizeProfileText([
    job?.title,
    job?.company,
    job?.location,
    job?.description,
    Array.isArray(job?.requirements) ? job.requirements.join(' ') : '',
  ].filter(Boolean).join(' '));

  if (!jobTitle) return 0;

  const titleTokens = profile.desiredTitles.flatMap((title) => splitTitleTokens(title));
  const exactTitleHit = profile.desiredTitles.some((title) => {
    const normalized = normalizeProfileText(title);
    return normalized && (jobTitle.includes(normalized) || normalized.includes(jobTitle));
  });
  const tokenMatches = titleTokens.filter((token) => jobTitle.includes(token)).length;
  const titleScore = exactTitleHit
    ? 70
    : titleTokens.length > 0
      ? Math.round((tokenMatches / Math.max(titleTokens.length, 1)) * 45)
      : 0;

  const skillMatches = profile.skills.filter((skill) => jobBlob.includes(normalizeProfileText(skill))).length;
  const skillScore = profile.skills.length > 0
    ? Math.round((skillMatches / Math.max(profile.skills.length, 1)) * 25)
    : 0;

  const locationText = normalizeProfileText(String(job?.location || ''));
  const profileCountry = normalizeProfileText(profile.country);
  const profileLocation = normalizeProfileText(profile.location);
  const locationScore = profileCountry && locationText.includes(profileCountry)
    ? 12
    : profileLocation && locationText.includes(profileLocation)
      ? 10
      : String(job?.remote_type || '').toLowerCase() === 'remote' && profile.remotePreference === 'remote'
        ? 8
        : 0;

  const salaryScore = profile.salaryFloor > 0 && Number(job?.salary_min || 0) >= profile.salaryFloor ? 5 : 0;

  return Math.min(100, titleScore + skillScore + locationScore + salaryScore);
}

function rankLinkedInJobsByProfile(jobs: any[], profile: LinkedInProfileContext): Array<{ job: any; score: number }> {
  return jobs
    .map((job) => ({ job, score: scoreLinkedInJobAgainstProfile(job, profile) }))
    .sort((a, b) => b.score - a.score);
}

async function fetchLinkedInProfileSeededJobs(profile: LinkedInProfileContext): Promise<{ jobs: any[]; debug: any[] }> {
  const seeds = profile.desiredTitles.slice(0, 4);
  const searchLocation = profile.country || extractCountryFromLocation(profile.location) || profile.location || 'Qatar';
  const collected = new Map<string, any>();
  const debug: any[] = [];

  for (const seed of seeds) {
    try {
      const snippets = await fetchLinkedInSearch({
        keywords: seed,
        location: searchLocation,
        pageNum: 0,
        limit: 10,
        postedWithin: 'month',
      });

      const normalized = snippets.map((snippet) =>
        markNormalizationStatus(normalizeLinkedInJob(snippet), 1000)
      );

      const ranked = rankLinkedInJobsByProfile(normalized, profile);
      const topScore = ranked[0]?.score ?? 0;
      if (topScore < 25) {
        debug.push({
          seed,
          location: searchLocation,
          total: normalized.length,
          kept: 0,
          top_score: topScore,
          skipped: true,
        });
        continue;
      }

      const relevant = ranked.filter((item) => item.score >= 20).map((item) => item.job);
      const finalJobs = relevant.length > 0 ? relevant : ranked.slice(0, 5).map((item) => item.job);

      debug.push({
        seed,
        location: searchLocation,
        total: normalized.length,
        kept: finalJobs.length,
        top_score: topScore,
      });

      for (const job of finalJobs) {
        const key = String(job?.linkedin_job_id || job?.apply_url || job?.title || '')
          .trim()
          .toLowerCase();
        if (!key || collected.has(key)) continue;
        collected.set(key, job);
      }

      if (collected.size >= 20) break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debug.push({ seed, error: msg });
    }
  }

  return { jobs: [...collected.values()], debug };
}

async function fetchLinkedInCollectionCards(formattedUrl: string): Promise<{ cards: any[]; debug: any[] }> {
  const collected = new Map<string, any>();
  const debug: any[] = [];
  const startOffsets = [0, 25, 50, 75, 100, 125];
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const cookieHeader = getLinkedInCookieHeader();
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  for (const start of startOffsets) {
    const guestUrl = buildLinkedInGuestSearchUrl(formattedUrl, start);
    if (!guestUrl) break;

    const res = await fetch(guestUrl, { headers });
    if (!res.ok) {
      console.warn(`LinkedIn guest search page fetch failed at start=${start}: HTTP ${res.status}`);
      debug.push({ start, status: res.status, cards: 0, url: guestUrl });
      continue;
    }

    const html = await res.text();
    const cards = parseLinkedInJobCards(html);
    debug.push({ start, status: res.status, html_length: html.length, cards: cards.length, url: guestUrl });
    let added = 0;
    for (const card of cards) {
      if (!collected.has(card.linkedin_job_id)) {
        collected.set(card.linkedin_job_id, card);
        added++;
      }
    }

    console.log(`[LinkedInSearch] guest page start=${start} → ${cards.length} cards (${added} new, total ${collected.size})`);

    if (cards.length === 0 || added === 0) break;
  }

  return { cards: [...collected.values()], debug };
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

function pickIndeedSearchSeed(profile: LinkedInProfileContext | null, url: string): string {
  try {
    const parsed = new URL(url);
    const q = parsed.searchParams.get('q')?.trim();
    if (q) return q;
  } catch {
    /* ignore */
  }

  const fromProfile = profile?.desiredTitles?.find((title) => String(title || '').trim());
  return String(fromProfile || profile?.headline || 'Qatar').trim() || 'Qatar';
}

async function searchIndeedFromUrl(
  formattedUrl: string,
  userId: string,
  supabaseClient: any,
): Promise<{ jobs: any[]; debug: any[] }> {
  const profileContext = await loadLinkedInProfileContext(supabaseClient, userId).catch(() => null);
  let location = 'Qatar';

  try {
    const parsed = new URL(formattedUrl);
    location = parsed.searchParams.get('l')?.trim() || location;
  } catch {
    /* ignore */
  }

  if (profileContext?.country) location = profileContext.country;
  else if (profileContext?.location) location = profileContext.location;

  const initialSeed = pickIndeedSearchSeed(profileContext, formattedUrl);
  const seedCandidates = new Set<string>([
    initialSeed,
    ...buildLinkedInSearchVariants({ keywords: initialSeed, profile: profileContext }),
    ...(profileContext?.desiredTitles || []).slice(0, 4),
    profileContext?.headline || '',
    profileContext?.country || '',
    profileContext?.location || '',
    'Qatar',
    'architect',
    'engineer',
    'solutions architect',
    'infrastructure architect',
    'cloud architect',
    'system engineer',
  ].map((seed) => String(seed || '').trim()).filter(Boolean));

  const collected = new Map<string, any>();
  const debug: any[] = [];

  for (const seed of [...seedCandidates].slice(0, 8)) {
    try {
      const jobs = await searchIndeedQatar(seed, location, 10);
      const ranked = profileContext
        ? jobs.map((job) => ({ ...job, relevance_score: scoreLinkedInJobAgainstProfile(job, profileContext) }))
        : jobs;

      debug.push({ seed, count: jobs.length });

      for (const job of ranked) {
        const key = String(job?.apply_url || job?.external_id || job?.title || '')
          .trim()
          .toLowerCase() || `${String(job?.title || '').trim().toLowerCase()}|${String(job?.company || '').trim().toLowerCase()}`;
        if (!key || collected.has(key)) continue;
        collected.set(key, job);
      }

      if (collected.size >= 20) break;
    } catch (err) {
      debug.push({ seed, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const resultJobs = [...collected.values()];
  let finalJobs = profileContext
    ? resultJobs.sort((a, b) => Number(b.relevance_score || 0) - Number(a.relevance_score || 0))
    : resultJobs;

  if (finalJobs.length === 0) {
    const fallbackQuery = profileContext?.desiredTitles?.[0] || profileContext?.headline || initialSeed || 'Qatar';
    const fallback = await searchAllSources({
      keywords: fallbackQuery,
      location,
      limit: 20,
      perSourceLimit: 10,
      sources: {
        linkedin: true,
        indeed: false,
        bayt: true,
        gulftalent: true,
      },
      profile: profileContext,
    });
    finalJobs = fallback.jobs || [];
    debug.push({
      fallback: 'multi_source',
      query: fallbackQuery,
      counts: fallback.counts,
      sources_with_results: fallback.sources_with_results,
      returned: finalJobs.length,
    });
  }

  return {
    jobs: finalJobs,
    debug: [
      {
        source: 'indeed_search_url',
        query: initialSeed,
        location,
        counts: { indeed: finalJobs.length },
        sources_with_results: finalJobs.length > 0 ? ['indeed'] : [],
        seeds: debug,
      },
    ],
  };
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
    return await enrichLinkedInJob(jobId, userId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Failed to scrape LinkedIn job ' + jobId + ':', msg);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const authHeader = req.headers.get('Authorization');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const requestedUrl = typeof body?.url === 'string' ? body.url : '';
    const requestedUserId = typeof body?.user_id === 'string' ? body.user_id : null;
    const allowUserIdFallback = Boolean(requestedUserId && isIndeedSearchUrl(requestedUrl));
    let userId: string;
    let supabaseClient: any;

    if (!authHeader) {
      if (allowUserIdFallback && serviceRoleKey && requestedUserId) {
        userId = requestedUserId;
        supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          serviceRoleKey
        );
      } else {
        return new Response(JSON.stringify({ error: 'Missing authorization' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

      if (serviceRoleKey && bearerToken === serviceRoleKey) {
        userId = requestedUserId || '';
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Missing user_id' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          serviceRoleKey
        );
      } else {
        supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
          if (allowUserIdFallback && serviceRoleKey && requestedUserId) {
            userId = requestedUserId;
            supabaseClient = createClient(
              Deno.env.get('SUPABASE_URL')!,
              serviceRoleKey
            );
          } else {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          userId = user.id;
        }
      }
    }

    const { url, manualDescription, job_id } = body;
    const debugMode = body?.debug === true;
    const hydratedJobId = isMeaningfulText(job_id) ? String(job_id).trim() : '';
    
    // Handle manual paste mode
    if (manualDescription) {
      try {
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
      } catch (manualError) {
        const msg = manualError instanceof Error ? manualError.message : String(manualError);
        console.warn('Manual description extraction failed:', msg);
        return new Response(JSON.stringify({
          success: false,
          error: 'EXTRACTION_FAILED',
          message: 'Could not extract structured data from the pasted description. Use the full import dialog to paste the job details instead.',
          fallback: true,
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
        const { cards, debug } = await fetchLinkedInCollectionCards(formattedUrl);
        const profileContext = await loadLinkedInProfileContext(supabaseClient, userId);
        const evidenceLength = debug.reduce((max, entry) => Math.max(max, Number(entry?.html_length || 0)), 0) || 1000;
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
        }, evidenceLength));

        let normalizedJobs = dedupeLinkedInJobs(jobs.map((job) => markNormalizationStatus(job, 1000)));
        let relevanceDebug: any = null;

        if (profileContext) {
          const ranked = rankLinkedInJobsByProfile(normalizedJobs, profileContext);
          const relevant = ranked.filter((item) => item.score >= 25).map((item) => item.job);
          relevanceDebug = {
            strategy: 'page_cards',
            top_scores: ranked.slice(0, 5).map((item) => ({ title: item.job?.title, score: item.score })),
          };

          if (relevant.length > 0) {
            normalizedJobs = dedupeLinkedInJobs(relevant);
          } else {
            const seeded = await fetchLinkedInProfileSeededJobs(profileContext);
            if (seeded.jobs.length > 0) {
              normalizedJobs = dedupeLinkedInJobs(seeded.jobs.map((job) => markNormalizationStatus(job, 1000)));
              relevanceDebug = {
                strategy: 'profile_seeded_search',
                seeds: seeded.debug,
              };
            }
          }
        }

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
                  source: 'collection_guest_api',
                  pages: debug,
                  relevance: relevanceDebug,
                  final_jobs: normalizedJobs.length,
                },
              } : {}),
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (debugMode) {
          return new Response(JSON.stringify({
            success: false,
            error: 'LINKEDIN_SEARCH_EMPTY',
            message: 'LinkedIn guest search returned no cards.',
            debug: {
              source: 'collection_guest_api',
              pages: debug,
            },
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('LinkedIn collection page fetch failed, falling back to URL job IDs:', msg);
        if (debugMode) {
          return new Response(JSON.stringify({
            success: false,
            error: 'LINKEDIN_COLLECTION_FETCH_FAILED',
            message: msg,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
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
            const enriched = await enrichLinkedInJob(jobId, userId);
          if (enriched) {
            const evidenceLength = String(enriched.description || '').trim().length || 1000;
            job = markNormalizationStatus(enriched, evidenceLength);
            extracted = true;
            console.log('LinkedIn guest HTML parsed:', job.title);
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

      // === Indeed search/listing URLs: route through board search instead of scraping blocked HTML ===
      if (!extracted && isIndeedSearchUrl(formattedUrl)) {
        try {
          const { jobs, debug } = await searchIndeedFromUrl(formattedUrl, userId, supabaseClient);
          if (jobs.length > 0) {
            try {
              await recordLedgerSync(supabaseClient as any, userId, 'indeed-search-scrape', 'search', jobs, {
                baseUrl: formattedUrl,
                configJson: {
                  source: 'indeed_search_url',
                  debug,
                },
                normalizationStatus: 'valid',
                runMode: 'collect',
              });
            } catch (ledgerError) {
              console.warn('Ledger sync failed for Indeed search URL:', ledgerError);
            }

            console.log(`Successfully extracted ${jobs.length} Indeed jobs from search/list URL`);
            return new Response(JSON.stringify({
              success: true,
              multiple: true,
              jobs,
              total_found: jobs.length,
              failed_count: 0,
              debug,
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({
            success: false,
            error: 'INDEED_SEARCH_EMPTY',
            message: 'Indeed search returned no jobs for this query.',
            fallback: true,
            debug,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('Indeed search/list URL fallback failed:', msg);
          return new Response(JSON.stringify({
            success: false,
            error: 'INDEED_SEARCH_FAILED',
            message: msg,
            fallback: true,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
          const message = 'Could not fetch enough content from this page.';
          return new Response(JSON.stringify({ success: false, error: message, message, fallback: true }), {
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
        const message = msg || 'Could not extract job data. Try using the "Paste Description" tab.';
        return new Response(JSON.stringify({ success: false, error: message, message, fallback: true }), {
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
    return new Response(JSON.stringify({ error: msg, message: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
