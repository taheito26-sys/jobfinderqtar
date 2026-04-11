import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Firecrawl not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log('Scraping job URL:', formattedUrl);

    // Use Firecrawl with JSON extraction to get structured job data
    const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: formattedUrl,
        formats: [
          'markdown',
          {
            type: 'json',
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Job title' },
                company: { type: 'string', description: 'Company name' },
                location: { type: 'string', description: 'Job location (city, country)' },
                remote_type: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'], description: 'Remote work type' },
                description: { type: 'string', description: 'Full job description text' },
                salary_min: { type: 'number', description: 'Minimum salary if mentioned' },
                salary_max: { type: 'number', description: 'Maximum salary if mentioned' },
                salary_currency: { type: 'string', description: 'Salary currency code (e.g. QAR, USD)' },
                employment_type: { type: 'string', enum: ['full-time', 'part-time', 'contract', 'internship'], description: 'Employment type' },
                seniority_level: { type: 'string', description: 'Seniority level (e.g. junior, mid, senior, lead)' },
                requirements: { type: 'array', items: { type: 'string' }, description: 'Key requirements' },
                apply_url: { type: 'string', description: 'Direct application URL if different from scraped URL' },
              },
              required: ['title', 'company'],
            },
          },
        ],
        onlyMainContent: true,
      }),
    });

    const scrapeData = await scrapeResponse.json();

    if (!scrapeResponse.ok) {
      console.error('Firecrawl error:', scrapeData);
      return new Response(JSON.stringify({ error: scrapeData.error || 'Scrape failed' }), {
        status: scrapeResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract structured data
    const extracted = scrapeData.data?.json || scrapeData.json || {};
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';

    // Build job object
    const job = {
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

    console.log('Extracted job:', job.title, 'at', job.company);

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
