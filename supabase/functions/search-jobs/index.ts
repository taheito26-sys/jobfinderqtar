import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AIConfig {
  provider: string;
  apiKey: string;
  url: string;
  model: string;
}

async function getAIConfig(userId: string): Promise<AIConfig> {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: prefs } = await supabaseAdmin
    .from('user_preferences').select('key, value')
    .eq('user_id', userId).in('key', ['ai_provider', 'ai_api_key']);

  const prefMap: Record<string, string> = {};
  (prefs || []).forEach((p: any) => { prefMap[p.key] = p.value; });
  const provider = prefMap['ai_provider'] || 'lovable';
  const userKey = prefMap['ai_api_key'] || '';

  switch (provider) {
    case 'anthropic':
      if (!userKey) throw new Error('Anthropic API key not configured.');
      return { provider, apiKey: userKey, url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' };
    case 'openai':
      if (!userKey) throw new Error('OpenAI API key not configured.');
      return { provider, apiKey: userKey, url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' };
    case 'gemini':
      if (!userKey) throw new Error('Google API key not configured.');
      return { provider, apiKey: userKey, url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash' };
    default: {
      const lovableKey = Deno.env.get('LOVABLE_API_KEY');
      if (!lovableKey) throw new Error('LOVABLE_API_KEY not configured');
      return { provider: 'lovable', apiKey: lovableKey, url: 'https://ai.gateway.lovable.dev/v1/chat/completions', model: 'google/gemini-3-flash-preview' };
    }
  }
}

async function callAIText(config: AIConfig, messages: any[]): Promise<string> {
  if (config.provider === 'anthropic') {
    const systemMsg = messages.find((m: any) => m.role === 'system')?.content || '';
    const userMsgs = messages.filter((m: any) => m.role !== 'system');
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, max_tokens: 4096, system: systemMsg, messages: userMsgs, temperature: 0.1 }),
    });
    if (!response.ok) throw new Error(`AI error: ${response.status}`);
    const data = await response.json();
    return data.content?.find((c: any) => c.type === 'text')?.text || '[]';
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.1 }),
  });
  if (!response.ok) throw new Error(`AI error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '[]';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

    const { query, limit = 10, country } = await req.json();
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

    const searchQuery = country ? `${query} ${country} job listing` : `${query} job listing`;
    console.log('Searching jobs:', searchQuery, 'limit:', limit);

    const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, limit: Math.min(limit, 20) }),
    });

    const searchData = await searchResponse.json();
    if (!searchResponse.ok) {
      console.error('Firecrawl search error:', searchData);
      return new Response(JSON.stringify({ error: searchData.error || 'Search failed' }), {
        status: searchResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawResults = searchData.data || [];

    // Try AI-powered extraction
    if (rawResults.length > 0) {
      try {
        const aiConfig = await getAIConfig(user.id);
        console.log(`search-jobs using AI provider: ${aiConfig.provider}`);

        const summaries = rawResults.map((r: any, i: number) => {
          const title = r.metadata?.title || r.title || '';
          const desc = r.metadata?.description || '';
          const markdown = (r.markdown || '').substring(0, 800);
          return `[${i}] URL: ${r.url}\nTitle: ${title}\nDescription: ${desc}\nContent: ${markdown}`;
        }).join('\n---\n');

        const raw = await callAIText(aiConfig, [
          { role: 'system', content: 'You extract structured job listing data. Return ONLY valid JSON array. No markdown wrapping.' },
          {
            role: 'user',
            content: `Extract job details from these search results. Return a JSON array of objects with these fields:
- index (number matching [N] above)
- title (job title only, not company)
- company (company name)
- location (city/country)
- remote_type ("remote"|"hybrid"|"onsite"|"unknown")
- employment_type ("full-time"|"part-time"|"contract"|"internship")
- seniority_level (e.g. "Senior", "Mid", "Junior", "")
- salary_min (number or null)
- salary_max (number or null)
- salary_currency (e.g. "USD","QAR" or null)
- requirements (array of key requirements, max 5)

Skip entries that are not actual job postings.

Results:
${summaries}`
          }
        ]);

        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          const enriched = parsed.map((p: any) => {
            const source = rawResults[p.index];
            if (!source) return null;
            return {
              title: p.title || 'Untitled Job',
              company: p.company || 'Unknown Company',
              location: p.location || '',
              remote_type: p.remote_type || 'unknown',
              description: source.metadata?.description || (source.markdown || '').substring(0, 1000),
              salary_min: p.salary_min || null,
              salary_max: p.salary_max || null,
              salary_currency: p.salary_currency || null,
              employment_type: p.employment_type || 'full-time',
              seniority_level: p.seniority_level || '',
              requirements: Array.isArray(p.requirements) ? p.requirements : [],
              apply_url: source.url || '',
              source_url: source.url || '',
            };
          }).filter(Boolean);

          if (enriched.length > 0) {
            console.log(`AI (${aiConfig.provider}) extracted ${enriched.length} structured jobs`);
            return new Response(JSON.stringify({ success: true, jobs: enriched }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      } catch (e) {
        console.error('AI extraction failed, falling back:', e);
      }
    }

    // Fallback: basic extraction without AI
    const results = rawResults.map((result: any) => {
      const title = result.metadata?.title || result.title || '';
      const description = result.metadata?.description || (result.markdown || '').substring(0, 1000);
      const titleParts = title.split(/\s[-–|@]\s/);
      return {
        title: titleParts[0]?.trim() || 'Untitled Job',
        company: titleParts[1]?.trim() || 'Unknown Company',
        location: '', remote_type: 'unknown', description,
        salary_min: null, salary_max: null, salary_currency: null,
        employment_type: 'full-time', seniority_level: '', requirements: [],
        apply_url: result.url || '', source_url: result.url || '',
      };
    }).filter((j: any) => j.title !== 'Untitled Job' || j.company !== 'Unknown Company');

    return new Response(JSON.stringify({ success: true, jobs: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Search failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});