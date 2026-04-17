/**
 * Generic RSS/Atom XML parser for job feeds.
 * Handles CDATA sections, HTML entities, and both RSS 2.0 and Atom formats.
 * No external dependencies — pure regex/string parsing safe for Deno Edge.
 */

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  guid?: string;
  /** <source> tag text content — often the company name in Indeed feeds */
  sourceLabel?: string;
  /** Raw <source url="..."> attribute */
  sourceUrl?: string;
  /** <author> or <dc:creator> */
  author?: string;
  /** Any <category> tags */
  categories: string[];
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Extract a single tag's text, handling CDATA and plain text. */
function extractTag(xml: string, tag: string): string {
  // CDATA variant: <tag><![CDATA[...]]></tag>
  const cdataRe = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  // Plain text variant: <tag>...</tag>
  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const plainMatch = xml.match(plainRe);
  if (plainMatch) return decodeHtmlEntities(plainMatch[1].trim());

  return "";
}

/** Extract an attribute value from a self-closing or opening tag. */
function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

/** Extract all <category> values from an item block. */
function extractCategories(xml: string): string[] {
  const re = /<category[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/gi;
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const val = m[1].trim();
    if (val) results.push(decodeHtmlEntities(val));
  }
  return results;
}

/** Decode common HTML entities used in RSS feeds. */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Strip HTML tags — used when description is HTML-wrapped. */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Main parser ──────────────────────────────────────────────────────────

/**
 * Parse an RSS 2.0 or Atom feed XML string into a list of items.
 * Works for Indeed, Bayt (RSS), and any standard job feed.
 */
export function parseRssFeed(xml: string): RssItem[] {
  const items: RssItem[] = [];

  // Support both RSS <item> and Atom <entry> tags
  const itemRe = /(<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>)/gi;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];

    // Title
    const title = extractTag(block, "title") || "Untitled";

    // Link — Atom uses <link href="..."/> or <link>...</link>
    let link = extractTag(block, "link");
    if (!link) {
      link = extractAttr(block, "link", "href");
    }

    // Description (RSS) / Summary or Content (Atom)
    const description =
      extractTag(block, "description") ||
      extractTag(block, "summary") ||
      extractTag(block, "content");

    const pubDate =
      extractTag(block, "pubDate") ||
      extractTag(block, "published") ||
      extractTag(block, "updated") ||
      extractTag(block, "dc:date") ||
      undefined;

    const guid =
      extractTag(block, "guid") ||
      extractTag(block, "id") ||
      undefined;

    const sourceLabel = extractTag(block, "source") || undefined;
    const sourceUrl = extractAttr(block, "source", "url") || undefined;
    const author =
      extractTag(block, "author") ||
      extractTag(block, "dc:creator") ||
      undefined;

    const categories = extractCategories(block);

    items.push({
      title: decodeHtmlEntities(title),
      link: link.trim(),
      description,
      pubDate,
      guid,
      sourceLabel,
      sourceUrl,
      author,
      categories,
    });
  }

  return items;
}

/**
 * Parse Indeed's HTML-wrapped description field to extract structured data.
 *
 * Indeed embeds a <table> inside the description CDATA:
 *   <tr><td>Company:</td><td>Acme Corp</td></tr>
 *   <tr><td>Location:</td><td>Doha, Qatar</td></tr>
 *   <tr><td>Summary:</td><td>Job summary text...</td></tr>
 */
export function parseIndeedDescription(html: string): {
  company: string;
  location: string;
  summary: string;
} {
  function tdAfterLabel(label: string): string {
    // Match <td>Label:</td><td>Value</td> (case-insensitive)
    const re = new RegExp(
      `<td[^>]*>\\s*${label}:?\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
      "i"
    );
    const m = html.match(re);
    return m ? stripHtmlTags(decodeHtmlEntities(m[1])).trim() : "";
  }

  return {
    company: tdAfterLabel("Company") || tdAfterLabel("Employer"),
    location: tdAfterLabel("Location"),
    summary: tdAfterLabel("Summary") || tdAfterLabel("Description"),
  };
}

/**
 * Convert an RFC 2822 / HTTP-date string (pubDate) to ISO 8601.
 * Returns null if unparseable.
 */
export function parsePubDate(pubDate?: string): string | null {
  if (!pubDate) return null;
  try {
    const d = new Date(pubDate);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {
    /* ignore */
  }
  return null;
}
