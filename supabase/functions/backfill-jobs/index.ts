import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type JobRow = {
  id: string;
  user_id: string;
  apply_url: string | null;
  source_url: string | null;
  description: string | null;
};

type MatchRow = {
  job_id: string;
};

function hasMeaningfulDescription(value?: string | null) {
  return Boolean(String(value || "").trim().length >= 250);
}

async function invokeFunction(functionName: string, serviceRoleKey: string, payload: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) throw new Error("Missing service role key");

    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const isServiceRole = bearerToken === serviceRoleKey;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey
    );

    let scopeUserId: string | null = null;
    let jobIds: string[] = Array.isArray(body.job_ids)
      ? [...new Set(body.job_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean))]
      : [];

    if (!isServiceRole) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await userClient.auth.getUser().catch(() => ({ data: { user: null } }));
      if (user) {
        scopeUserId = user.id;
      }
    } else if (typeof body.user_id === "string" && body.user_id.trim()) {
      scopeUserId = body.user_id.trim();
    }

    let jobsQuery = admin
      .from("jobs")
      .select("id, user_id, apply_url, source_url, description")
      .order("created_at", { ascending: false });

    if (jobIds.length > 0) {
      jobsQuery = jobsQuery.in("id", jobIds);
      if (scopeUserId) jobsQuery = jobsQuery.eq("user_id", scopeUserId);
    } else if (scopeUserId) {
      jobsQuery = jobsQuery.eq("user_id", scopeUserId);
    }

    const [jobsRes, matchesRes] = await Promise.all([
      jobsQuery,
      scopeUserId
        ? admin.from("job_matches").select("job_id").eq("user_id", scopeUserId)
        : admin.from("job_matches").select("job_id"),
    ]);

    if (jobsRes.error) throw jobsRes.error;
    if (matchesRes.error) throw matchesRes.error;

    const jobs = (jobsRes.data ?? []) as JobRow[];
    const matchIds = new Set((matchesRes.data ?? []).map((match: MatchRow) => match.job_id));

    const targets = jobs.filter((job) => !hasMeaningfulDescription(job.description) || !matchIds.has(job.id));

    let hydrated = 0;
    let scored = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of targets) {
      const url = String(job.apply_url || job.source_url || "").trim();
      const needsHydration = !hasMeaningfulDescription(job.description) && Boolean(url);
      const needsScore = !matchIds.has(job.id) || needsHydration;

      if (needsHydration) {
        const hydrateResult = await invokeFunction("scrape-job-url", serviceRoleKey, {
          user_id: job.user_id,
          job_id: job.id,
          url,
        });

        if (hydrateResult.ok && !hydrateResult.data?.error) hydrated += 1;
        else if (hydrateResult.data?.fallback) skipped += 1;
        else failed += 1;
      }

      if (needsScore) {
        const scoreResult = await invokeFunction("score-job", serviceRoleKey, {
          user_id: job.user_id,
          job_id: job.id,
        });

        if (scoreResult.ok && !scoreResult.data?.error) scored += 1;
        else if (scoreResult.data?.error) failed += 1;
        else failed += 1;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      hydrated,
      scored,
      skipped,
      failed,
      processed: targets.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("backfill-jobs error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || "Backfill failed" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
