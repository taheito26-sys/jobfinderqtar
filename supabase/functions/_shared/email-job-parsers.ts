/**
 * Parsers for job-alert digest emails (NaukriGulf, LinkedIn, Bayt, GulfTalent).
 *
 * Why parse the TEXT part rather than the HTML?
 * These senders rewrite their email markup constantly, and the previous
 * generation of scrapers in this repo broke precisely because they were pinned
 * to HTML class names. The plain-text rendering ("Title / Company / N - M Years
 * / Location") has been stable for years and is what Gmail hands us in the
 * text/plain MIME part. HTML is used only to recover apply links, which are
 * optional — a job without a link is still worth importing.
 *
 * SECURITY — auto-login tokens:
 * NaukriGulf digests state outright that the mail "allows auto login to the
 * account", and their links carry tokens that authenticate as the recipient.
 * LinkedIn and Bayt alerts embed similar tracking/identity parameters. Every
 * URL extracted here goes through stripAuthTokens() before it is stored, so
 * account-bearing credentials never reach the jobs table.
 */

export interface ParsedEmailJob {
  title: string;
  company: string;
  location: string;
  /** Country parsed off the location, used to flag non-Qatar roles. */
  country: string;
  is_qatar: boolean;
  experience: string;
  apply_url: string;
  posted_hint: string;
  source_platform: string;
}

export interface ParsedDigest {
  jobs: ParsedEmailJob[];
  parser: string;
}

/** Query parameters that carry identity, session or tracking data. */
const SENSITIVE_PARAMS = [
  // NaukriGulf auto-login / identity
  "aut", "autologin", "auto_login", "token", "authtoken", "auth", "sid", "uid",
  "userid", "user_id", "email", "emailid", "e", "xz", "xp",
  // LinkedIn
  "trk", "trkinfo", "midtoken", "midsig", "eid", "lipi", "licu", "trkemail",
  "otptoken", "logintoken",
  // Generic tracking
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "mc_eid", "mc_cid", "ref", "referer", "referrer", "src",
];

/**
 * Remove identity/tracking parameters from a URL.
 * Anything we cannot parse is discarded rather than stored, because an
 * unparseable string may still contain a raw token.
 */
export function stripAuthTokens(rawUrl: string): string {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "";

  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAMS.includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  // Credentials embedded in the authority (https://user:pass@host) are dropped.
  url.username = "";
  url.password = "";
  url.hash = "";

  return url.toString();
}

const QATAR_PATTERN = /\b(qatar|doha|lusail|al\s*wakrah|al\s*rayyan)\b/i;

/**
 * Pull the country out of a digest location string.
 * Format is "City , City - Country" or just "Country - Country".
 */
