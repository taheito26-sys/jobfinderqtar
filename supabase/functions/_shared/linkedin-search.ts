// LinkedIn Native Search logic
// Research-backed implementation based on:
// 1. speedyapply/JobSpy - BeautifulSoup class-based selectors, job ID from URL, datetime attribute
// 2. python-scrapy-playbook/linkedin-python-scrapy-scraper - CSS selectors: h3::text, h4 a::text
// 3. scrapfly/scrapfly-scrapers - XPath: //section[results-list]/ul/li, span/text() for title

export interface LinkedInSearchInput {
  keywords: string;
  location?: string;
  pageNum?: number;
  limit?: number;
  postedWithin?: "24h" | "week" | "month" | "any";
  remotePreference?: "remote" | "onsite" | "hybrid" | "flexible";
}

export interface LinkedInJobSnippet {
  linkedin_job_id: string;
  title: string;
  company: string;
  location: string;
  apply_url: string;
  source_created_at_text?: string;
  raw_card_payload: any;
}

function mapPostedWithinToLinkedIn(postedWithin?: string): string {
  switch (postedWithin) {
    case "24h": return "r86400";
    case "week": return "r604800";
    case "month": return "r2592000";
    default: return "";
  }
}

function mapRemotePreferenceToLinkedIn(remotePref?: string): string {
  switch (remotePref) {
    case "remote": return "2";
    case "onsite": return "1";
    case "hybrid": return "3";
    default: return "";
  }
}

export function buildLinkedInSearchUrl(input: LinkedInSearchInput): string {
  const { keywords, location, pageNum = 0, limit = 25, postedWithin, remotePreference } = input;
  const baseUrl = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
  const params = new URLSearchParams();

  params.append("keywords", keywords);
  if (location) params.append("location", location);

  const f_TPR = mapPostedWithinToLinkedIn(postedWithin);
  if (f_TPR) params.append("f_TPR", f_TPR);

  const f_WT = mapRemotePreferenceToLinkedIn(remotePreference);
  if (f_WT) params.append("f_WT", f_WT);

  const start = pageNum * limit;
  params.append("start", start.toString());

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Strip HTML tags and decode common HTML entities.
 */
function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the numeric LinkedIn job ID from a URL or URN string.
 *
 * Reference: speedyapply/JobSpy → job_id = href.split("-")[-1]
 * LinkedIn job URLs follow: /jobs/view/some-job-title-<JOBID>
 * The ID is always the last numeric segment.
 */
function extractJobIdFromUrl(href: string): string | null {
  const clean = href.split("?")[0];
  // Pattern: /jobs/view/anything-NUMBERS or /jobs/view/NUMBERS
  const fromPath = clean.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{7,})\/?$/);
  if (fromPath) return fromPath[1];
  // Fallback: any 7+ digit number at end of path
  const fallback = clean.match(/(\d{7,})\/?$/);
  return fallback ? fallback[1] : null;
}

// ─────────────────────────────────────────────
// STRATEGY 1 (PRIMARY): class-based <li> parsing
// Reference: JobSpy + Scrapy Playbook
// ─────────────────────────────────────────────
/**
 * Primary strategy: iterate <li> blocks, filter those that contain
 * a `base-search-card` div (the actual job card), then extract fields
 * using class-based regex patterns.
 *
 * Key selectors derived from reference implementations:
 *   JobSpy:         soup.find_all("div", class_="base-search-card")
 *   Scrapy Playbook: li > .base-card__full-link, h3::text, h4 a::text,
 *                    .job-search-card__location::text, time::text
 *   Scrapfly:       //section[results-list]/ul/li → .//div/a/span/text()
 */
