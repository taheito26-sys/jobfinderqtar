/**
 * Multi-source Qatar job search orchestrator.
 *
 * Runs LinkedIn, Indeed, Bayt.com, and GulfTalent in parallel.
 * Each source is wrapped in a 12-second timeout - if one hangs or
 * fails, the others still return results.
 *
 * Profile awareness:
 *   - All sources (not just LinkedIn) expand the keyword into up to 3 title
 *     variants derived from the user's profile (desired titles + headline).
 *   - All sources score every result against the profile using
 *     scoreLinkedInJobAgainstProfile (a generic scorer over title/company/
 *     location/description). Results below the relevance threshold are
 *     dropped when a profile is present; remaining results are ranked by score.
 *
 * Deduplication:
 *   1. Exact URL match (after stripping tracking query params)
 *   2. Normalized title + company fingerprint
 */

import {
  fetchProfileAwareLinkedInSearch,
  buildLinkedInSearchVariants,
  scoreLinkedInJobAgainstProfile,
  type LinkedInProfileContext,
} from "./linkedin-profile-search.ts";
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
  relevance_score?: number;
  raw_data?: any;
}

const EXTERNAL_VARIANT_LIMIT = 3;          // variants per external source
const EXTERNAL_RELEVANCE_THRESHOLD = 20;   // min score to keep when profile exists

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

  // Sort by relevance_score (desc) first so the best-scored copy wins on dedupe.
  const sorted = [...jobs].sort(
    (a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  );

  for (const job of sorted) {
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

/**
 * Build the list of keyword variants to use for external sources.
 * Without a profile: just the raw keyword.
 * With a profile:   top-N title variants derived from desiredTitles/headline/keyword.
 */
function buildExternalVariants(
  keywords: string,
  profile?: LinkedInProfileContext | null
): string[] {
  if (!profile) return [keywords];
  const all = buildLinkedInSearchVariants({ keywords, profile });
  const capped = all.slice(0, EXTERNAL_VARIANT_LIMIT);
  return capped.length > 0 ? capped : [keywords];
}

/**
 * Score + filter + rank an external-source result set against the profile.
 * When no profile is present, returns the input unchanged (no filtering).
 */
function rankExternalAgainstProfile(
  jobs: MultiSourceJob[],
  profile?: LinkedInProfileContext | null
): MultiSourceJob[] {
  if (!profile) return jobs;
  const scored = jobs.map((j) => ({
    ...j,
    relevance_score: scoreLinkedInJobAgainstProfile(j as unknown as Record<string, unknown>, profile),
  }));
  const kept = scored.filter((j) => (j.relevance_score ?? 0) >= EXTERNAL_RELEVANCE_THRESHOLD);
  // If profile filtering drops everything, fall back to the scored-but-unfiltered list so the
  // user still sees *something* from that source (ranked by score).
  const ranked = (kept.length > 0 ? kept : scored).sort(
    (a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
  );
  return ranked;
}

async function fetchLinkedIn(
  keywords: string,
  location: string,
  limit: number,
  profile?: LinkedInProfileContext | null
): Promise<MultiSourceJob[]> {
  const { jobs } = await fetchProfileAwareLinkedInSearch({ keywords, location, limit, profile });
  return jobs.map((job) => ({
    ...(job as any),
    source_platform: "linkedin" as JobSource,
    source_created_at: String((job as any).source_created_at || null) || null,
    remote_type: String((job as any).remote_type || "unknown"),
    employment_type: String((job as any).employment_type || "full-time"),
    seniority_level: String((job as any).seniority_level || ""),
    normalization_status: "incomplete" as const,
    relevance_score: profile ? scoreLinkedInJobAgainstProfile(job, profile) : undefined,
  }));
}

async function fetchIndeed(
  keywords: string,
  location: string,
  limit: number,
  profile?: LinkedInProfileContext | null
): Promise<MultiSourceJob[]> {
  const variants = buildExternalVariants(keywords, profile);
  const perVariant = Math.max(5, Math.ceil(limit / variants.length));
  const all: MultiSourceJob[] = [];

  for (const variant of variants) {
    try {
      const jobs = await searchIndeedQatar(variant, location, perVariant);
      for (const j of jobs) {
        all.push({
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
          raw_data: { source: "indeed", search_variant: variant },
        });
      }
    } catch (err: any) {
      console.warn(`[Indeed] variant "${variant}" failed: ${err?.message || err}`);
    }
  }

  return rankExternalAgainstProfile(all, profile).slice(0, limit);
}

async function fetchBayt(
  keywords: string,
  limit: number,
  profile?: LinkedInProfileContext | null
): Promise<MultiSourceJob[]> {
  const variants = buildExternalVariants(keywords, profile);
  const perVariant = Math.max(5, Math.ceil(limit / variants.length));
  const all: MultiSourceJob[] = [];

  for (const variant of variants) {
    try {
      const jobs = await searchBaytQatar(variant, perVariant);
      for (const j of jobs) {
        all.push({
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
          raw_data: { source: "bayt", search_variant: variant },
        });
      }
    } catch (err: any) {
      console.warn(`[Bayt] variant "${variant}" failed: ${err?.message || err}`);
    }
  }

  return rankExternalAgainstProfile(all, profile).slice(0, limit);
}

async function fetchGulfTalent(
  keywords: string,
  limit: number,
  profile?: LinkedInProfileContext | null
): Promise<MultiSourceJob[]> {
  const variants = buildExternalVariants(keywords, profile);
  const perVariant = Math.max(5, Math.ceil(limit / variants.length));
  const all: MultiSourceJob[] = [];

  for (const variant of variants) {
    try {
      const jobs = await searchGulfTalent(variant, perVariant);
      for (const j of jobs) {
        all.push({
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
          raw_data: { source: "gulftalent", search_variant: variant },
        });
      }
    } catch (err: any) {
      console.warn(`[GulfTalent] variant "${variant}" failed: ${err?.message || err}`);
    }
  }

  return rankExternalAgainstProfile(all, profile).slice(0, limit);
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
  profile_applied: boolean;
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

  const profileApplied = !!profile;
  console.log(
    `[MultiSource] Searching "${keywords}" | location="${location}" | profile=${profileApplied} | sources=${JSON.stringify(sources)}`
  );
  if (profileApplied) {
    const variants = buildLinkedInSearchVariants({ keywords, profile }).slice(0, EXTERNAL_VARIANT_LIMIT);
    console.log(`[MultiSource] Profile variants for external sources: ${JSON.stringify(variants)}`);
  }

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
      withTimeout(fetchIndeed(keywords, location, perSourceLimit, profile), "Indeed").then(
        (jobs) => ({ source: "indeed", jobs })
      )
    );
  }
  if (sources.bayt !== false) {
    fetches.push(
      withTimeout(fetchBayt(keywords, perSourceLimit, profile), "Bayt").then(
        (jobs) => ({ source: "bayt", jobs })
      )
    );
  }
  if (sources.gulftalent !== false) {
    fetches.push(
      withTimeout(fetchGulfTalent(keywords, perSourceLimit, profile), "GulfTalent").then(
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

  // Final dedupe + rank-aware slice.
  const deduped = deduplicate(allJobs);
  const finalJobs = profileApplied
    ? deduped
        .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
        .slice(0, limit)
    : deduped.slice(0, limit);

  console.log(
    `[MultiSource] After dedup: ${finalJobs.length} jobs (from ${allJobs.length} raw, profile_applied=${profileApplied})`
  );

  return {
    jobs: finalJobs,
    counts,
    total: finalJobs.length,
    sources_queried: sourcesQueried,
    sources_with_results: sourcesWithResults,
    profile_applied: profileApplied,
  };
}