export function parseLocation(raw: string): { location: string; country: string; is_qatar: boolean } {
  const location = String(raw || "").replace(/\s+/g, " ").trim();
  if (!location) return { location: "", country: "", is_qatar: false };

  // Everything after the last " - " is the country.
  const dashIndex = location.lastIndexOf(" - ");
  const country = dashIndex === -1 ? location : location.slice(dashIndex + 3).trim();

  return {
    location,
    country,
    is_qatar: QATAR_PATTERN.test(location),
  };
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** Lines that are digest chrome rather than job data. */
const NOISE_PATTERNS: RegExp[] = [
  /^easy apply$/i,
  /^get app$/i,
  /^view all jobs$/i,
  /^do you find these jobs relevant/i,
  /^here are job opportunities/i,
  /^hi\b/i,
  /^unsubscribe/i,
  /^inbox$/i,
  /^to me$/i,
  /^get notified/i,
  /^this mail is intended/i,
  /^your daily job matches/i,
  /^\d+\s*-\s*\d+\s*years?$/i,
  /^\d+[dhm]$/i,                       // relative age: "2d", "4d"
  /^\d{1,2}\s+[A-Za-z]{3}$/,           // absolute date: "8 Jul"
  /^[\s|]*$/,
];

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

/** "8 Jul" / "2d" / "4d" — kept as a hint, not resolved to a timestamp. */
const DATE_LINE = /^(\d{1,2}\s+[A-Za-z]{3}|\d+[dhm])$/;
const EXPERIENCE_LINE = /^(\d+)\s*-\s*(\d+)\s*years?$/i;

/**
 * Parse a NaukriGulf "daily job matches" digest.
 *
 * Each job block is anchored on its experience line ("10 - 16 Years"), which is
 * the one element every entry has and no chrome line imitates. The title and
 * company are the two preceding non-noise lines; the location is the next
 * non-noise line after it. Anchoring this way means greeting and footer text is
 * skipped without needing to know where the job list starts or ends.
 */
export function parseNaukrigulfDigest(text: string, html = ""): ParsedEmailJob[] {
  const lines = String(text || "").split(/\r?\n/).map(cleanLine);
  const links = extractJobLinks(html, /naukrigulf\.com/i);
  const jobs: ParsedEmailJob[] = [];

  for (let i = 0; i < lines.length; i++) {
    const expMatch = lines[i].match(EXPERIENCE_LINE);
    if (!expMatch) continue;

    // Walk backwards for company then title, skipping blanks/chrome.
    const preceding: string[] = [];
    for (let j = i - 1; j >= 0 && preceding.length < 2; j--) {
      const candidate = lines[j];
      if (!candidate || isNoise(candidate)) continue;
      preceding.push(candidate);
    }
    if (preceding.length < 2) continue;

    const [company, title] = preceding;

    // Walk forwards for the location line.
    let location = "";
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j];
      if (!candidate) continue;
      if (DATE_LINE.test(candidate)) break;      // ran past the block
      if (isNoise(candidate)) continue;
      location = candidate;
      break;
    }

    const parsedLocation = parseLocation(location);

    jobs.push({
      title,
      company,
      ...parsedLocation,
      experience: `${expMatch[1]} - ${expMatch[2]} Years`,
      apply_url: links[jobs.length] ?? "",
      posted_hint: findDateHint(lines, i),
      source_platform: "naukrigulf",
    });
  }

  return jobs;
}

/** The date line that closes a job block, if present. */
function findDateHint(lines: string[], experienceIndex: number): string {
  for (let j = experienceIndex + 1; j < Math.min(lines.length, experienceIndex + 6); j++) {
    if (DATE_LINE.test(lines[j])) return lines[j];
  }
  return "";
}

/**
 * Collect job links from the HTML part, in document order, de-duplicated.
 * Returns [] when no HTML is available — links are a bonus, not a requirement.
 */
export function extractJobLinks(html: string, hostPattern: RegExp): string[] {
  if (!html) return [];

  const seen = new Set<string>();
  const links: string[] = [];

  for (const match of String(html).matchAll(/href=["']([^"']+)["']/gi)) {
    const cleaned = stripAuthTokens(match[1]);
    if (!cleaned || !hostPattern.test(cleaned)) continue;
    // Skip obvious chrome destinations.
    if (/unsubscribe|preferences|privacy|terms|\/app\b|play\.google|apps\.apple/i.test(cleaned)) {
      continue;
    }
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    links.push(cleaned);
  }

  return links;
}

/**
 * Parse a LinkedIn job-alert email.
 * LinkedIn's text part renders each job as "Title" / "Company · Location".
 */
export function parseLinkedInAlert(text: string, html = ""): ParsedEmailJob[] {
  const lines = String(text || "").split(/\r?\n/).map(cleanLine);
  const links = extractJobLinks(html, /linkedin\.com/i);
  const jobs: ParsedEmailJob[] = [];

  for (let i = 0; i < lines.length; i++) {
    // "Company · Doha, Qatar" — the middot separator is LinkedIn's marker.
    const parts = lines[i].split("·").map((part) => part.trim());
    if (parts.length < 2) continue;

    const company = parts[0];
    const location = parts.slice(1).join(", ");
    if (!company || !location) continue;

    // Title is the closest preceding non-noise line.
    let title = "";
    for (let j = i - 1; j >= 0; j--) {
      if (!lines[j] || isNoise(lines[j])) continue;
      title = lines[j];
      break;
    }
    if (!title || isNoise(title)) continue;

    jobs.push({
      title,
      company,
      ...parseLocation(location),
      experience: "",
      apply_url: links[jobs.length] ?? "",
      posted_hint: "",
      source_platform: "linkedin",
    });
  }

  return jobs;
}