function parseStrategyCardBased(html: string): LinkedInJobSnippet[] {
  const snippets: LinkedInJobSnippet[] = [];

  /**
   * Robust card boundary extraction.
   *
   * The code-review concern: a non-greedy `<li>…</li>` regex breaks when
   * job cards contain nested <li> tags (requirements lists, etc.) because
   * the regex terminates at the first </li> encountered.
   *
   * Fix: Instead of matching the outer <li> with regex, we locate each
   * card by finding where its outer `<li>` opens *just before* the
   * data-entity-urn attribute, then walk forward to find the matching
   * closing `</li>` using a depth counter — correctly handling nesting.
   */
  function extractCardBlock(startPos: number): string {
    // Find the opening <li> that contains this position (scan back)
    const lookback = html.lastIndexOf("<li", startPos);
    if (lookback === -1) return html.substring(startPos, Math.min(html.length, startPos + 3000));

    // Walk forward tracking <li> open/close depth to find the true </li>
    let depth = 0;
    let i = lookback;
    while (i < html.length) {
      if (html[i] === '<') {
        if (html.startsWith("</li", i) && (html[i + 4] === '>' || html[i + 4] === ' ')) {
          if (depth === 0) return html.substring(lookback, i + 5);
          depth--;
          i += 5;
          continue;
        }
        if (html.startsWith("<li", i) && (html[i + 3] === '>' || html[i + 3] === ' ')) {
          depth++;
        }
      }
      i++;
    }
    // Fallback: return a fixed-size window if depth never resolved
    return html.substring(lookback, Math.min(html.length, lookback + 3000));
  }

  // Anchor on data-entity-urn — each unique job posting has exactly one
  const urnRegex = /data-entity-urn="urn:li:jobPosting:(\d+)"/g;
  const seenIds = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = urnRegex.exec(html)) !== null) {
    const linkedin_job_id = match[1];
    if (seenIds.has(linkedin_job_id)) continue;
    seenIds.add(linkedin_job_id);

    const block = extractCardBlock(match.index);

    // Only process blocks containing a LinkedIn job card div
    if (!block.includes("base-search-card")) continue;

    // ── Job URL ──────────────────────────────────────────────────────────────
    // Scrapy Playbook: .base-card__full-link::attr(href)
    // JobSpy:          job_card.find("a", class_="base-card__full-link")
    const linkMatch =
      block.match(/<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i) ||
      block.match(/href="([^"]*\/jobs\/view\/[^"?]+)"/i);

    // Derive apply_url: prefer the full-link href, fallback to canonical URL.
    // Always strip query params (tracking ids) for a clean, stable URL.
    const apply_url = linkMatch
      ? linkMatch[1].split("?")[0]
      : `https://www.linkedin.com/jobs/view/${linkedin_job_id}`;

    // ── Title ────────────────────────────────────────────────────────────────
    // JobSpy:          job_card.find("span", class_="sr-only")   ← most reliable
    // Scrapy Playbook: h3::text
    // Scrapfly:        .//div/a/span/text()  (same sr-only span)
    const srOnlyMatch = block.match(
      /<span[^>]*class="[^"]*sr-only[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    );
    const h3Match = block.match(
      /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i
    );
    const titleRaw = srOnlyMatch ? srOnlyMatch[1] : (h3Match ? h3Match[1] : "");
    const title = stripHtml(titleRaw) || "Untitled";

    // ── Company ──────────────────────────────────────────────────────────────
    // JobSpy:          job_card.find("h4", class_="base-search-card__subtitle")
    // Scrapy Playbook: h4 a::text
    const h4Match = block.match(
      /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i
    );
    const company = h4Match ? stripHtml(h4Match[1]) : "Unknown Company";

    // ── Location ─────────────────────────────────────────────────────────────
    // JobSpy:          metadata_card.find("span", class_="job-search-card__location")
    // Scrapy Playbook: .job-search-card__location::text
    const locMatch = block.match(
      /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    );
    const location = locMatch ? stripHtml(locMatch[1]) : "Unknown Location";

    // ── Date ─────────────────────────────────────────────────────────────────
    // JobSpy: time.job-search-card__listdate OR time.job-search-card__listdate--new
    //         Uses the `datetime` attribute (ISO "YYYY-MM-DD") for accuracy.
    // Scrapy Playbook: time::text  (human-readable fallback)
    const dateAttrMatch = block.match(/<time[^>]*datetime="([^"]+)"[^>]*>/i);
    const dateTextMatch = block.match(
      /<time[^>]*class="[^"]*job-search-card__listdate[^"]*"[^>]*>([\s\S]*?)<\/time>/i
    );
    const source_created_at_text = dateAttrMatch
      ? dateAttrMatch[1]                             // e.g. "2026-04-15" (preferred)
      : dateTextMatch
        ? stripHtml(dateTextMatch[1])                // e.g. "9 hours ago" (fallback)
        : undefined;

    snippets.push({
      linkedin_job_id,
      title,
      company,
      location,
      apply_url,
      source_created_at_text,
      raw_card_payload: { html: block.substring(0, 400) },
    });
  }

  return snippets;
}

