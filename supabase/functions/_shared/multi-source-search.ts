/**
 * Multi-source Qatar job search orchestrator.
 *
 * Runs LinkedIn, Indeed, Bayt.com, and GulfTalent in parallel.
 * Each source is wrapped in a 12-second timeout — if one hangs or
 * fails, the others still return results.
 *
 * Deduplication:
 *   1. Exact URL match (after stripping tracking query params)
 *   2. Normalized title + company fingerprint
 *
 * Output format is a unified `MultiSourceJob` that is compatible
 * with the normalizeLinkedInJob output used by the existing frontend.
 */

import { fetchLinkedInSearch } from "./linkedin-search.ts";
import { normalizeLinkedInJob } from "./linkedin-normalize.ts";
import { searchIndeedQatar } from "./indeed-search.ts";
import { searchBaytQatar } from "./bayt-search.ts";
import { searchGulfTalent } from "./gulftalent-search.ts";

// ─── Unified job type ─────────────────────────────────────────────────────────

export type JobSource = "linkedin" | "indeed" | "bayt" | "gulftalent";

export interface MultiSourceJob {
  title: string;
  company: string;
  location: string;
  apply_url: string;
  source_url?: string;
  description?: string;
  source_created_at: string | null;
  source_platform: JobSource | string;
  /** LinkedIn-specific — null for non-LinkedIn sources */
  linkedin_job_id?: string | null;
  /** Platform-native job ID */
  external_id?: string | null;
  remote_type: string;
  employment_type: string;
  seniority_level: string;
  normalization_status: "valid" | "incomplete";
  raw_data?: any;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip tracking query params for dedup purposes. */
function cleanUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    // Remove common tracking params
    for (const p of ["jk", "fccid", "vjs", "tk", "from", "referer", "trk", "trkInfo", "utm_source", "utm_medium", "utm_campaign"]) {
      u.searchParams.delete(p);
    }
    return u.origin + u.pathname;
  } catch {
    return url.split("?")[0];
  }
}

/** Normalize a string for fingerprint comparison. */
function fingerprint(title: string, company: string): string {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
  return `${normalize(title)}|${normalize(company)}`;
}

/** Deduplicate a list of jobs — URL-first, then title+company fallback. */
function deduplicate(jobs: MultiSourceJob[]): MultiSourceJob[] {
  const seenUrl = new Set<string>();
  const seenFp = new Set<string>();
  const result: MultiSourceJob[] = [];

  for (const job of jobs) {
    const url = cleanUrl(job.apply_url || job.source_url || "");
    const fp = fingerprint(job.title, job.company);

    if (url && seenUrl.has(url)) continue;
    if (seenFp.has(fp)) continue;

    if (url) seenUrl.add(url);
    seenFp.add(fp);
    result.push(job);
  }

  return result;
}

/** Wrap a source fetch in a timeout — bad source can't stall everything. */
async function withTimeout<T>(
  promise: Promise<T[]>,
  source: string,
  timeoutMs = 12_000
): Promise<T[]> {
  const timer = new Promise<T[]>((resolve) =>
    setTimeout(() => {
      console.warn(`[MultiSource] ${source} timed out after ${timeoutMs}ms`);
      resolve([]);
    }, timeoutMs)
  );
  try {
    return await Promise.race([promise, timer]);
  } catch (err: any) {
    console.error(`[MultiSource] ${source} threw: ${err.message}`);
    return [];
  }
}

// ─── Source adapters ──────────────────────────────────────────────────────────

async function fetchLinkedIn(
  keywords: string,
  location: string,
  limit: number
): Promise<MultiSourceJob[]> {
  const snippets = await fetchLinkedInSearch({ keywords, location, limit });
  return snippets.map((s) => {
    const n = normalizeLinkedInJob(s);
    return {
      ...n,
      source_platform: "linkedin" as JobSource,
      source_created_at: n.source_created_at || null,
      remote_type: n.remote_type || "unknown",
      employment_type: n.employment_type || "full-time",
      seniority_level: n.seniority_level || "",
      normalization_status: "incomplete" as const,
    };
  });
}

async function fetchIndeed(
  keywords: string,
  location: string,
  limit: number
): Promise<MultiSourceJob[]> {
  const jobs = await searchIndeedQatar(keywords, location, limit);
  return jobs.map((j) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    apply_url: j.apply_url,
    description: j.description,
    source_created_at: j.source_created_at,
    source_platform: "indeed" as JobSource,
    linkedin_job_id: null,
    external_id: j.external_id,
    remote_type: "unknown",
    employment_type: "full-time",
    seniority_level: "",
    normalization_status: "incomplete" as const,
    raw_data: { source: "indeed" },
  }));
}

