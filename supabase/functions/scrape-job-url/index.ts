import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getPipelineConfig } from '../_shared/ai-pipeline.ts';
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

function extractLinkedInJobId(url: string): string | null {
  const match = url.match(/\/jobs\/view\/(\d+)/) || url.match(/currentJobId=(\d+)/);
  return match ? match[1] : null;
}

/** Extract ALL job IDs from a LinkedIn search/collection URL */
function extractAllLinkedInJobIds(url: string): string[] {
  const ids = new Set<string>();

  // currentJobId param
  const currentMatch = url.match(/currentJobId=(\d+)/);
  if (currentMatch) ids.add(currentMatch[1]);

  // originToLandingJobPostings param (comma-separated IDs)
  const landingMatch = url.match(/originToLandingJobPostings=([^&]+)/);
  if (landingMatch) {
    const decoded = decodeURIComponent(landingMatch[1]);
    decoded.split(/[,%2C]+/).forEach(id => {
      const trimmed = id.trim();
      if (/^\d+$/.test(trimmed)) ids.add(trimmed);
    });
  }

  // /jobs/view/ID pattern
  const viewMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) ids.add(viewMatch[1]);

  return [...ids];
}

/** Check if this is a LinkedIn search/collection page (not a single job view) */
function isLinkedInSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname;
    // Search pages, collections, alerts
    if (path.includes('/jobs/search') || path.includes('/jobs/collections')) return true;
    // Has multiple job IDs
    if (u.searchParams.get('originToLandingJobPostings')) return true;
    return false;
  } catch { return false; }
}

function markNormalizationStatus(job: any, evidenceLength: number) {
  const description = String(job?.description || '').trim();
  const valid = evidenceLength >= 200 && description.length >= 250;
  return { ...job, normalization_status: valid ? 'valid' : 'incomplete' };
}

/** Try LinkedIn's guest/public job posting endpoint */
async function fetchLinkedInJob(jobId: string): Promise<string> {
  const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  console.log('Trying LinkedIn guest API:', guestUrl);
  
  const res = await fetch(guestUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  
  if (!res.ok) throw new Error(`LinkedIn guest API returned ${res.status}`);
  const html = await res.text();
  
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 15000);
}

/** Fetch raw HTML from a URL and extract text */
async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 12000);
}

/**
 * Shape returned from AI extraction — either a single job or multiple.
 * type === 'single'   → job field is populated
 * type === 'multiple' → jobs array is populated (each distinct role on the page)
 */
type ExtractionResult =
  | { type: 'single'; job: Record<string, unknown> }
  | { type: 'multiple'; jobs: Record<string, unknown>[] };

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

/** Use AI to extract structured job data from raw text.
 *  Returns a single job or multiple individual jobs when the page lists many distinct positions. */
