/**
 * Indeed Qatar job search via public RSS feed.
 *
 * Why RSS?
 * - No bot detection / CAPTCHA — it's a public feed designed for syndication.
 * - Structured XML — no brittle HTML class selectors.
 * - Always returns real, current job postings.
 * - Free — no API key required.
 *
 * Feed URL:
 *   https://www.indeed.com/rss?q={keywords}&l=Qatar&sort=date&radius=50
 *
 * Qatar-specific subdomain also tried as fallback:
 *   https://qa.indeed.com/rss?q={keywords}&sort=date
 */

import {
  parseRssFeed,
  parseIndeedDescription,
  parsePubDate,
  stripHtmlTags,
  decodeHtmlEntities,
} from "./rss-parser.ts";

export interface IndeedJob {
  title: string;
  company: string;
  location: string;
  apply_url: string;
  description: string;
  source_created_at: string | null;
  source_platform: "indeed";
  external_id: string | null;
}

/** Map a keyword + location to an Indeed RSS URL. */
function buildIndeedRssUrl(keywords: string, location: string): string {
  const params = new URLSearchParams();
  params.set("q", keywords);
  params.set("l", location || "Qatar");
  params.set("sort", "date");
  params.set("radius", "50");
  return `https://www.indeed.com/rss?${params.toString()}`;
}

/** Fallback — Qatar-specific indeed subdomain */
function buildIndeedQaUrl(keywords: string): string {
  const params = new URLSearchParams();
  params.set("q", keywords);
  params.set("sort", "date");
  return `https://qa.indeed.com/rss?${params.toString()}`;
}

/** Extract Indeed job ID from the link or guid. */
function extractIndeedJobId(link: string, guid?: string): string | null {
  // link format: https://www.indeed.com/rc/clk?jk=JOBID&...
  const jkMatch = (link + (guid || "")).match(/jk=([a-f0-9]+)/i);
  if (jkMatch) return jkMatch[1];
  // guid format: indeed:job:JOBID
  const guidMatch = (guid || "").match(/indeed:job:([a-f0-9]+)/i);
  return guidMatch ? guidMatch[1] : null;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/rss+xml, application/xml, text/xml, */*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

async function fetchRss(url: string): Promise<string | null> {
  try {
    console.log(`[IndeedSearch] Fetching RSS: ${url}`);
    const resp = await fetch(url, { headers: BROWSER_HEADERS });
    console.log(`[IndeedSearch] HTTP ${resp.status} from ${url}`);
    if (!resp.ok) return null;
    const text = await resp.text();
    console.log(`[IndeedSearch] Feed size: ${text.length} bytes`);
    return text;
  } catch (err: any) {
    console.warn(`[IndeedSearch] Fetch error: ${err.message}`);
    return null;
  }
}

/**
 * Search Indeed for Qatar jobs matching the given keywords.
 * Tries main indeed.com first, falls back to qa.indeed.com.
 */
export async function searchIndeedQatar(
  keywords: string,
  location = "Qatar",
  limit = 25
): Promise<IndeedJob[]> {
  // Try primary URL first, fallback to QA subdomain
  const primaryUrl = buildIndeedRssUrl(keywords, location);
  const fallbackUrl = buildIndeedQaUrl(keywords);

  let xml = await fetchRss(primaryUrl);

  // If the primary returned no <item> blocks, try the Qatar subdomain
  if (!xml || !xml.includes("<item")) {
    console.log("[IndeedSearch] Primary feed empty, trying qa.indeed.com...");
    xml = await fetchRss(fallbackUrl);
  }

  if (!xml || !xml.includes("<item")) {
    console.warn("[IndeedSearch] Both RSS feeds returned no items.");
    return [];
  }

  const items = parseRssFeed(xml);
  console.log(`[IndeedSearch] Parsed ${items.length} RSS items`);

  const jobs: IndeedJob[] = [];
  const seen = new Set<string>();

  for (const item of items.slice(0, limit)) {
    if (!item.link) continue;

    // Deduplicate by job ID or URL
    const jobId = extractIndeedJobId(item.link, item.guid);
    const key = jobId || item.link.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    // Parse structured data from description HTML
    const parsed = parseIndeedDescription(item.description);

    // Company: prefer <source> tag content, then parsed description, then "Unknown"
    const company =
      item.sourceLabel ||
      parsed.company ||
      item.author ||
      "Unknown Company";

    // Location: parsed from description first, then item categories
    const location =
      parsed.location ||
      item.categories.find(c => /qatar|doha|gulf/i.test(c)) ||
      "Qatar";

    // Description: parsed summary or stripped HTML
    const description =
      parsed.summary ||
      stripHtmlTags(decodeHtmlEntities(item.description)).substring(0, 2000);

    jobs.push({
      title: item.title,
      company: company.trim(),
      location: location.trim(),
      apply_url: item.link,
      description,
      source_created_at: parsePubDate(item.pubDate),
      source_platform: "indeed",
      external_id: jobId,
    });
  }

  console.log(`[IndeedSearch] Returning ${jobs.length} jobs for "${keywords}"`);
  return jobs;
}
