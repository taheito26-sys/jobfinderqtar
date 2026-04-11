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

    const { query, limit = 10 } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: 'Search query is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Firecrawl not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Searching jobs:', query, 'limit:', limit);

    // Use Firecrawl search API to find job listings
    const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `${query} job listing`,
        limit: Math.min(limit, 20),
      }),
    });

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      console.error('Firecrawl search error:', searchData);
      return new Response(JSON.stringify({ error: searchData.error || 'Search failed' }), {
        status: searchResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process results into structured job objects
    const results = (searchData.data || []).map((result: any) => {
      const markdown = result.markdown || '';
      const title = result.metadata?.title || result.title || '';
      const description = result.metadata?.description || markdown.substring(0, 1000);

      // Try to extract company from title (common pattern: "Job Title - Company")
      const titleParts = title.split(/\s[-–|@]\s/);
      const jobTitle = titleParts[0]?.trim() || 'Untitled Job';
      const company = titleParts[1]?.trim() || 'Unknown Company';

      return {
        title: jobTitle,
        company,
        location: '',
        remote_type: 'unknown',
        description,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        employment_type: 'full-time',
        seniority_level: '',
        requirements: [],
        apply_url: result.url || '',
        source_url: result.url || '',
      };
    }).filter((j: any) => j.title !== 'Untitled Job' || j.company !== 'Unknown Company');

    console.log(`Found ${results.length} job results for: ${query}`);

    return new Response(JSON.stringify({ success: true, jobs: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Search failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
