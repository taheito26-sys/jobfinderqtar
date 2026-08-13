/**
 * Minimal Gmail API client for job-alert ingestion.
 *
 * Scope used: https://www.googleapis.com/auth/gmail.readonly
 * Read-only is deliberate — this feature never needs to send, modify or delete
 * mail, and Google's review process treats read-only far more leniently than
 * full mailbox access.
 *
 * Access tokens are short-lived (~1h) and refreshed from the stored refresh
 * token on demand. Only the refresh token is persisted.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  internalDate: string;
}

/**
 * Read an edge-function environment variable.
 *
 * Reached through globalThis rather than the bare `Deno` global so this module
 * can also be imported by the (Node-based) test suite, which exercises the pure
 * decoding and query-building helpers without a Deno runtime.
 */
function requireEnv(name: string): string {
  const runtime = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
  const value = runtime?.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** Exchange an OAuth authorization code for tokens (initial connect). */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GmailTokens> {
  const body = new URLSearchParams({
    code,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await resp.json();
  if (!resp.ok) {
    throw new Error(
      `Token exchange failed (${resp.status}): ${payload?.error_description || payload?.error || "unknown"}`,
    );
  }
  return payload as GmailTokens;
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<GmailTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await resp.json();
  if (!resp.ok) {
    // invalid_grant means the user revoked access or the token expired for
    // inactivity — the caller should clear the connection and re-prompt.
    throw new Error(
      `Token refresh failed (${resp.status}): ${payload?.error || "unknown"}`,
    );
  }
  return payload as GmailTokens;
}

/** Gmail returns base64url with no padding. */
export function decodeBase64Url(data: string): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
}

/**
 * Walk a MIME tree collecting the text/plain and text/html bodies.
 * Digest emails are usually multipart/alternative, sometimes nested inside
 * multipart/mixed, so this recurses rather than assuming a shape.
 */
export function extractBodies(payload: GmailPart | undefined): { text: string; html: string } {
  let text = "";
  let html = "";

  const walk = (part: GmailPart | undefined) => {
    if (!part) return;

    const mime = (part.mimeType || "").toLowerCase();
    const data = part.body?.data;

    if (data) {
      if (mime === "text/plain" && !text) text = decodeBase64Url(data);
      else if (mime === "text/html" && !html) html = decodeBase64Url(data);
    }

    for (const child of part.parts || []) walk(child);
  };

  walk(payload);
  return { text, html };
}

/** Derive a readable text body from HTML when the sender omits text/plain. */
export function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    // Block-level boundaries become newlines so line-oriented parsers still work.
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<td[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  const match = (headers || []).find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  );
  return match?.value || "";
}

/** List message IDs matching a Gmail search query. */
export async function listMessageIds(
  accessToken: string,
  query: string,
  maxResults = 25,
): Promise<string[]> {
  const url = `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Gmail list failed (${resp.status}): ${detail.slice(0, 200)}`);
  }

  const payload = await resp.json();
  return (payload?.messages || []).map((m: { id: string }) => m.id);
}

/** Fetch one message and flatten it into headers + bodies. */
export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage | null> {
  const resp = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    console.warn(`[gmail] Failed to fetch message ${messageId}: HTTP ${resp.status}`);
    return null;
  }

  const payload = await resp.json();
  const { text, html } = extractBodies(payload?.payload);

  return {
    id: messageId,
    from: headerValue(payload?.payload?.headers, "From"),
    subject: headerValue(payload?.payload?.headers, "Subject"),
    // Fall back to a text rendering of the HTML when text/plain is absent.
    text: text || htmlToText(html),
    html,
    internalDate: String(payload?.internalDate || ""),
  };
}

/** The Gmail address behind the grant, shown in the UI. */
export async function getProfileEmail(accessToken: string): Promise<string> {
  const resp = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return "";
  const payload = await resp.json();
  return String(payload?.emailAddress || "");
}

/**
 * Gmail search query matching the job-alert senders we can parse.
 * `newer_than` bounds the scan so a first connect does not walk years of mail.
 */
export function buildJobAlertQuery(days = 14): string {
  const senders = [
    "naukrigulf.com",
    "linkedin.com",
    "bayt.com",
    "gulftalent.com",
  ]
    .map((domain) => `from:${domain}`)
    .join(" OR ");

  return `(${senders}) newer_than:${days}d`;
}