// ─────────────────────────────────────────────
// STRATEGY 2: URN anchor-based extraction
// ─────────────────────────────────────────────
/**
 * Fallback: scan for all `data-entity-urn` anchors and extract a
 * surrounding context window for field parsing.
 */
function parseStrategyUrnBased(html: string): LinkedInJobSnippet[] {
  const snippets: LinkedInJobSnippet[] = [];
  const seenIds = new Set<string>();
  const urnRegex = /data-entity-urn="urn:li:jobPosting:(\d+)"/g;
  let match;

  while ((match = urnRegex.exec(html)) !== null) {
    const linkedin_job_id = match[1];
    if (seenIds.has(linkedin_job_id)) continue;
    seenIds.add(linkedin_job_id);

    const pos = match.index;
    const ctx = html.substring(Math.max(0, pos - 100), Math.min(html.length, pos + 1800));

    const linkMatch = ctx.match(/href="([^"]*\/jobs\/view\/[^"?]+)/i);
    const apply_url = linkMatch
      ? linkMatch[1].split("?")[0]
      : `https://www.linkedin.com/jobs/view/${linkedin_job_id}`;

    const srOnlyMatch = ctx.match(/<span[^>]*class="[^"]*sr-only[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const h3Match = ctx.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const title = stripHtml(srOnlyMatch ? srOnlyMatch[1] : h3Match ? h3Match[1] : "") || "Untitled";

    const h4Match = ctx.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    const company = h4Match ? stripHtml(h4Match[1]) : "Unknown Company";

    const locMatch = ctx.match(/<span[^>]*job-search-card__location[^>]*>([\s\S]*?)<\/span>/i);
    const location = locMatch ? stripHtml(locMatch[1]) : "Unknown Location";

    const dateAttrMatch = ctx.match(/<time[^>]*datetime="([^"]+)"/i);
    const dateTextMatch = ctx.match(/<time[^>]*>([\s\S]*?)<\/time>/i);
    const source_created_at_text = dateAttrMatch
      ? dateAttrMatch[1]
      : dateTextMatch ? stripHtml(dateTextMatch[1]) : undefined;

    snippets.push({
      linkedin_job_id,
      title,
      company,
      location,
      apply_url,
      source_created_at_text,
      raw_card_payload: { strategy: "urn-based" },
    });
  }

  return snippets;
}

// ─────────────────────────────────────────────
// STRATEGY 3: link-based discovery (last resort)
// ─────────────────────────────────────────────
/**
 * Last-resort fallback: find all /jobs/view/ href anchors and extract
 * job IDs + surrounding context.
 */
function parseStrategyLinkBased(html: string): LinkedInJobSnippet[] {
  const snippets: LinkedInJobSnippet[] = [];
  const seenIds = new Set<string>();
  const linkRegex = /href="([^"]*\/jobs\/view\/[^"]+)"/g;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const jobId = extractJobIdFromUrl(href);
    if (!jobId || seenIds.has(jobId)) continue;
    seenIds.add(jobId);

    const cleanUrl = href.split("?")[0];
    const pos = match.index;
    const ctx = html.substring(Math.max(0, pos - 600), Math.min(html.length, pos + 800));

    const titleMatch =
      ctx.match(/<span[^>]*sr-only[^>]*>([\s\S]*?)<\/span>/i) ||
      ctx.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const companyMatch = ctx.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    const locMatch = ctx.match(/<span[^>]*job-search-card__location[^>]*>([\s\S]*?)<\/span>/i);

    snippets.push({
      linkedin_job_id: jobId,
      title: titleMatch ? stripHtml(titleMatch[1]) : "Link Discovery",
      company: companyMatch ? stripHtml(companyMatch[1]) : "Unknown",
      location: locMatch ? stripHtml(locMatch[1]) : "Unknown",
      apply_url: cleanUrl,
      raw_card_payload: { strategy: "link-discovery" },
    });
  }

  return snippets;
}

