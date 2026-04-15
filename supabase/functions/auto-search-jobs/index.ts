import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { recordLedgerSync } from '../_shared/hardline-ledger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get all users with desired_titles set
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles_v2')
      .select('user_id, desired_titles, location, country, remote_preference')
      .not('desired_titles', 'eq', '[]');

    if (profilesError) throw profilesError;
    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ message: 'No profiles to process', jobs_found: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userIds = [...new Set(profiles.map((profile) => profile.user_id))];
    const { data: preferences } = await supabaseAdmin
      .from('user_preferences')
      .select('user_id, key, value')
      .in('user_id', userIds);

    const preferenceMap = new Map<string, Record<string, string>>();
    (preferences || []).forEach((p) => {
      const existing = preferenceMap.get(p.user_id) ?? {};
      existing[p.key] = p.value;
      preferenceMap.set(p.user_id, existing);
    });

    let totalNewJobs = 0;

    // --- Part 1: Process LinkedIn Specific Sources (from previous Turn) ---
    const { data: linkedinSources } = await supabaseAdmin
      .from('job_sources')
      .select('*')
      .eq('enabled', true)
      .or('source_name.ilike.%linkedin%,source_type.ilike.%linkedin%');

    const sourcesByUser = new Map<string, any[]>();
    (linkedinSources || []).forEach(s => {
      const list = sourcesByUser.get(s.user_id) || [];
      list.push(s);
      sourcesByUser.set(s.user_id, list);
    });

    for (const userId of userIds) {
      const sources = sourcesByUser.get(userId) || [];
      for (const source of sources) {
        try {
          const pipelineRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/linkedin-sync-pipeline`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_id: userId, source_id: source.id, run_mode: 'scheduled' })
          });
          if (pipelineRes.ok) {
            const data = await pipelineRes.json();
            totalNewJobs += (data.new_stage_count || 0);
          }
        } catch (err) {
          console.error(`LinkedIn pipeline failed for source ${source.id}:`, err.message);
        }
      }
    }

    // --- Part 2: Process Profile-driven Auto-Discovery ---
    const { linkedinProvider } = await import("../_shared/linkedin-provider.ts");

    for (const profile of profiles) {
      const userPrefs = preferenceMap.get(profile.user_id) ?? {};
      if (userPrefs.auto_search_enabled !== 'true') continue;

      const titles = (profile.desired_titles as string[]) || [];
      const location = profile.location || profile.country || '';
      const remotePreference = profile.remote_preference || 'flexible';
      const maxTitles = Math.max(1, Math.min(parseInt(userPrefs.auto_search_max_titles || '1', 10) || 1, titles.length));
      
      for (const title of titles.slice(0, maxTitles)) {
        console.log(`Auto-discovery for user ${profile.user_id}: "${title}" in "${location}"`);
        
        try {
          const searchResult = await linkedinProvider.searchJobs({
            keywords: title,
            location,
            remotePreference: remotePreference === 'remote' ? 'remote' : 'flexible',
            limit: 5,
          });

          if (!searchResult.success || !searchResult.jobs) {
            console.error(`Auto-discovery failed for "${title}":`, searchResult.error);
            continue;
          }

          // Record in ledger
          try {
            await recordLedgerSync(supabaseAdmin as any, profile.user_id, 'auto-search-jobs', 'scheduled-search', searchResult.jobs, {
              baseUrl: 'linkedin-native',
              configJson: { title, location, remotePreference },
              normalizationStatus: 'incomplete',
              runMode: 'collect',
            });
          } catch (e) {
            console.warn(`Ledger sync failed for "${title}":`, e);
          }

          for (const job of searchResult.jobs) {
            // Check for existing job
            const { data: existing } = await supabaseAdmin
              .from('jobs')
              .select('id')
              .eq('user_id', profile.user_id)
              .eq('linkedin_job_id', job.linkedin_job_id)
              .maybeSingle();

            if (existing) continue;

            // Insert new job
            const { data: newJob, error: insErr } = await supabaseAdmin.from('jobs').insert({
              user_id: profile.user_id,
              linkedin_job_id: job.linkedin_job_id,
              source_platform: 'linkedin',
              title: job.title,
              company: job.company,
              location: job.location,
              remote_type: job.remote_type,
              description: job.description,
              apply_url: job.apply_url,
              source_url: job.source_url,
              source_created_at: job.source_created_at,
              raw_source_card: job.raw_data?.snippet?.raw_card_payload || null,
            }).select('id').single();

            if (insErr) {
              console.error('Job insertion failed:', insErr.message);
              continue;
            }

            // Create notification
            if (userPrefs.auto_notify_new !== 'false') {
              await supabaseAdmin.from('notifications').insert({
                user_id: profile.user_id,
                title: 'New job found!',
                message: `${job.title} at ${job.company}`,
                type: 'new_job',
                entity_id: newJob.id,
              });
            }

            totalNewJobs++;
          }
        } catch (err) {
          console.error(`Error in discovery loop for "${title}":`, err.message);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, jobs_found: totalNewJobs }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Auto-search error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Auto-search failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