async function extractJobWithAI(text: string, sourceUrl: string, userId: string): Promise<ExtractionResult> {
  const prompt = `Analyse the text below and determine whether it contains ONE job listing or MULTIPLE DISTINCT job listings (different titles or roles).

RULES:
- If the page is a single job posting: return {"type":"single","job":{...}}
- If the page lists 2 or more different positions: return {"type":"multiple","jobs":[{...},{...},...]}
- Never combine two different roles into one record — each distinct title must be its own object.
- For remote_type: if a job has a physical city/country and does NOT explicitly say "remote" or "work from home", use "onsite".
- For source_created_at: ISO 8601 string only if the posting explicitly states the original publish date (e.g. "Posted 3 days ago", "Posted Jan 15 2025"). Otherwise null. Never invent a date.

Fields for each job object:
{
  "title": string,
  "company": string,
  "location": string,
  "remote_type": "remote"|"hybrid"|"onsite"|"unknown",
  "description": string (full description for THIS specific role only),
  "salary_min": number|null,
  "salary_max": number|null,
  "salary_currency": string|null,
  "employment_type": "full-time"|"part-time"|"contract"|"internship",
  "seniority_level": "junior"|"mid"|"senior"|"lead"|"executive"|"",
  "requirements": string[],
  "apply_url": "${sourceUrl}",
  "source_created_at": string|null
}

Return ONLY valid JSON — no markdown, no explanation.

TEXT:
${text}`;

  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const providers: Array<{name: string; url: string; headers: Record<string,string>; body: any; extractContent: (d:any)=>string}> = [];

  if (lovableKey) {
    providers.push({
      name: 'Lovable AI',
      url: 'https://ai.gateway.lovable.dev/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lovableKey}` },
      body: { model: 'google/gemini-3-flash-preview', messages: [{ role: 'user', content: prompt }], temperature: 0.1 },
      extractContent: (data: any) => data.choices?.[0]?.message?.content || '',
    });
  }

  try {
    const config = await getPipelineConfig(userId);
    if (config.primary.apiKey && config.primary.provider !== 'lovable') {
      const p = config.primary;
      if (p.provider === 'anthropic') {
        providers.push({
          name: p.name,
          url: p.url,
          headers: { 'Content-Type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
          body: { model: p.model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] },
          extractContent: (data: any) => data.content?.[0]?.text || '',
        });
      } else {
        providers.push({
          name: p.name,
          url: p.url,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.apiKey}` },
          body: { model: p.model, messages: [{ role: 'user', content: prompt }], temperature: 0.1 },
          extractContent: (data: any) => data.choices?.[0]?.message?.content || '',
        });
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Could not load pipeline config, using Lovable AI only:', msg);
  }

  let lastError = '';
  for (const prov of providers) {
    try {
      console.log(`Trying AI extraction with ${prov.name}...`);
      const res = await fetch(prov.url, {
        method: 'POST',
        headers: prov.headers,
        body: JSON.stringify(prov.body),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`${prov.name} failed (${res.status}): ${errText.substring(0, 200)}`);
        lastError = `${prov.name}: ${res.status}`;
        continue;
      }
      const data = await res.json();
      const content = prov.extractContent(data);

      // Parse the outermost JSON object or array
      const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (!jsonMatch) {
        console.warn(`${prov.name} did not return valid JSON`);
        lastError = `${prov.name}: no JSON in response`;
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]);

      // Handle response shapes
      if (Array.isArray(parsed)) {
        // Bare array of jobs
        const jobs = parsed.map((j: Record<string, unknown>) => normaliseJob(j, sourceUrl));
        console.log(`AI extraction (${prov.name}): ${jobs.length} jobs (bare array)`);
        return jobs.length === 1 ? { type: 'single', job: jobs[0] } : { type: 'multiple', jobs };
      }
      if (parsed.type === 'multiple' && Array.isArray(parsed.jobs)) {
        const jobs = parsed.jobs.map((j: Record<string, unknown>) => normaliseJob(j, sourceUrl));
        console.log(`AI extraction (${prov.name}): ${jobs.length} jobs (multiple)`);
        return jobs.length === 1 ? { type: 'single', job: jobs[0] } : { type: 'multiple', jobs };
      }
      // Single-job response (either {type:'single',job:{}} or bare job object)
      const rawJob = parsed.type === 'single' && parsed.job ? parsed.job as Record<string, unknown> : parsed as Record<string, unknown>;
      console.log(`AI extraction (${prov.name}): 1 job (single)`);
      return { type: 'single', job: normaliseJob(rawJob, sourceUrl) };

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${prov.name} error: ${msg}`);
      lastError = msg;
    }
  }
  throw new Error(`All AI providers failed. Last error: ${lastError}`);
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
    const job = result.type === 'multiple' ? result.jobs[0] : result.job;
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
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

    const { url, manualDescription } = await req.json();
    
    // Handle manual paste mode
    if (manualDescription) {
      console.log('Using manually pasted job description');
      const extracted = await extractJobWithAI(manualDescription, url || '', user.id);
      if (extracted.type === 'multiple') {
        const jobs = extracted.jobs.map((job) => markNormalizationStatus({
          ...job,
          description: job.description || manualDescription.substring(0, 5000),
        }, manualDescription.length));
        try {
          await recordLedgerSync(supabaseClient as any, user.id, 'manual-job-description', 'manual', jobs, {
            baseUrl: url || '',
            configJson: { source: 'manual_description' },
            normalizationStatus: manualDescription.length >= 250 ? 'valid' : 'incomplete',
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
      const job = markNormalizationStatus({
        ...extracted.job,
        description: extracted.job.description || manualDescription.substring(0, 5000),
      }, manualDescription.length);
      try {
        await recordLedgerSync(supabaseClient as any, user.id, 'manual-job-description', 'manual', [job], {
          baseUrl: url || '',
          configJson: { source: 'manual_description' },
          normalizationStatus: manualDescription.length >= 250 ? 'valid' : 'incomplete',
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
      const allJobIds = extractAllLinkedInJobIds(formattedUrl);
      console.log(`LinkedIn search URL detected. Found ${allJobIds.length} job IDs:`, allJobIds);

        if (allJobIds.length > 0) {
          const jobs: any[] = [];
          const failedIds: string[] = [];

        // Scrape each job sequentially (to avoid rate limiting)
        for (const jobId of allJobIds) {
          const result = await scrapeSingleLinkedInJob(jobId, user.id);
          if (result) {
            jobs.push(result);
            console.log(`✓ Job ${jobId}: ${result.title} at ${result.company}`);
          } else {
            failedIds.push(jobId);
          }
        }

        if (jobs.length > 0) {
          const normalizedJobs = jobs.map((job) => markNormalizationStatus(job, 1000));
          try {
            await recordLedgerSync(supabaseClient as any, user.id, 'linkedin-search-scrape', 'linkedin', normalizedJobs, {
              baseUrl: formattedUrl,
              configJson: { source: 'linkedin_search_url' },
              normalizationStatus: 'valid',
              runMode: 'collect',
            });
          } catch (ledgerError) {
            console.warn('Ledger sync failed for LinkedIn search URL:', ledgerError);
          }
          console.log(`Successfully extracted ${jobs.length}/${allJobIds.length} jobs from LinkedIn search URL`);
          return new Response(JSON.stringify({
            success: true,
            multiple: true,
            jobs: normalizedJobs,
            total_found: allJobIds.length,
            failed_count: failedIds.length,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // All failed — fall back to login required message
        return new Response(JSON.stringify({
          success: false,
          error: 'LINKEDIN_LOGIN_REQUIRED',
          message: 'Could not extract jobs from this LinkedIn page. Use the "Paste Description" tab to manually paste job details.',
          fallback: true,
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // === LinkedIn Single Job URL ===
    if (isLinkedin) {
      const jobId = extractLinkedInJobId(formattedUrl);
      if (jobId) {
        try {
          const pageText = await fetchLinkedInJob(jobId);
          if (pageText.length > 200) {
            const aiResult = await extractJobWithAI(pageText, formattedUrl, user.id);
            // LinkedIn guest API is always a single job page — take first if multi was returned
            job = markNormalizationStatus(aiResult.type === 'multiple' ? aiResult.jobs[0] : aiResult.job, pageText.length);
            extracted = true;
            console.log('LinkedIn guest API + AI extracted:', job.title);
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

            // Always run through AI extraction on the full markdown so we can detect multiple jobs.
            // The Firecrawl JSON schema result (ext) is only used as a seed title/company fallback.
            const ext = scrapeData.data?.json || scrapeData.json || {};
            const aiText = md.length >= 200 ? md.substring(0, 12000) : JSON.stringify(ext);
            const aiResult = await extractJobWithAI(aiText, formattedUrl, user.id);

            if (aiResult.type === 'multiple') {
              // Patch firecrawlDate onto any job that lacks source_created_at
              const jobs = aiResult.jobs.map(j => markNormalizationStatus({
                ...j,
                source_created_at: (j.source_created_at as string | null) || firecrawlDate || null,
              }, md.length));
              try {
                await recordLedgerSync(supabaseClient as any, user.id, 'firecrawl-search-scrape', 'search', jobs, {
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
        const aiResult = await extractJobWithAI(pageText, formattedUrl, user.id);
        if (aiResult.type === 'multiple') {
          const jobs = aiResult.jobs.map((job) => markNormalizationStatus(job, pageText.length));
          try {
            await recordLedgerSync(supabaseClient as any, user.id, 'direct-fetch-scrape', 'web', jobs, {
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
        return new Response(JSON.stringify({ success: false, error: 'Could not extract job data. Try using the "Paste Description" tab.', fallback: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    try {
      await recordLedgerSync(supabaseClient as any, user.id, 'single-job-scrape', isLinkedin ? 'linkedin' : 'web', [job], {
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
