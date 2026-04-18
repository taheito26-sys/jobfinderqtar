/**
 * Multi-source Qatar job search orchestrator.
 *
 * Runs LinkedIn, Indeed, Bayt.com, and GulfTalent in parallel.
 * Each source is wrapped in a 12-second timeout - if one hangs or
 * fails, the others still return results.
 *
 * Deduplication:
 *   1. Exact URL match (after stripping tracking query params)
 *   2. Normalized title + company fingerprint
 */

import { fetchProfileAwareLinkedInSearch, type LinkedInProfileContext } from "./linkedin-profile-search.ts";
import { searchIndeedQatar } from "./indeed-search.ts";
import { searchBaytQatar } from "./bayt-search.ts";
import { searchGulfTalent } from "./gulftalent-search.ts";

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
  linkedin_job_id?: string | null;
  external_id?: string | null;
  remote_type: string;
  employment_type: string;
  seniority_level: string;
  normalization_status: "valid" | "incomplete";
  raw_data?: any;
}

function cleanUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    for (const p of ["jk", "fccid", "vjs", "tk", "from", "referer", "trk", "trkInfo", "utm_source", "utm_medium", "utm_campaign"]) {
      u.searchParams.delete(p);
    }
    return u.origin + u.pathname;
  } catch {
    return url.split("?")[0];
  }
}

function fingerprint(title: string, company: string): string {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
  return `${normalize(title)}|${normalize(company)}`;
}

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

async function fetchLinkedIn(
  keywords: string,
  location: string,
  limit: number,
  profile?: LinkedInProfileContext | null
): Promise<MultiSourceJob[]> {
  const { jobs } = await fetchProfileAwareLinkedInSearch({ keywords, location, limit, profile });
  return jobs.map((job) => ({
    ...job,
    source_platform: "linkedin" as JobSource,
    source_created_at: String(job.source_created_at || null) || null,
    remote_type: String(job.remote_type || "unknown"),
    employment_type: String(job.employment_type || "full-time"),
    seniority_level: String(job.seniority_level || ""),
    normalization_status: "incomplete" as const,
  }));
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

export interface MultiSourceSearchOptions {
  keywords: string;
  location?: string;
  limit?: number;
  perSourceLimit?: number;
  sources?: {
    linkedin?: boolean;
    indeed?: boolean;
    bayt?: boolean;
    gulftalent?: boolean;
  };
  profile?: LinkedInProfileContext | null;
}

export interface MultiSourceSearchResult {
  jobs: MultiSourceJob[];
  counts: Record<JobSource | string, number>;
  total: number;
  sources_queried: string[];
  sources_with_results: string[];
}

export async function searchAllSources(
  opts: MultiSourceSearchOptions
): Promise<MultiSourceSearchResult> {
  const {
    keywords,
    location = "Qatar",
    limit = 50,
    perSourceLimit = 25,
    sources = { linkedin: true, indeed: true, bayt: true, gulftalent: true },
    profile = null,
  } = opts;

  console.log(
    `[MultiSource] Searching "${keywords}" | location="${location}" | sources=${JSON.stringify(sources)}`
  );

  const fetches: Promise<{ source: string; jobs: MultiSourceJob[] }>[] = [];

  if (sources.linkedin !== false) {
    fetches.push(
      withTimeout(fetchLinkedIn(keywords, location, perSourceLimit, profile), "LinkedIn").then(
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
