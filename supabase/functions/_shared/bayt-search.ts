/**
 * Bayt.com Qatar job search — HTML scraper.
 *
 * Bayt.com is the #1 job board in the GCC / MENA region. Qatar jobs URL:
 *   https://www.bayt.com/en/qatar/jobs/?q={keywords}&searchType=2
 *
 * Job card structure (2024-2026 design):
 *   <li data-js-job="">
 *     <h2 class="t-default t-bold">
 *       <a href="/en/qatar/jobs/job-title-12345678/">Job Title</a>
 *     </h2>
 *     <b class="t-default"><a href="/en/qatar/companies/...">Company Name</a></b>
 *     <span class="t-muted">City, Qatar · Full Time · 2 days ago</span>
 *   </li>
 *
 * Multi-selector cascade: class names are tried in order so that if Bayt
 * redesigns its markup, at least one selector still matches.
 */

import { decodeHtmlEntities, stripHtmlTags } from "./rss-parser.ts";

export interface BaytJob {
  title: string;
  company: string;
  location: string;
  apply_url: string;
  description: string;
  source_created_at: string | null;
  source_platform: "bayt";
  external_id: string | null;
}

const BASE = "https://www.bayt.com";

// Browser-like headers to avoid trivial bot blocks
const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function buildBaytUrl(keywords: string): string {
  const params = new URLSearchParams();
  params.set("q", keywords);
  params.set("searchType", "2");     // keyword-based search
  return `${BASE}/en/qatar/jobs/?${params.toString()}`;
}

/** Extract Bayt job ID from a path like /en/qatar/jobs/software-engineer-12345678/ */
function extractBaytJobId(path: string): string | null {
  // Last numeric segment: /jobs/title-123456789/
  const m = path.match(/-(\d{6,})\/?$/);
  return m ? m[1] : null;
}

/** Pull the inner text of the first regex match from a block of HTML. */
function pullText(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  if (!m) return "";
  return decodeHtmlEntities(stripHtmlTags(m[1] || m[0])).trim();
}

/** Try a list of patterns and return the first non-empty match. */
function firstMatch(html: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const v = pullText(html, p);
    if (v) return v;
  }
  return "";
}

/**
 * Parse relative date text like "2 days ago", "1 week ago" into ISO.
 * Returns null if unparseable.
 */
function parseRelativeDate(text: string): string | null {
  const lower = text.toLowerCase();
  const now = Date.now();
  const numM = lower.match(/(\d+)/);
  const val = numM ? parseInt(numM[1]) : 1;

  let ms = 0;
  if (lower.includes("minute")) ms = val * 60_000;
  else if (lower.includes("hour")) ms = val * 3_600_000;
  else if (lower.includes("day")) ms = val * 86_400_000;
  else if (lower.includes("week")) ms = val * 7 * 86_400_000;
  else if (lower.includes("month")) ms = val * 30 * 86_400_000;
  else return null;

  return new Date(now - ms).toISOString();
}

/**
 * Split the raw HTML into per-job-card blocks by anchoring on
 * `data-js-job` attributes which appear once per card.
 */
function extractCardBlocks(html: string): string[] {
  const blocks: string[] = [];
  const anchorRe = /data-js-job(?:="")?/g;
  let m: RegExpExecArray | null;

  while ((m = anchorRe.exec(html)) !== null) {
    // Walk back to the opening <li that contains this anchor
    const liStart = html.lastIndexOf("<li", m.index);
    if (liStart === -1) continue;

    // Walk forward with <li> depth counter to find the matching </li>
    let depth = 0;
    let i = liStart;
    while (i < html.length) {
      if (html[i] === "<") {
        if (html.startsWith("</li", i) && /[\s>]/.test(html[i + 4] || ">")) {
          if (depth === 0) {
            blocks.push(html.substring(liStart, i + 5));
            break;
          }
          depth--;
          i += 5;
          continue;
        }
        if (html.startsWith("<li", i) && /[\s>]/.test(html[i + 3] || ">")) {
          depth++;
        }
      }
      i++;
    }
    // Skip past this anchor to avoid re-matching the same card
    anchorRe.lastIndex = Math.max(anchorRe.lastIndex, liStart + 1);
  }

  return blocks;
}