/**
 * Parse a Bayt or GulfTalent alert email.
 * Both render "Title" / "Company" / "Location" on consecutive lines, so we key
 * off a location line that names a known Gulf country.
 */
const GULF_COUNTRY = /\b(qatar|united arab emirates|uae|saudi arabia|kuwait|bahrain|oman|egypt|jordan|lebanon)\b/i;

export function parseGulfBoardAlert(
  text: string,
  html = "",
  platform: "bayt" | "gulftalent" = "bayt",
): ParsedEmailJob[] {
  const lines = String(text || "").split(/\r?\n/).map(cleanLine);
  const hostPattern = platform === "bayt" ? /bayt\.com/i : /gulftalent\.com/i;
  const links = extractJobLinks(html, hostPattern);
  const jobs: ParsedEmailJob[] = [];

  for (let i = 2; i < lines.length; i++) {
    const location = lines[i];
    if (!GULF_COUNTRY.test(location) || isNoise(location)) continue;

    const company = lines[i - 1];
    const title = lines[i - 2];
    if (!company || !title || isNoise(company) || isNoise(title)) continue;

    jobs.push({
      title,
      company,
      ...parseLocation(location),
      experience: "",
      apply_url: links[jobs.length] ?? "",
      posted_hint: "",
      source_platform: platform,
    });
  }

  return jobs;
}

/**
 * Best-effort parser for job emails we do not have a dedicated format for.
 * Looks for "Title at Company" / "Title - Company" constructions near a line
 * naming a Gulf location. Deliberately conservative: a wrong import is worse
 * than a missed one, so anything ambiguous is skipped.
 */
export function parseGenericJobEmail(text: string, html = ""): ParsedEmailJob[] {
  const lines = String(text || "").split(/\r?\n/).map(cleanLine);
  const links = extractJobLinks(html, /https?:/i);
  const jobs: ParsedEmailJob[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line || isNoise(line) || line.length > 160) continue;

    const match = line.match(/^(.{3,90}?)\s+(?:at|@|[-–—|])\s+(.{2,60})$/i);
    if (!match) continue;

    const title = match[1].trim();
    const company = match[2].trim();

    // A "title" that names a country is almost certainly a location line.
    if (GULF_COUNTRY.test(title)) continue;
    if (!/[a-z]/i.test(title) || !/[a-z]/i.test(company)) continue;

    const key = `${title.toLowerCase()}|${company.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const locationLine = lines.find((candidate) => GULF_COUNTRY.test(candidate)) || "";

    jobs.push({
      title,
      company,
      ...parseLocation(locationLine),
      experience: "",
      apply_url: links[jobs.length] ?? "",
      posted_hint: "",
      source_platform: "email",
    });
  }

  return jobs;
}

/** Sender/subject signatures used to pick a parser. */
export function detectDigestType(from: string, subject = ""): string {
  const haystack = `${from} ${subject}`.toLowerCase();
  if (/naukrigulf/.test(haystack)) return "naukrigulf";
  if (/linkedin/.test(haystack)) return "linkedin";
  if (/bayt/.test(haystack)) return "bayt";
  if (/gulftalent/.test(haystack)) return "gulftalent";
  return "generic";
}

/**
 * Parse a job-alert email, choosing the parser from its sender.
 * Falls back to the generic parser when a dedicated one yields nothing, so an
 * unexpected redesign degrades instead of silently importing zero jobs.
 */
export function parseJobEmail(input: {
  from: string;
  subject?: string;
  text: string;
  html?: string;
}): ParsedDigest {
  const { from, subject = "", text, html = "" } = input;
  const type = detectDigestType(from, subject);

  let jobs: ParsedEmailJob[] = [];
  switch (type) {
    case "naukrigulf":
      jobs = parseNaukrigulfDigest(text, html);
      break;
    case "linkedin":
      jobs = parseLinkedInAlert(text, html);
      break;
    case "bayt":
    case "gulftalent":
      jobs = parseGulfBoardAlert(text, html, type);
      break;
    default:
      jobs = parseGenericJobEmail(text, html);
  }

  if (jobs.length === 0 && type !== "generic") {
    const fallback = parseGenericJobEmail(text, html);
    if (fallback.length > 0) return { jobs: fallback, parser: `${type}->generic` };
  }

  return { jobs, parser: type };
}
