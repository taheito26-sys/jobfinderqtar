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

    // --- Part 1b: Process generic scraper/RSS sources ---
    const { data: scraperSources } = await supabaseAdmin
      .from('job_sources')
      .select('*')
      .eq('enabled', true)
      .in('source_type', ['scraper', 'rss'])
      .not('source_name', 'ilike', '%linkedin%');

    const scraperSourcesByUser = new Map<string, any[]>();
    (scraperSources || []).forEach((s) => {
      const list = scraperSourcesByUser.get(s.user_id) || [];
      list.push(s);
      scraperSourcesByUser.set(s.user_id, list);
    });

    for (const userId of userIds) {
      const sources = scraperSourcesByUser.get(userId) || [];
      for (const source of sources) {
        const config = (source.config as any) || {};
        const baseUrl = config.base_url || '';
        if (!baseUrl) {
          await supabaseAdmin
            .from('job_sources')
            .update({
              config: { ...config, last_error: 'No base URL configured for this source.' },
            })
            .eq('id', source.id);
          continue;
        }

        try {
          const scrapeRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/scrape-job-url`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user_id: userId, url: baseUrl }),
          });

          const scrapeData = await scrapeRes.json().catch(() => ({}));
          if (!scrapeRes.ok || scrapeData?.error) {
            const message = scrapeData?.message || scrapeData?.error || `Scrape failed with HTTP ${scrapeRes.status}`;
            await supabaseAdmin
              .from('job_sources')
              .update({ config: { ...config, last_error: message } })
              .eq('id', source.id);
            console.warn(`Generic scrape failed for source ${source.source_name}:`, message);
            continue;
          }

          const rawJobs = Array.isArray(scrapeData?.jobs)
            ? scrapeData.jobs
            : scrapeData?.job
              ? [scrapeData.job]
              : [];

          if (rawJobs.length === 0) {
            const message = 'No jobs extracted from the configured base URL. Use a search/listing page URL if the homepage is empty.';
            await supabaseAdmin
              .from('job_sources')
              .update({ config: { ...config, last_error: message } })
              .eq('id', source.id);
            console.warn(`Generic scrape returned no jobs for source ${source.source_name}`);
            continue;
          }

          const normalizedJobs = rawJobs.map((job: any) => ({
            ...job,
            source_created_at: job.source_created_at || null,
          }));

          try {
            await recordLedgerSync(supabaseAdmin as any, userId, source.source_name, source.source_type, normalizedJobs, {
              baseUrl,
              configJson: { source: source.source_name, url: baseUrl },
              normalizationStatus: 'incomplete',
              runMode: 'collect',
            });
          } catch (ledgerErr) {
            console.warn(`Ledger sync failed for generic source ${source.source_name}:`, ledgerErr);
          }

          const { data: existingJobs } = await supabaseAdmin
            .from('jobs')
            .select('id, title, company, apply_url, source_url')
            .eq('user_id', userId)
            .eq('source_id', source.id);

          const existingKeys = new Set(
            (existingJobs || []).map((j: any) =>
              `${(j.apply_url || j.source_url || '').toLowerCase()}|${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}`
            )
          );

          let inserted = 0;
          for (const job of normalizedJobs) {
            const applyUrl = job.apply_url || baseUrl;
            const key = `${String(applyUrl).toLowerCase()}|${String(job.title || '').toLowerCase()}|${String(job.company || '').toLowerCase()}`;
            if (existingKeys.has(key)) continue;

            const { error: insErr } = await supabaseAdmin.from('jobs').insert({
              user_id: userId,
              source_id: source.id,
              source_platform: source.source_type,
              external_id: (job as any).external_id || (job as any).source_job_id || null,
              title: job.title || 'Untitled Job',
              company: job.company || 'Unknown Company',
              location: job.location || null,
              remote_type: job.remote_type || 'unknown',
              employment_type: job.employment_type || 'full-time',
              seniority_level: job.seniority_level || null,
              description: job.description || null,
              apply_url: applyUrl,
              source_url: baseUrl,
              posted_at: job.source_created_at || null,
              source_created_at: job.source_created_at || null,
              normalized: false,
              raw_data: job,
            });

            if (insErr) {
              console.error(`Generic insert failed for ${source.source_name}:`, insErr.message);
              continue;
            }

            inserted++;
            totalNewJobs++;
          }

          await supabaseAdmin
            .from('job_sources')
            .update({ config: { ...config, last_error: null } })
            .eq('id', source.id);

          if (inserted > 0) {
            console.log(`Generic source ${source.source_name}: inserted ${inserted} jobs`);
          }
        } catch (err: any) {
          const message = err?.message || String(err);
          await supabaseAdmin
            .from('job_sources')
            .update({ config: { ...config, last_error: message } })
            .eq('id', source.id);
          console.error(`Error scraping generic source ${source.source_name}:`, message);
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