// ─────────────────────────────────────────────
// Cascade dispatcher
// ─────────────────────────────────────────────
export function parseLinkedInJobCards(html: string): LinkedInJobSnippet[] {
  // 1. Class-based (JobSpy / Scrapy Playbook approach — most accurate)
  let cards = parseStrategyCardBased(html);
  if (cards.length > 0) {
    console.log(`[LinkedInSearch] Strategy 1 (card-based) → ${cards.length} cards`);
    return cards;
  }

  // 2. URN anchor-based
  console.log("[LinkedInSearch] Strategy 1 failed → trying Strategy 2 (URN-based)…");
  cards = parseStrategyUrnBased(html);
  if (cards.length > 0) {
    console.log(`[LinkedInSearch] Strategy 2 (urn-based) → ${cards.length} cards`);
    return cards;
  }

  // 3. Link-based (last resort)
  console.log("[LinkedInSearch] Strategy 2 failed → trying Strategy 3 (link-based)…");
  cards = parseStrategyLinkBased(html);
  console.log(`[LinkedInSearch] Strategy 3 (link-based) → ${cards.length} cards`);
  return cards;
}

// ─────────────────────────────────────────────
// HTTP fetch
// ─────────────────────────────────────────────
export async function fetchLinkedInSearch(
  input: LinkedInSearchInput
): Promise<LinkedInJobSnippet[]> {
  const searchUrl = buildLinkedInSearchUrl(input);
  console.log(`[LinkedInSearch] Request URL: ${searchUrl}`);

  // Headers modelled on speedyapply/JobSpy constant.py + Scrapy Playbook settings.py
  // These mimic a standard Chrome browser request, which reduces bot-detection rejections.
  const response = await fetch(searchUrl, {
    headers: {
      authority: "www.linkedin.com",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "max-age=0",
      "upgrade-insecure-requests": "1",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
    },
  });

  console.log(`[LinkedInSearch] HTTP Status: ${response.status}`);
  const html = await response.text();
  console.log(`[LinkedInSearch] Response size: ${html.length} bytes`);
  console.log(
    `[LinkedInSearch] HTML preview: ${html.substring(0, 1500).replace(/\s+/g, " ")}`
  );

  if (!response.ok) {
    if (response.status === 429) throw new Error("LinkedIn_RATE_LIMITED");
    throw new Error(`LinkedIn search failed: HTTP ${response.status}`);
  }

  const cards = parseLinkedInJobCards(html);
  console.log(`[LinkedInSearch] Parsed ${cards.length} job cards`);

  if (cards.length === 0) {
    // Diagnostic indicators to help pinpoint failure mode
    const checks: Record<string, boolean> = {
      "base-search-card": html.includes("base-search-card"),
      "base-card__full-link": html.includes("base-card__full-link"),
      "job-search-card__location": html.includes("job-search-card__location"),
      "data-entity-urn": html.includes("data-entity-urn"),
      "jobs-search__results-list": html.includes("jobs-search__results-list"),
      "sign-in wall": html.toLowerCase().includes("sign in") || html.includes("join now"),
      captcha: html.toLowerCase().includes("captcha"),
      "verify human": html.toLowerCase().includes("verify you are human"),
    };
    const present = Object.entries(checks)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const absent = Object.entries(checks)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    console.log(`[LinkedInSearch] Zero-result diagnosis:`);
    console.log(`  Present: ${present.join(", ") || "none"}`);
    console.log(`  Absent:  ${absent.join(", ") || "none"}`);
  }

  return cards;
}
