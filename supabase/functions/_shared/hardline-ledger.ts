type LedgerJob = {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  apply_url?: string | null;
  source_url?: string | null;
  source_created_at?: string | null;
};

function normalizeText(value: string | null | undefined) {
  return (value || "").trim();
}

function normalizeUrl(value: string | null | undefined) {
  if (!value) return "";

  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "ref", "refid"].forEach((param) => {
      url.searchParams.delete(param);
    });
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    const search = url.searchParams.toString();
    return `${url.hostname.toLowerCase()}${normalizedPath.toLowerCase()}${search ? `?${search}` : ""}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function buildSourceJobId(job: LedgerJob) {
  return normalizeUrl(job.apply_url || job.source_url || "")
    || `${normalizeText(job.title).toLowerCase()}|${normalizeText(job.company).toLowerCase()}|${normalizeText(job.location).toLowerCase()}`;
}

export async function ensureLedgerSource(
  supabaseClient: any,
  userId: string,
  sourceName: string,
  sourceType: string,
  baseUrl = "",
  configJson: Record<string, unknown> = {},
) {
  const { data: existing } = await supabaseClient
    .from("sources")
    .select("id, active_flag")
    .eq("user_id", userId)
    .eq("source_name", sourceName)
    .maybeSingle();

  if (existing?.id) {
    if (existing.active_flag === false) return null;
    return existing.id as string;
  }

  const { data, error } = await supabaseClient
    .from("sources")
    .insert({
      user_id: userId,
      source_name: sourceName,
      adapter_type: sourceType,
      base_url: baseUrl,
      active_flag: true,
      auth_mode: "none",
      config_json: configJson,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function recordLedgerSync(
  supabaseClient: any,
  userId: string,
  sourceName: string,
  sourceType: string,
  jobs: LedgerJob[],
  options: {
    baseUrl?: string;
    configJson?: Record<string, unknown>;
    runMode?: string;
    normalizationStatus?: string;
  } = {},
) {
  const sourceId = await ensureLedgerSource(
    supabaseClient,
    userId,
    sourceName,
    sourceType,
    options.baseUrl || "",
    options.configJson || {},
  );

  if (!sourceId) {
    return { sourceId: null, runId: null, skipped: true };
  }

  const { data: run, error: runError } = await supabaseClient
    .from("source_sync_runs")
    .insert({
      user_id: userId,
      source_id: sourceId,
      run_mode: options.runMode || "collect",
      started_at: new Date().toISOString(),
      status: "running",
      jobs_seen_count: jobs.length,
      jobs_inserted_count: 0,
      jobs_updated_count: 0,
      jobs_invalid_count: 0,
      errors_json: [],
    })
    .select("id")
    .single();

  if (runError) throw runError;

  const rawRows = jobs.map((job) => ({
    user_id: userId,
    source_id: sourceId,
    source_job_id: buildSourceJobId(job),
    raw_payload_json: {
      source: sourceName,
      source_type: sourceType,
      normalization_status: options.normalizationStatus || "incomplete",
      job,
    },
    raw_html_path: "",
    checksum: hashString(JSON.stringify(job)),
  }));

  const invalidCount = jobs.filter((job) => (options.normalizationStatus || String((job as any).normalization_status || "incomplete")) !== "valid").length;
  const insertedCount = Math.max(0, jobs.length - invalidCount);

  if (rawRows.length > 0) {
    const { error: rawError } = await supabaseClient.from("raw_jobs").upsert(rawRows, {
      onConflict: "source_id,source_job_id",
    });
    if (rawError) throw rawError;
  }

  await supabaseClient
    .from("source_sync_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: "completed",
      jobs_inserted_count: insertedCount,
      jobs_invalid_count: invalidCount,
    })
    .eq("id", run.id);

  return { sourceId, runId: run.id as string };
}
