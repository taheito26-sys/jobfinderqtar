/**
 * GulfTalent.com Qatar job search — HTML scraper.
 *
 * GulfTalent focuses on mid-to-senior professional roles across GCC.
 *
 * Endpoint:
 *   https://www.gulftalent.com/qatar/jobs
 *
 * Two constraints drive this design (both verified against the live site):
 *
 *   1. The old `/qatar/jobs/search?q=` URL now returns HTTP 404, and
 *      `/jobs/search?q=` renders its results client-side via Angular, so the
 *      raw HTML contains no listings. Only the `/qatar/jobs` browse page is
 *      server-rendered with real job rows.
 *   2. That page ignores every keyword parameter tried (`q`, `keyword`,
 *      `search`) and every pagination parameter (`page`, `pageNo`, ...) —
 *      all return the same 25 most-recent Qatar jobs.
 *
 * So GulfTalent is a *browse* source, not a search source: we fetch the recent
 * Qatar feed once and filter it against the keyword locally. Callers combine
 * this with profile scoring, which does the finer-grained ranking.
 *
 * Row structure (2026):
 *   <tr class="content-visibility-auto">
 *     <td> <a ... href="/qatar/jobs/{slug}-{id}">Title</a>
 *          <a href="/companies/{slug}">Company</a> </td>
 *     <td> <span title="Doha, Qatar">Doha</span> </td>
 *     <td> 11 Aug </td>
 *   </tr>
 */

import { decodeHtmlEntities, stripHtmlTags } from "./rss-parser.ts";

export interface GulfTalentJob {
  title: string;
  company: string;
  location: string;
  apply_url: string;
  description: string;
  source_created_at: string | null;
  source_platform: "gulftalent";
  external_id: string | null;
}

const BASE = "https://www.gulftalent.com";
const BROWSE_PATH = "/qatar/jobs";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/** Extract GulfTalent job ID from a path like /qatar/jobs/lead-piping-engineer-620440 */
function extractGtJobId(path: string): string | null {
  const m = path.match(/-(\d{4,})\/?$/);
  return m ? m[1] : null;
}

function clean(value: string): string {
  return decodeHtmlEntities(stripHtmlTags(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a "11 Aug" style date into an ISO string.
 * The listing omits the year, so we assume the most recent occurrence:
 * a date later than today must belong to the previous year.
 */
export function parseGulfTalentDate(text: string, now = new Date()): string | null {
  const m = clean(text).match(/^(\d{1,2})\s+([A-Za-z]{3,})/);
  if (!m) return null;

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthIndex = months.indexOf(m[2].slice(0, 3).toLowerCase());
  if (monthIndex === -1) return null;

  const day = Number(m[1]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  const candidate = new Date(Date.UTC(now.getUTCFullYear(), monthIndex, day));
  if (candidate.getTime() > now.getTime()) {
    candidate.setUTCFullYear(candidate.getUTCFullYear() - 1);
  }
  return candidate.toISOString();
}

/** Split the results table into one HTML chunk per job row. */
function extractRows(html: string): string[] {
  return html.split(/<tr[^>]*class="[^"]*content-visibility-auto[^"]*"[^>]*>/i).slice(1);
}

/** Parse one GulfTalent table row. */
function parseRow(row: string, now?: Date): GulfTalentJob | null {
  // Title + URL — the job anchor is the one pointing at /{country}/jobs/{slug}-{id}
  const titleMatch = row.match(
    /<a[^>]*href="(\/[a-z-]+\/jobs\/[^"?#]*-\d{4,})"[^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!titleMatch) return null;

  const href = titleMatch[1];
  const title = clean(titleMatch[2]);
  if (!title) return null;

  // Company — anchor pointing at /companies/{slug}
  const companyMatch = row.match(/<a[^>]*href="\/companies\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  const company = clean(companyMatch?.[1] || "") || "Unknown Company";

  // Location — the `title` attribute carries the full "Doha, Qatar" form,
  // while the visible text is just the city.
  const locationTitle = row.match(/<span[^>]*title="([^"]+)"[^>]*>/i)?.[1];
  const locationCell = row.match(/<a[^>]*href="\/[a-z-]+\/jobs\/city\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  const location = clean(locationTitle || locationCell || "") || "Qatar";

  // Date — the third cell holds a bare "11 Aug".
  const cells = row.split(/<td[^>]*>/i).slice(1);
  const dateCell = cells.length >= 3 ? clean(cells[2]) : "";

  return {
    title,
    company,
    location,
    apply_url: `${BASE}${href}`,
    description: "",
    source_created_at: parseGulfTalentDate(dateCell, now),
    source_platform: "gulftalent",
    external_id: extractGtJobId(href),
  };
}

/**
 * Keep rows loosely matching the keyword. GulfTalent cannot filter server-side,
 * so an unmatched keyword would otherwise return the entire unrelated feed.
 * A job matches if any meaningful keyword token appears in its title or company.
 */
export function filterByKeyword(jobs: GulfTalentJob[], keywords: string): GulfTalentJob[] {
  const tokens = String(keywords || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

  if (tokens.length === 0) return jobs;

  return jobs.filter((job) => {
    const haystack = `${job.title} ${job.company}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

/** Parse the browse page HTML into jobs. Exported for tests. */
export function parseGulfTalentHtml(html: string, now?: Date): GulfTalentJob[] {
  const rows = extractRows(html);
  const jobs: GulfTalentJob[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const job = parseRow(row, now);
    if (!job) continue;

    const key = job.external_id || job.apply_url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    jobs.push(job);
  }

  return jobs;
}

/**
 * Fetch recent GulfTalent Qatar jobs and filter them by `keywords`.
 */
export async function searchGulfTalent(
  keywords: string,
  limit = 25,
): Promise<GulfTalentJob[]> {
  const url = `${BASE}${BROWSE_PATH}`;
  console.log(`[GulfTalentSearch] Fetching: ${url} (filtering locally for "${keywords}")`);

  let html: string;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    console.log(`[GulfTalentSearch] HTTP ${resp.status}`);
    if (!resp.ok) {
      console.warn(`[GulfTalentSearch] Non-OK: ${resp.status}`);
      return [];
    }
    html = await resp.text();
    console.log(`[GulfTalentSearch] Page size: ${html.length} bytes`);
  } catch (err: any) {
    console.error(`[GulfTalentSearch] Fetch failed: ${err?.message || err}`);
    return [];
  }

  const parsed = parseGulfTalentHtml(html);
  if (parsed.length === 0) {
    console.warn(
      "[GulfTalentSearch] No job rows parsed — the browse-page markup may have changed.",
    );
    return [];
  }

  const matched = filterByKeyword(parsed, keywords).slice(0, limit);
  console.log(
    `[GulfTalentSearch] Parsed ${parsed.length} rows, ${matched.length} matched "${keywords}"`,
  );
  return matched;
}
