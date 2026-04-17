/**
 * GulfTalent.com Qatar job search — HTML scraper.
 *
 * GulfTalent focuses on mid-to-senior professional roles across GCC.
 * Qatar search URL:
 *   https://www.gulftalent.com/qatar/jobs/search?q={keywords}
 *
 * Job listing structure (2024-2026):
 *   <div class="listing-item" ...>
 *     <a class="listing-item__title" href="/jobs/...">Job Title</a>
 *     <div class="listing-item__employer">Company Name</div>
 *     <div class="listing-item__details">
 *       <span class="listing-item__location">Doha, Qatar</span>
 *       <span class="listing-item__date">2 days ago</span>
 *     </div>
 *   </div>
 *
 * Multi-selector cascade: tries multiple patterns so minor markup
 * changes don't silently break the scraper.
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

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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

function buildGulfTalentUrl(keywords: string): string {
  const params = new URLSearchParams();
  params.set("q", keywords);
  return `${BASE}/qatar/jobs/search?${params.toString()}`;
}

/** Extract GulfTalent job ID from path like /jobs/job-title-in-qatar-1234567 */
function extractGtJobId(path: string): string | null {
  const m = path.match(/-(\d{5,})\/?$/);
  return m ? m[1] : null;
}

function pullText(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  if (!m) return "";
  return decodeHtmlEntities(stripHtmlTags(m[1] || "")).trim();
}

function firstMatch(html: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const v = pullText(html, p);
    if (v) return v;
  }
  return "";
}

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
 * Extract individual job card blocks from GulfTalent HTML.
 * Anchors on class="listing-item" which appears once per job card.
 */
function extractCardBlocks(html: string): string[] {
  const blocks: string[] = [];

  // GulfTalent uses <div class="listing-item ..."> per job
  const anchorRe = /class="listing-item[\s"]/g;
  let m: RegExpExecArray | null;

  while ((m = anchorRe.exec(html)) !== null) {
    // Walk back to the opening <div
    const divStart = html.lastIndexOf("<div", m.index);
    if (divStart === -1) continue;

    // Walk forward with depth counter to find the matching </div>
    let depth = 0;
    let i = divStart;
    while (i < html.length) {
      if (html[i] === "<") {
        if (
          html.startsWith("</div", i) &&
          /[\s>]/.test(html[i + 5] || ">")
        ) {
          if (depth === 0) {
            blocks.push(html.substring(divStart, i + 6));
            break;
          }
          depth--;
          i += 6;
          continue;
        }
        if (html.startsWith("<div", i) && /[\s>]/.test(html[i + 4] || ">")) {
          depth++;
        }
      }
      i++;
    }
    anchorRe.lastIndex = Math.max(anchorRe.lastIndex, divStart + 1);
  }

  return blocks;
}

/** Parse one GulfTalent card block. */
function parseCard(block: string): GulfTalentJob | null {
  // ── Title + URL ──────────────────────────────────────────────────────
  const titlePatterns = [
    /<a[^>]*class="[^"]*listing-item__title[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
    /<a[^>]*href="([^"]*\/jobs\/[^"]*)"[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i,
    /<a[^>]*href="(\/jobs\/[^"?]+)"[^>]*>([\s\S]*?)<\/a>/i,
  ];

  let href = "";
  let titleRaw = "";
  for (const p of titlePatterns) {
    const match = block.match(p);
    if (match) {
      href = match[1] || "";
      titleRaw = match[2] || "";
      break;
    }
  }

  if (!titleRaw && !href) return null;

  const title = decodeHtmlEntities(stripHtmlTags(titleRaw)).trim() || "Untitled";
  const apply_url = href.startsWith("http") ? href : `${BASE}${href}`;
  const external_id = extractGtJobId(href);

  // ── Company ──────────────────────────────────────────────────────────
  const company = firstMatch(block, [
    /<div[^>]*class="[^"]*listing-item__employer[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*class="[^"]*employer[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*class="[^"]*company[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ]) || "Unknown Company";

  // ── Location ─────────────────────────────────────────────────────────
  const location = firstMatch(block, [
    /<span[^>]*class="[^"]*listing-item__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  ]) || "Qatar";

  // ── Date ─────────────────────────────────────────────────────────────
  const dateText = firstMatch(block, [
    /<span[^>]*class="[^"]*listing-item__date[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<div[^>]*class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<time[^>]*datetime="([^"]+)"[^>]*>/i,
    /<time[^>]*>([\s\S]*?)<\/time>/i,
  ]);

  const source_created_at = dateText
    ? parseRelativeDate(dateText) ?? null
    : null;

  return {
    title,
    company,
    location,
    apply_url,
    description: "",
    source_created_at,
    source_platform: "gulftalent",
    external_id,
  };
}

/**
 * Search GulfTalent Qatar for jobs matching `keywords`.
 */
export async function searchGulfTalent(
  keywords: string,
  limit = 25
): Promise<GulfTalentJob[]> {
  const url = buildGulfTalentUrl(keywords);
  console.log(`[GulfTalentSearch] Fetching: ${url}`);

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
    console.error(`[GulfTalentSearch] Fetch failed: ${err.message}`);
    return [];
  }

  // Sanity check
  if (!html.includes("listing-item")) {
    console.warn("[GulfTalentSearch] No listing-item cards found.");
    const checks = {
      "CAPTCHA": html.toLowerCase().includes("captcha"),
      "access-denied": html.toLowerCase().includes("access denied"),
      "jobs": html.toLowerCase().includes("jobs"),
    };
    console.log("[GulfTalentSearch] Diagnostics:", JSON.stringify(checks));
    return [];
  }

  const blocks = extractCardBlocks(html);
  console.log(`[GulfTalentSearch] Found ${blocks.length} card blocks`);

  const jobs: GulfTalentJob[] = [];
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

  console.log(`[GulfTalentSearch] Returning ${jobs.length} jobs for "${keywords}"`);
  return jobs;
}
