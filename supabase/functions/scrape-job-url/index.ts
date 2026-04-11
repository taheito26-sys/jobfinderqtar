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

/** Try LinkedIn's guest/public job posting endpoint */
async function fetchLinkedInJob(jobId: string): Promise<string> {
  // LinkedIn serves public job HTML at this guest endpoint
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
  
  // Strip tags to get text
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

/** Use AI to extract structured job data from raw text — tries Lovable AI first (free), then user's providers */
async function extractJobWithAI(text: string, sourceUrl: string, userId: string): Promise<any> {
  const prompt = `Extract structured job posting data from the following text. Return ONLY a valid JSON object with these fields:
{
  "title": "Job title",
  "company": "Company name",
  "location": "Job location",
  "remote_type": "remote|hybrid|onsite|unknown",
  "description": "Full job description",
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null,
  "employment_type": "full-time|part-time|contract|internship",
  "seniority_level": "junior|mid|senior|lead|executive",
  "requirements": ["requirement 1", "requirement 2"],
  "apply_url": "${sourceUrl}"
}

TEXT:
${text}`;

  // Try Lovable AI Gateway first (always available with LOVABLE_API_KEY)
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

  // Also try user's configured providers as fallback
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
  } catch (e) {
    console.warn('Could not load pipeline config, using Lovable AI only:', e.message);
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
    } catch (e) {
      console.warn(`${prov.name} error: ${e.message}`);
      lastError = e.message;
    }
  }
  throw new Error(`All AI providers failed. Last error: ${lastError}`);
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

    // === LinkedIn: use guest API ===
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
            };
            extracted = true;
            console.log('LinkedIn guest API + AI extracted:', job.title);
          }
        } catch (e) {
          console.warn('LinkedIn guest API fallback failed:', e.message);
        }
      }

      if (!extracted) {
        return new Response(JSON.stringify({ 
          error: 'LINKEDIN_LOGIN_REQUIRED',
          message: 'This LinkedIn job requires login to view. Use the "Paste Description" tab to manually paste the job details.',
        }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
            job = {
              title: ext.title || 'Untitled Job', company: ext.company || 'Unknown Company',
              location: ext.location || '', remote_type: ext.remote_type || 'unknown',
              description: ext.description || md.substring(0, 5000),
              salary_min: ext.salary_min || null, salary_max: ext.salary_max || null,
              salary_currency: ext.salary_currency || null, employment_type: ext.employment_type || 'full-time',
              seniority_level: ext.seniority_level || '', requirements: ext.requirements || [],
              apply_url: ext.apply_url || formattedUrl,
            };
            extracted = true;
            console.log('Firecrawl extracted:', job.title);
          } else {
            console.warn('Firecrawl failed, trying direct fetch fallback');
          }
        } catch (e) {
          console.warn('Firecrawl error:', e.message);
        }
      }
    }

    // === Final fallback: direct fetch + AI ===
    if (!extracted) {
      try {
        const pageText = await fetchPageText(formattedUrl);
        if (pageText.length < 100) {
          return new Response(JSON.stringify({ error: 'Could not fetch enough content from this page.' }), {
            status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        };
        extracted = true;
      } catch (e) {
        console.error('All extraction methods failed:', e.message);
        return new Response(JSON.stringify({ error: 'Could not extract job data. Try using the "Paste Description" tab.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, job }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Failed to scrape' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