async function fetchBayt(
  keywords: string,
  limit: number
): Promise<MultiSourceJob[]> {
  const jobs = await searchBaytQatar(keywords, limit);
  return jobs.map((j) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    apply_url: j.apply_url,
    description: j.description,
    source_created_at: j.source_created_at,
    source_platform: "bayt" as JobSource,
    linkedin_job_id: null,
    external_id: j.external_id,
    remote_type: "unknown",
    employment_type: "full-time",
    seniority_level: "",
    normalization_status: "incomplete" as const,
    raw_data: { source: "bayt" },
  }));
}

async function fetchGulfTalent(
  keywords: string,
  limit: number
): Promise<MultiSourceJob[]> {
  const jobs = await searchGulfTalent(keywords, limit);
  return jobs.map((j) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    apply_url: j.apply_url,
    description: j.description,
    source_created_at: j.source_created_at,
    source_platform: "gulftalent" as JobSource,
    linkedin_job_id: null,
    external_id: j.external_id,
    remote_type: "unknown",
    employment_type: "full-time",
    seniority_level: "",
    normalization_status: "incomplete" as const,
    raw_data: { source: "gulftalent" },
  }));
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export interface MultiSourceSearchOptions {
  keywords: string;
  /** Target country/location — defaults to "Qatar" */
  location?: string;
  /** Max total results (after dedup) */
  limit?: number;
  /** Per-source limit (before dedup) */
  perSourceLimit?: number;
  /** Which sources to enable */
  sources?: {
    linkedin?: boolean;
    indeed?: boolean;
    bayt?: boolean;
    gulftalent?: boolean;
  };
}

export interface MultiSourceSearchResult {
  jobs: MultiSourceJob[];
  counts: Record<JobSource | string, number>;
  total: number;
  sources_queried: string[];
  sources_with_results: string[];
}

/**
 * Run all job sources in parallel, merge, deduplicate, and return.
 *
 * Each source failure is isolated — one error doesn't kill the rest.
 * Ordering: LinkedIn first, then other sources ranked by recency.
 */
export async function searchAllSources(
  opts: MultiSourceSearchOptions
): Promise<MultiSourceSearchResult> {
  const {
    keywords,
    location = "Qatar",
    limit = 50,
    perSourceLimit = 25,
    sources = { linkedin: true, indeed: true, bayt: true, gulftalent: true },
  } = opts;

  console.log(
    `[MultiSource] Searching "${keywords}" | location="${location}" | sources=${JSON.stringify(sources)}`
  );

  // Launch all enabled sources concurrently
  const fetches: Promise<{ source: string; jobs: MultiSourceJob[] }>[] = [];

  if (sources.linkedin !== false) {
    fetches.push(
      withTimeout(fetchLinkedIn(keywords, location, perSourceLimit), "LinkedIn").then(
        (jobs) => ({ source: "linkedin", jobs })
      )
    );
  }
  if (sources.indeed !== false) {
    fetches.push(
      withTimeout(fetchIndeed(keywords, location, perSourceLimit), "Indeed").then(
        (jobs) => ({ source: "indeed", jobs })
      )
    );
  }
  if (sources.bayt !== false) {
    fetches.push(
      withTimeout(fetchBayt(keywords, perSourceLimit), "Bayt").then(
        (jobs) => ({ source: "bayt", jobs })
      )
    );
  }
  if (sources.gulftalent !== false) {
    fetches.push(
      withTimeout(fetchGulfTalent(keywords, perSourceLimit), "GulfTalent").then(
        (jobs) => ({ source: "gulftalent", jobs })
      )
    );
  }

  const settled = await Promise.all(fetches);

  // Collect per-source counts
  const counts: Record<string, number> = {};
  const allJobs: MultiSourceJob[] = [];
  const sourcesQueried: string[] = [];
  const sourcesWithResults: string[] = [];

  for (const { source, jobs } of settled) {
    sourcesQueried.push(source);
    counts[source] = jobs.length;
    if (jobs.length > 0) sourcesWithResults.push(source);
    allJobs.push(...jobs);
  }

  console.log(
    `[MultiSource] Raw counts: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`
  );

  // Deduplicate then truncate to limit
  const deduped = deduplicate(allJobs).slice(0, limit);

  console.log(
    `[MultiSource] After dedup: ${deduped.length} jobs (from ${allJobs.length} raw)`
  );

  return {
    jobs: deduped,
    counts,
    total: deduped.length,
    sources_queried: sourcesQueried,
    sources_with_results: sourcesWithResults,
  };
}