/** Parse a single Bayt card block into a BaytJob. */
function parseCard(block: string): BaytJob | null {
  // ── Title ────────────────────────────────────────────────────────────
  // Primary: <h2 ...><a href="...">Title</a></h2>
  // Fallback: any <a> inside an h2 or h3
  const titlePatterns = [
    /<h2[^>]*class="[^"]*t-default[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
    /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
    /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
  ];

  let href = "";
  let titleRaw = "";
  for (const p of titlePatterns) {
    const m = block.match(p);
    if (m) {
      href = m[1] || "";
      titleRaw = m[2] || "";
      break;
    }
  }

  if (!titleRaw && !href) return null;

  const title = decodeHtmlEntities(stripHtmlTags(titleRaw)).trim() || "Untitled";
  const apply_url = href.startsWith("http") ? href : `${BASE}${href}`;
  const external_id = extractBaytJobId(href);

  // ── Company ──────────────────────────────────────────────────────────
  // Bayt puts the company in a <b class="t-default"><a ...>Company</a></b>
  const company = firstMatch(block, [
    /<b[^>]*class="[^"]*t-default[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    /<b[^>]*>[\s\S]*?<a[^>]*href="[^"]*compan[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    /<span[^>]*class="[^"]*t-default[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  ]) || "Unknown Company";

  // ── Location + date ──────────────────────────────────────────────────
  // The muted span typically reads: "City, Qatar · Full Time · 2 days ago"
  const mutedSpan = firstMatch(block, [
    /<span[^>]*class="[^"]*t-muted[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*class="[^"]*t-muted[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ]);

  const parts = mutedSpan.split(/[·|•,]/).map((p) => p.trim()).filter(Boolean);
  const location = parts[0] || "Qatar";

  // Last part often has the date ("2 days ago", "Posted 1 week ago")
  const dateText = parts[parts.length - 1] || "";
  const source_created_at =
    /ago|day|week|hour|month/i.test(dateText) ? parseRelativeDate(dateText) : null;

  return {
    title,
    company,
    location,
    apply_url,
    description: "",          // Bayt description requires a detail-page fetch — omit
    source_created_at,
    source_platform: "bayt",
    external_id,
  };
}

/**
 * Search Bayt.com Qatar for jobs matching `keywords`.
 * Returns up to `limit` jobs parsed from the search-results HTML.
 */
export async function searchBaytQatar(
  keywords: string,
  limit = 25
): Promise<BaytJob[]> {
  const url = buildBaytUrl(keywords);
  console.log(`[BaytSearch] Fetching: ${url}`);

  let html: string;
  try {
    const resp = await fetch(url, { headers: HEADERS });
    console.log(`[BaytSearch] HTTP ${resp.status}`);
    if (!resp.ok) {
      console.warn(`[BaytSearch] Non-OK response: ${resp.status}`);
      return [];
    }
    html = await resp.text();
    console.log(`[BaytSearch] Page size: ${html.length} bytes`);
  } catch (err: any) {
    console.error(`[BaytSearch] Fetch failed: ${err.message}`);
    return [];
  }

  // Quick sanity check
  if (!html.includes("data-js-job")) {
    console.warn("[BaytSearch] No job cards detected (data-js-job not found).");
    // Diagnostic
    const checks = {
      "bayt-list": html.includes("bayt"),
      "CAPTCHA": html.toLowerCase().includes("captcha"),
      "access-denied": html.toLowerCase().includes("access denied"),
      "sign-in": html.toLowerCase().includes("sign in"),
    };
    console.log("[BaytSearch] Diagnostics:", JSON.stringify(checks));
    return [];
  }

  const blocks = extractCardBlocks(html);
  console.log(`[BaytSearch] Found ${blocks.length} card blocks`);

  const jobs: BaytJob[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (jobs.length >= limit) break;
    const job = parseCard(block);
    if (!job) continue;

    const key = job.external_id || job.apply_url.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    jobs.push(job);
  }

  console.log(`[BaytSearch] Returning ${jobs.length} jobs for "${keywords}"`);
  return jobs;
}
