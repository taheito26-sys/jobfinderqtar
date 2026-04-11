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
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Firecrawl not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all users with desired_titles set
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles_v2')
      .select('user_id, desired_titles, location, country')
      .not('desired_titles', 'eq', '[]');

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return new Response(JSON.stringify({ error: 'Failed to fetch profiles' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!profiles || profiles.length === 0) {
      console.log('No profiles with desired titles found');
      return new Response(JSON.stringify({ message: 'No profiles to process', jobs_found: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalNewJobs = 0;

    for (const profile of profiles) {
      const titles = (profile.desired_titles as string[]) || [];
      if (titles.length === 0) continue;

      const location = profile.location || profile.country || 'Qatar';

      // Get existing job URLs for this user to deduplicate
      const { data: existingJobs } = await supabaseAdmin
        .from('jobs')
        .select('apply_url, title, company')
        .eq('user_id', profile.user_id);

      const existingUrls = new Set((existingJobs || []).map(j => j.apply_url).filter(Boolean));
      const existingKeys = new Set((existingJobs || []).map(j => `${j.title?.toLowerCase()}|${j.company?.toLowerCase()}`));

      for (const title of titles.slice(0, 3)) { // Limit to 3 titles per user per run
        const searchQuery = `${title} ${location} job listing`;
        console.log(`Searching for user ${profile.user_id}: "${searchQuery}"`);

        try {
          const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: searchQuery,
              limit: 5,
              scrapeOptions: {
                formats: [
                  'markdown',
                  {
                    type: 'json',
                    schema: {
                      type: 'object',
                      properties: {
                        title: { type: 'string', description: 'Job title' },
                        company: { type: 'string', description: 'Company name' },
                        location: { type: 'string', description: 'Job location' },
                        remote_type: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'] },
                        description: { type: 'string', description: 'Brief job description (first 500 chars)' },
                        salary_min: { type: 'number' },
                        salary_max: { type: 'number' },
                        salary_currency: { type: 'string' },
                        employment_type: { type: 'string', enum: ['full-time', 'part-time', 'contract', 'internship'] },
                        seniority_level: { type: 'string' },
                        requirements: { type: 'array', items: { type: 'string' } },
                      },
                      required: ['title', 'company'],
                    },
                  },
                ],
              },
            }),
          });

          if (!searchResponse.ok) {
            console.error(`Search failed for "${title}":`, await searchResponse.text());
            continue;
          }

          const searchData = await searchResponse.json();
          const results = searchData.data || [];

          for (const result of results) {
            const extracted = result.json || {};
            const jobTitle = extracted.title || result.title || '';
            const company = extracted.company || '';
            const applyUrl = result.url || '';

            // Skip if no meaningful data
            if (!jobTitle || !company) continue;

            // Deduplicate by URL
            if (applyUrl && existingUrls.has(applyUrl)) continue;

            // Deduplicate by title+company
            const key = `${jobTitle.toLowerCase()}|${company.toLowerCase()}`;
            if (existingKeys.has(key)) continue;

            // Insert new job
            const { data: newJob, error: insertError } = await supabaseAdmin.from('jobs').insert({
              user_id: profile.user_id,
              title: jobTitle,
              company,
              location: extracted.location || '',
              remote_type: extracted.remote_type || 'unknown',
              description: extracted.description || (result.markdown || '').substring(0, 2000),
              salary_min: extracted.salary_min || null,
              salary_max: extracted.salary_max || null,
              salary_currency: extracted.salary_currency || null,
              employment_type: extracted.employment_type || 'full-time',
              seniority_level: extracted.seniority_level || '',
              requirements: (extracted.requirements || []) as any,
              apply_url: applyUrl,
            }).select('id, title, company').single();

            if (insertError) {
              console.error('Insert error:', insertError.message);
              continue;
            }

            // Add to dedup sets
            if (applyUrl) existingUrls.add(applyUrl);
            existingKeys.add(key);

            // Create notification
            await supabaseAdmin.from('notifications').insert({
              user_id: profile.user_id,
              title: 'New job found!',
              message: `${jobTitle} at ${company}`,
              type: 'new_job',
              entity_id: newJob?.id || null,
            });

            totalNewJobs++;
            console.log(`New job added: ${jobTitle} at ${company}`);
          }
        } catch (searchErr) {
          console.error(`Search error for "${title}":`, searchErr);
        }
      }
    }

    console.log(`Auto-search complete. Total new jobs: ${totalNewJobs}`);

    return new Response(JSON.stringify({ success: true, jobs_found: totalNewJobs }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Auto-search error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Auto-search failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
