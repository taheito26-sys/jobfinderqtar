import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function searchFirecrawl(apiKey: string, query: string, limit = 5): Promise<any[]> {
  const res = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit, scrapeOptions: { formats: ['markdown'] } }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

async function scrapeUrl(apiKey: string, url: string): Promise<any[]> {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown', 'links'], onlyMainContent: true }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  // Extract job-like links from the careers page
  const links = data.data?.links || [];
  const markdown = data.data?.markdown || '';
  return [{ url, markdown, links, metadata: data.data?.metadata || {} }];
}

async function mapCareersPage(apiKey: string, url: string): Promise<string[]> {
  const res = await fetch('https://api.firecrawl.dev/v1/map', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, search: 'job career position opening', limit: 20, includeSubdomains: true }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.links || [];
}

function extractJobFromResult(result: any): { title: string; company: string; description: string; apply_url: string } | null {
  const rawTitle = result.metadata?.title || result.title || '';
  const titleParts = rawTitle.split(/\s[-–|@]\s/);
  const title = titleParts[0]?.trim() || '';
  const company = titleParts[1]?.trim() || '';
  if (!title) return null;
  return {
    title,
    company,
    description: (result.metadata?.description || result.markdown || '').substring(0, 2000),
    apply_url: result.url || '',
  };
}

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

    // Check if triggered for a specific subscription or all due ones
    let subscriptionFilter: any;
    try {
      const body = await req.json();
      if (body?.subscription_id) {
        subscriptionFilter = { id: body.subscription_id };
      }
    } catch { /* no body = process all due */ }

    let query = supabaseAdmin
      .from('job_subscriptions')
      .select('*')
      .eq('enabled', true);

    if (subscriptionFilter?.id) {
      query = query.eq('id', subscriptionFilter.id);
    } else {
      // Only process subscriptions that are due
      const now = new Date();
      query = query.or(`last_checked_at.is.null,last_checked_at.lt.${new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()}`);
    }

    const { data: subscriptions, error: subError } = await query;
    if (subError || !subscriptions?.length) {
      return new Response(JSON.stringify({ message: 'No subscriptions to process', processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalNewJobs = 0;

    for (const sub of subscriptions) {
      console.log(`Processing subscription: ${sub.name} (${sub.subscription_type})`);

      // Get existing jobs for dedup
      const { data: existingJobs } = await supabaseAdmin
        .from('jobs')
        .select('apply_url, title, company')
        .eq('user_id', sub.user_id);

      const existingUrls = new Set((existingJobs || []).map((j: any) => j.apply_url).filter(Boolean));
      const existingKeys = new Set((existingJobs || []).map((j: any) => `${j.title?.toLowerCase()}|${j.company?.toLowerCase()}`));

      let newJobsForSub = 0;

      try {
        if (sub.subscription_type === 'company') {
          // Search for company jobs
          const searchQuery = sub.country
            ? `${sub.name} jobs ${sub.country}`
            : `${sub.name} jobs`;
          const results = await searchFirecrawl(apiKey, searchQuery, 10);
          
          for (const result of results) {
            const job = extractJobFromResult(result);
            if (!job || !job.title) continue;
            if (!job.company) job.company = sub.name;
            
            if (job.apply_url && existingUrls.has(job.apply_url)) continue;
            const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
            if (existingKeys.has(key)) continue;

            const { data: newJob } = await supabaseAdmin.from('jobs').insert({
              user_id: sub.user_id,
              title: job.title,
              company: job.company,
              location: sub.country || '',
              remote_type: 'unknown',
              description: job.description,
              employment_type: 'full-time',
              apply_url: job.apply_url,
              raw_data: { source: 'subscription', subscription_id: sub.id } as any,
            }).select('id').single();

            if (newJob) {
              existingUrls.add(job.apply_url);
              existingKeys.add(key);
              newJobsForSub++;

              await supabaseAdmin.from('notifications').insert({
                user_id: sub.user_id,
                title: `New job from ${sub.name}`,
                message: `${job.title} at ${job.company}`,
                type: 'new_job',
                entity_id: newJob.id,
              });
            }
          }

        } else if (sub.subscription_type === 'careers_url') {
          // Scrape careers page and find job links
          const jobLinks = await mapCareersPage(apiKey, sub.url);
          
          // Filter to likely job URLs and limit
          const jobUrls = jobLinks
            .filter((link: string) => /job|career|position|opening|apply|vacanc/i.test(link))
            .filter((link: string) => !existingUrls.has(link))
            .slice(0, 10);

          for (const jobUrl of jobUrls) {
            // Search for each job URL to get metadata
            const results = await searchFirecrawl(apiKey, jobUrl, 1);
            if (results.length === 0) continue;

            const job = extractJobFromResult(results[0]);
            if (!job || !job.title) continue;
            if (!job.company) job.company = sub.name;

            const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
            if (existingKeys.has(key)) continue;

            const { data: newJob } = await supabaseAdmin.from('jobs').insert({
              user_id: sub.user_id,
              title: job.title,
              company: job.company,
              location: sub.country || '',
              remote_type: 'unknown',
              description: job.description,
              employment_type: 'full-time',
              apply_url: jobUrl,
              raw_data: { source: 'subscription', subscription_id: sub.id } as any,
            }).select('id').single();

            if (newJob) {
              existingUrls.add(jobUrl);
              existingKeys.add(key);
              newJobsForSub++;

              await supabaseAdmin.from('notifications').insert({
                user_id: sub.user_id,
                title: `New job from ${sub.name}`,
                message: `${job.title}`,
                type: 'new_job',
                entity_id: newJob.id,
              });
            }
          }

        } else if (sub.subscription_type === 'linkedin_company' || sub.subscription_type === 'linkedin_profile') {
          // Search LinkedIn for company/person jobs
          const searchQuery = sub.url
            ? `site:linkedin.com/jobs ${sub.name}`
            : `${sub.name} linkedin jobs ${sub.country || ''}`;
          const results = await searchFirecrawl(apiKey, searchQuery, 8);

          for (const result of results) {
            const job = extractJobFromResult(result);
            if (!job || !job.title) continue;
            if (!job.company) job.company = sub.name;

            if (job.apply_url && existingUrls.has(job.apply_url)) continue;
            const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
            if (existingKeys.has(key)) continue;

            const { data: newJob } = await supabaseAdmin.from('jobs').insert({
              user_id: sub.user_id,
              title: job.title,
              company: job.company,
              location: sub.country || '',
              remote_type: 'unknown',
              description: job.description,
              employment_type: 'full-time',
              apply_url: job.apply_url,
              raw_data: { source: 'subscription', subscription_id: sub.id, linkedin: true } as any,
            }).select('id').single();

            if (newJob) {
              existingUrls.add(job.apply_url);
              existingKeys.add(key);
              newJobsForSub++;

              await supabaseAdmin.from('notifications').insert({
                user_id: sub.user_id,
                title: `New LinkedIn job`,
                message: `${job.title} at ${job.company}`,
                type: 'new_job',
                entity_id: newJob.id,
              });
            }
          }

        } else if (sub.subscription_type === 'keyword_alert') {
          const searchQuery = sub.country
            ? `${sub.search_query} ${sub.country} job`
            : `${sub.search_query} job`;
          const results = await searchFirecrawl(apiKey, searchQuery, 10);

          for (const result of results) {
            const job = extractJobFromResult(result);
            if (!job || !job.title) continue;

            if (job.apply_url && existingUrls.has(job.apply_url)) continue;
            const key = `${job.title.toLowerCase()}|${(job.company || 'unknown').toLowerCase()}`;
            if (existingKeys.has(key)) continue;

            const { data: newJob } = await supabaseAdmin.from('jobs').insert({
              user_id: sub.user_id,
              title: job.title,
              company: job.company || 'Unknown',
              location: sub.country || '',
              remote_type: 'unknown',
              description: job.description,
              employment_type: 'full-time',
              apply_url: job.apply_url,
              raw_data: { source: 'subscription', subscription_id: sub.id } as any,
            }).select('id').single();

            if (newJob) {
              existingUrls.add(job.apply_url);
              existingKeys.add(key);
              newJobsForSub++;

              await supabaseAdmin.from('notifications').insert({
                user_id: sub.user_id,
                title: `New job alert`,
                message: `${job.title} at ${job.company || 'Unknown'}`,
                type: 'new_job',
                entity_id: newJob.id,
              });
            }
          }
        }
      } catch (err) {
        console.error(`Error processing subscription ${sub.id}:`, err);
      }

      // Update subscription stats
      await supabaseAdmin.from('job_subscriptions').update({
        last_checked_at: new Date().toISOString(),
        jobs_found_total: (sub.jobs_found_total || 0) + newJobsForSub,
      }).eq('id', sub.id);

      totalNewJobs += newJobsForSub;
      console.log(`Subscription ${sub.name}: ${newJobsForSub} new jobs`);
    }

    return new Response(JSON.stringify({
      success: true,
      processed: subscriptions.length,
      new_jobs: totalNewJobs,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('check-subscriptions error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
