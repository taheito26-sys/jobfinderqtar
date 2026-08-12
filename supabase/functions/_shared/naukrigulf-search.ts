/**
 * Naukrigulf Qatar job search — public JSON search API.
 *
 * Why Naukrigulf?
 * Indeed (RSS + HTML) and Bayt.com both hard-block datacenter traffic
 * (Indeed: HTTP 403, Bayt: Cloudflare challenge), so they cannot be reached
 * from an edge function with a plain fetch. Naukrigulf exposes the same JSON
 * endpoint its own SPA calls, returns structured data, needs no API key, and
 * covers a large volume of Qatar postings.
 *
 * Endpoint:
 *   https://www.naukrigulf.com/spapi/jobapi/search?Location=qatar&Keywords={kw}
 *
 * Parameter notes (verified empirically — easy to get wrong):
 *   - `Keywords` (capital K, PLURAL) is the only spelling that filters.
 *     `Keyword`, `keyword`, `q`, `k`, `Designation` etc. are all silently
 *     IGNORED and return the unfiltered Qatar feed.
 *   - `Location=qatar` narrows to Qatar (~2k jobs vs ~40k unfiltered).
 *   - There is NO working pagination: pageNo/pageNum/start/offset are all
 *     ignored and return page 1. The response caps at 25 jobs, so breadth
 *     comes from running several keyword variants, not from paging.
 *
 * The `appid`/`systemid` headers are required; without them the API 403s.
 */

export interface NaukrigulfJob {
  title: string;
  company: string;
  location: string;
  apply_url: string;
  description: string;
  source_created_at: string | null;
  source_platform: "naukrigulf";
  external_id: string | null;
}

const ENDPOINT = "https://www.naukrigulf.com/spapi/jobapi/search";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  // Required by the API — requests without these are rejected.
  "appid": "205",
  "systemid": "2323",
};

function buildUrl(keywords: string, location: string): string {
  const params = new URLSearchParams();
  params.set("Location", (location || "qatar").toLowerCase());
  if (keywords.trim()) params.set("Keywords", keywords.trim());
  params.set("sortBy", "freshness");
  return `${ENDPOINT}?${params.toString()}`;
}

/** LatestPostedDate is a unix timestamp in SECONDS, as a string. */
function parsePostedDate(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The subset of the API's job object this module reads. */
interface RawNaukrigulfJob {
  Designation?: string;
  Location?: string;
  Experience?: { Min?: string; Max?: string };
  Company?: { Name?: string };
  JobId?: string;
  JdURL?: string;
  LatestPostedDate?: string;
  Vacancies?: string;
  keywords?: string;
  Whitelistedkeywords?: string;
}

interface NaukrigulfResponse {
  TotalJobsCount?: string;
  Jobs?: Array<{ Job?: RawNaukrigulfJob }>;
}

function buildDescription(job: RawNaukrigulfJob): string {
  const parts: string[] = [];
  const min = job?.Experience?.Min;
  const max = job?.Experience?.Max;
  if (min || max) parts.push(`Experience: ${min ?? "?"}-${max ?? "?"} years`);
  const keywords = String(job?.keywords || job?.Whitelistedkeywords || "").trim();
  if (keywords) parts.push(`Keywords: ${keywords}`);
  const vacancies = String(job?.Vacancies || "").trim();
  if (vacancies && vacancies !== "1") parts.push(`Vacancies: ${vacancies}`);
  return parts.join(" · ");
}

/**
 * Search Naukrigulf for Qatar jobs matching `keywords`.
 * Returns [] on any failure — callers treat an empty array as "no results".
 */
export async function searchNaukrigulf(
  keywords: string,
  location = "qatar",
  limit = 25,
): Promise<NaukrigulfJob[]> {
  const url = buildUrl(keywords, location);
  console.log(`[NaukrigulfSearch] Fetching: ${url}`);

  let payload: NaukrigulfResponse;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    console.log(`[NaukrigulfSearch] HTTP ${resp.status}`);
    if (!resp.ok) {
      console.warn(`[NaukrigulfSearch] Non-OK response: ${resp.status}`);
      return [];
    }
    payload = await resp.json();
  } catch (err: unknown) {
    console.error(
      `[NaukrigulfSearch] Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const rawJobs = Array.isArray(payload?.Jobs) ? payload.Jobs : [];
  console.log(
    `[NaukrigulfSearch] total=${payload?.TotalJobsCount ?? "?"} returned=${rawJobs.length}`,
  );

  const jobs: NaukrigulfJob[] = [];
  const seen = new Set<string>();

  for (const entry of rawJobs) {
    if (jobs.length >= limit) break;
    const job = entry?.Job;
    if (!job) continue;

    const title = String(job.Designation || "").trim();
    const applyUrl = String(job.JdURL || "").trim();
    if (!title || !applyUrl) continue;

    const externalId = String(job.JobId || "").trim() || null;
    const key = externalId || applyUrl.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    jobs.push({
      title,
      company: String(job?.Company?.Name || "").trim() || "Unknown Company",
      location: String(job.Location || "").trim() || "Qatar",
      apply_url: applyUrl,
      description: buildDescription(job),
      source_created_at: parsePostedDate(job.LatestPostedDate),
      source_platform: "naukrigulf",
      external_id: externalId,
    });
  }

  console.log(`[NaukrigulfSearch] Returning ${jobs.length} jobs for "${keywords}"`);
  return jobs;
}
