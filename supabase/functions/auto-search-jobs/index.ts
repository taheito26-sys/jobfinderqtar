import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { recordLedgerSync } from '../_shared/hardline-ledger.ts';

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
      .select('user_id, desired_titles, location, country, remote_preference')
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

    const userIds = [...new Set(profiles.map((profile) => profile.user_id))];
    const { data: preferences } = await supabaseAdmin
      .from('user_preferences')
      .select('user_id, key, value')
      .in('user_id', userIds)
      .in('key', ['auto_search_enabled', 'auto_search_max_titles', 'auto_notify_new']);

    const preferenceMap = new Map<string, Record<string, string>>();
    (preferences || []).forEach((preference) => {
      const existing = preferenceMap.get(preference.user_id) ?? {};
      existing[preference.key] = preference.value;
      preferenceMap.set(preference.user_id, existing);
    });

    let totalNewJobs = 0;

    for (const profile of profiles) {
      const userPrefs = preferenceMap.get(profile.user_id) ?? {};
      if (userPrefs.auto_search_enabled !== 'true') continue;

      const titles = (profile.desired_titles as string[]) || [];
      if (titles.length === 0) continue;

      const location = profile.location || profile.country || '';
      const remotePreference = profile.remote_preference || 'flexible';
      const maxTitles = Math.max(1, Math.min(parseInt(userPrefs.auto_search_max_titles || '3', 10) || 3, titles.length));
      const shouldNotify = userPrefs.auto_notify_new !== 'false';

      // Get existing job URLs for this user to deduplicate
      const { data: existingJobs } = await supabaseAdmin
        .from('jobs')
        .select('apply_url, title, company')
        .eq('user_id', profile.user_id);

      const existingUrls = new Set((existingJobs || []).map(j => j.apply_url).filter(Boolean));
      const existingKeys = new Set((existingJobs || []).map(j => `${j.title?.toLowerCase()}|${j.company?.toLowerCase()}`));

      for (const title of titles.slice(0, maxTitles)) {
        const queryParts = [title];
        if (remotePreference === 'remote') queryParts.push('remote');
        if (location) queryParts.push(location);
        queryParts.push('job listing');
        const searchQuery = queryParts.join(' ');
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
                formats: ['markdown'],
              },
            }),
          });

          if (!searchResponse.ok) {
            console.error(`Search failed for "${title}":`, await searchResponse.text());
            continue;
          }

          const searchData = await searchResponse.json();
          const results = searchData.data || [];
          const ledgerJobs = results.map((result: any) => {
            const markdown = result.markdown || '';
            const rawTitle = result.metadata?.title || result.title || '';
            const titleParts = rawTitle.split(/\s[-â€“|@]\s/);
            return {
              title: titleParts[0]?.trim() || '',
              company: titleParts[1]?.trim() || '',
              location,
              description: (result.metadata?.description || markdown).substring(0, 2000),
              apply_url: result.url || '',
              source_url: result.url || '',
              source_created_at: result.metadata?.publishedDate
                || result.metadata?.datePublished
                || result.metadata?.datePosted
                || null,
              normalization_status: 'incomplete',
            };
          }).filter((job: any) => job.title && job.company);

          try {
            await recordLedgerSync(supabaseAdmin as any, profile.user_id, 'auto-search-jobs', 'scheduled-search', ledgerJobs, {
              baseUrl: 'https://api.firecrawl.dev/v1/search',
              configJson: {
                search_title: title,
                search_location: location,
                remote_preference: remotePreference,
              },
              normalizationStatus: 'incomplete',
              runMode: 'collect',
            });
          } catch (ledgerError) {
            console.warn(`Ledger sync failed for auto-search "${title}":`, ledgerError);
          }

          for (const result of results) {
            const markdown = result.markdown || '';
            const rawTitle = result.metadata?.title || result.title || '';
            const titleParts = rawTitle.split(/\s[-–|@]\s/);
            const jobTitle = titleParts[0]?.trim() || '';
            const company = titleParts[1]?.trim() || '';
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
              location,
              remote_type: remotePreference === 'remote' ? 'remote' : 'unknown',
              description: (result.metadata?.description || markdown).substring(0, 2000),
              salary_min: null,
              salary_max: null,
              salary_currency: null,
              employment_type: 'full-time',
              seniority_level: '',
              requirements: [],
              apply_url: applyUrl,
              source_url: applyUrl,
              raw_data: {
                source: 'auto_search',
                search_title: title,
                search_location: location,
                remote_preference: remotePreference,
              } as any,
            }).select('id, title, company').single();

            if (insertError) {
              console.error('Insert error:', insertError.message);
              continue;
            }

            // Add to dedup sets
            if (applyUrl) existingUrls.add(applyUrl);
            existingKeys.add(key);

            // Create notification
            if (shouldNotify) {
              await supabaseAdmin.from('notifications').insert({
                user_id: profile.user_id,
                title: 'New job found!',
                message: `${jobTitle} at ${company}`,
                type: 'new_job',
                entity_id: newJob?.id || null,
              });
            }

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
  } catch (error: unknown) {
    console.error('Auto-search error:', error);
    const msg = error instanceof Error ? error.message : 'Auto-search failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
