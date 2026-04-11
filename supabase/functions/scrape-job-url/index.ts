import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getPipelineConfig } from '../_shared/ai-pipeline.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isLinkedInUrl(url: string): boolean {
  try { return new URL(url).hostname.includes('linkedin.com'); } catch { return false; }
}

/** Attempt to fetch raw HTML from a URL and extract text content */
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
  // Strip tags to get raw text
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
  const config = await getPipelineConfig(userId);
  const provider = config.primary;

  const prompt = `Extract structured job posting data from the following text. Return ONLY a valid JSON object with these fields:
{
  "title": "Job title",
  "company": "Company name",
  "location": "Job location",
  "remote_type": "remote|hybrid|onsite|unknown",
  "description": "Full job description",
  "salary_min": null or number,
  "salary_max": null or number,
  "salary_currency": null or "USD"/"QAR" etc,
  "employment_type": "full-time|part-time|contract|internship",
  "seniority_level": "junior|mid|senior|lead|executive",
  "requirements": ["requirement 1", "requirement 2"],
  "apply_url": "${sourceUrl}"
}

TEXT:
${text}`;

  let body: any;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (provider.provider === 'anthropic') {
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: provider.model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    };
  } else {
    headers['Authorization'] = provider.provider === 'lovable'
      ? `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
      : `Bearer ${provider.apiKey}`;
    body = {
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    };
  }

  const res = await fetch(provider.url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI extraction failed (${provider.name}): ${res.status} - ${err}`);
  }

  const data = await res.json();
  let content: string;
  if (provider.provider === 'anthropic') {
    content = data.content?.[0]?.text || '';
  } else {
    content = data.choices?.[0]?.message?.content || '';
  }

  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
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

    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
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

    // Try Firecrawl first (skip for LinkedIn since it's unsupported)
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    let firecrawlSuccess = false;

    if (apiKey && !isLinkedin) {
      try {
        const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: formattedUrl,
            formats: ['markdown', {
              type: 'json',
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Job title' },
                  company: { type: 'string', description: 'Company name' },
                  location: { type: 'string', description: 'Job location (city, country)' },
                  remote_type: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'] },
                  description: { type: 'string', description: 'Full job description text' },
                  salary_min: { type: 'number' },
                  salary_max: { type: 'number' },
                  salary_currency: { type: 'string' },
                  employment_type: { type: 'string', enum: ['full-time', 'part-time', 'contract', 'internship'] },
                  seniority_level: { type: 'string' },
                  requirements: { type: 'array', items: { type: 'string' } },
                  apply_url: { type: 'string' },
                },
                required: ['title', 'company'],
              },
            }],
            onlyMainContent: true,
          }),
        });

        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json();
          const extracted = scrapeData.data?.json || scrapeData.json || {};
          const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';

          job = {
            title: extracted.title || 'Untitled Job',
            company: extracted.company || 'Unknown Company',
            location: extracted.location || '',
            remote_type: extracted.remote_type || 'unknown',
            description: extracted.description || markdown.substring(0, 5000),
            salary_min: extracted.salary_min || null,
            salary_max: extracted.salary_max || null,
            salary_currency: extracted.salary_currency || null,
            employment_type: extracted.employment_type || 'full-time',
            seniority_level: extracted.seniority_level || '',
            requirements: extracted.requirements || [],
            apply_url: extracted.apply_url || formattedUrl,
          };
          firecrawlSuccess = true;
          console.log('Firecrawl extracted:', job.title, 'at', job.company);
        } else {
          const errData = await scrapeResponse.json();
          console.warn('Firecrawl rejected, falling back to direct fetch + AI:', errData.error);
        }
      } catch (e) {
        console.warn('Firecrawl failed, falling back:', e.message);
      }
    }

    // Fallback: direct fetch + AI extraction (for LinkedIn or Firecrawl failures)
    if (!firecrawlSuccess) {
      console.log('Using direct fetch + AI extraction fallback');
      try {
        const pageText = await fetchPageText(formattedUrl);
        if (pageText.length < 100) {
          return new Response(JSON.stringify({ error: 'Could not fetch enough content from this page. The site may require login.' }), {
            status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const extracted = await extractJobWithAI(pageText, formattedUrl, user.id);
        job = {
          title: extracted.title || 'Untitled Job',
          company: extracted.company || 'Unknown Company',
          location: extracted.location || '',
          remote_type: extracted.remote_type || 'unknown',
          description: extracted.description || '',
          salary_min: extracted.salary_min || null,
          salary_max: extracted.salary_max || null,
          salary_currency: extracted.salary_currency || null,
          employment_type: extracted.employment_type || 'full-time',
          seniority_level: extracted.seniority_level || '',
          requirements: extracted.requirements || [],
          apply_url: extracted.apply_url || formattedUrl,
        };
        console.log('AI extracted:', job.title, 'at', job.company);
      } catch (fallbackErr) {
        console.error('Fallback extraction failed:', fallbackErr.message);
        return new Response(JSON.stringify({ 
          error: `Could not extract job data. ${isLinkedin ? 'LinkedIn requires login for most job pages — try copying the job description manually.' : 'The site may be blocking automated access.'}` 
        }), {
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
