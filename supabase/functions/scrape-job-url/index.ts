import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getPipelineConfig } from '../_shared/ai-pipeline.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isLinkedInUrl(url: string): boolean {
  try { return new URL(url).hostname.includes('linkedin.com'); } catch { return false; }
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

/** Use AI to extract structured job data from raw text */
async function extractJobWithAI(text: string, sourceUrl: string, userId: string): Promise<any> {
  const prompt = `Extract structured job posting data from the following text. Return ONLY a valid JSON object with these fields:
{
  "title": "Job title",
  "company": "Company name",
  "location": "Job location",
  "remote_type": "remote|hybrid|onsite|unknown" (IMPORTANT: If the job has a physical location like a city/country and does NOT explicitly say 'remote' or 'work from home', set this to 'onsite'. Only use 'remote' if the posting explicitly states remote work. A job in 'Doha, Qatar' is 'onsite' unless it says otherwise.),
  "description": "Full job description",
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null,
  "employment_type": "full-time|part-time|contract|internship",
  "seniority_level": "junior|mid|senior|lead|executive",
  "requirements": ["requirement 1", "requirement 2"],
  "apply_url": "${sourceUrl}",
  "source_created_at": null (ISO 8601 date string if the posting explicitly states when the job was ORIGINALLY POSTED, e.g. "Posted 3 days ago" → compute from context, "Posted on 2025-01-15" → "2025-01-15T00:00:00Z". Set to null if the source does NOT explicitly provide the original posting date. Do NOT use the scrape time or current date.)
}

TEXT:
${text}`;

  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const providers: Array<{name: string; url: string; headers: Record<string,string>; body: any; extractContent: (d:any)=>string}> = [];
  
  if (lovableKey) {
    providers.push({
      name: 'Lovable AI',
      url: 'https://ai.gateway.lovable.dev/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableKey}`,
      },
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
          body: { model: p.model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] },
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
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`${prov.name} did not return valid JSON`);
        lastError = `${prov.name}: no JSON in response`;
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`AI extraction succeeded with ${prov.name}`);
      return parsed;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${prov.name} error: ${msg}`);
      lastError = msg;
    }
  }
  throw new Error(`All AI providers failed. Last error: ${lastError}`);
}

/** Scrape a single LinkedIn job by ID, return structured job or null */
async function scrapeSingleLinkedInJob(jobId: string, userId: string): Promise<any | null> {
  try {
    const pageText = await fetchLinkedInJob(jobId);
    if (pageText.length < 200) {
      console.warn(`Job ${jobId}: insufficient content (${pageText.length} chars)`);
      return null;
    }
    const jobUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;
    const data = await extractJobWithAI(pageText, jobUrl, userId);
    return {
      title: data.title || 'Untitled Job',
      company: data.company || 'Unknown Company',
      location: data.location || '',
      remote_type: data.remote_type || 'unknown',
      description: data.description || '',
      salary_min: data.salary_min || null,
      salary_max: data.salary_max || null,
      salary_currency: data.salary_currency || null,
      employment_type: data.employment_type || 'full-time',
      seniority_level: data.seniority_level || '',
      requirements: data.requirements || [],
      apply_url: data.apply_url || jobUrl,
      source_created_at: data.source_created_at || null,
    };
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
      const job = {
        title: extracted.title || 'Untitled Job',
        company: extracted.company || 'Unknown Company',
        location: extracted.location || '',
        remote_type: extracted.remote_type || 'unknown',
        description: extracted.description || manualDescription.substring(0, 5000),
        salary_min: extracted.salary_min || null,
        salary_max: extracted.salary_max || null,
        salary_currency: extracted.salary_currency || null,
        employment_type: extracted.employment_type || 'full-time',
        seniority_level: extracted.seniority_level || '',
        requirements: extracted.requirements || [],
        apply_url: extracted.apply_url || url || '',
        source_created_at: extracted.source_created_at || null,
      };
      return new Response(JSON.stringify({ success: true, job }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!url) {
      return new Response(JSON.stringify({ error: 'URL or description is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let formattedUrl = url.trim();
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
          console.log(`Successfully extracted ${jobs.length}/${allJobIds.length} jobs from LinkedIn search URL`);
          return new Response(JSON.stringify({
            success: true,
            multiple: true,
            jobs,
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
            const data = await extractJobWithAI(pageText, formattedUrl, user.id);
            job = {
              title: data.title || 'Untitled Job',
              company: data.company || 'Unknown Company',
              location: data.location || '',
              remote_type: data.remote_type || 'unknown',
              description: data.description || '',
              salary_min: data.salary_min || null,
              salary_max: data.salary_max || null,
              salary_currency: data.salary_currency || null,
              employment_type: data.employment_type || 'full-time',
              seniority_level: data.seniority_level || '',
              requirements: data.requirements || [],
              apply_url: data.apply_url || formattedUrl,
              source_created_at: data.source_created_at || null,
            };
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
            const ext = scrapeData.data?.json || scrapeData.json || {};
            const md = scrapeData.data?.markdown || scrapeData.markdown || '';
            // Firecrawl may surface a publishedDate in metadata
            const firecrawlDate = scrapeData.data?.metadata?.publishedDate
              || scrapeData.data?.metadata?.datePublished
              || scrapeData.data?.metadata?.datePosted
              || null;
            job = {
              title: ext.title || 'Untitled Job', company: ext.company || 'Unknown Company',
              location: ext.location || '', remote_type: ext.remote_type || 'unknown',
              description: ext.description || md.substring(0, 5000),
              salary_min: ext.salary_min || null, salary_max: ext.salary_max || null,
              salary_currency: ext.salary_currency || null, employment_type: ext.employment_type || 'full-time',
              seniority_level: ext.seniority_level || '', requirements: ext.requirements || [],
              apply_url: ext.apply_url || formattedUrl,
              source_created_at: ext.source_created_at || firecrawlDate || null,
            };
            extracted = true;
            console.log('Firecrawl extracted:', job.title);
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
        const data = await extractJobWithAI(pageText, formattedUrl, user.id);
        job = {
          title: data.title || 'Untitled Job', company: data.company || 'Unknown Company',
          location: data.location || '', remote_type: data.remote_type || 'unknown',
          description: data.description || '', salary_min: data.salary_min || null, salary_max: data.salary_max || null,
          salary_currency: data.salary_currency || null, employment_type: data.employment_type || 'full-time',
          seniority_level: data.seniority_level || '', requirements: data.requirements || [],
          apply_url: data.apply_url || formattedUrl,
          source_created_at: data.source_created_at || null,
        };
        extracted = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('All extraction methods failed:', msg);
        return new Response(JSON.stringify({ success: false, error: 'Could not extract job data. Try using the "Paste Description" tab.', fallback: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
