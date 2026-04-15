// LinkedIn normalization logic

export function normalizeLinkedInJob(snippet: any, details?: any): any {
  const isEnriched = !!details;

  // Calculate source_created_at from relative text or ISO date string
  let sourceCreatedAt = null;
  const dateText = details?.source_created_at || snippet.source_created_at_text;
  if (dateText) {
    sourceCreatedAt = parseJobDate(dateText);
  }

  return {
    title: (details?.title || snippet.title || "Untitled Job").trim(),
    company: (details?.company || snippet.company || "Unknown Company").trim(),
    location: (details?.location || snippet.location || "").trim(),
    remote_type: details?.remote_type || "unknown",
    employment_type: details?.employment_type || "full-time",
    seniority_level: details?.seniority_level || "",
    description: details?.description || snippet.description || "",
    apply_url: details?.apply_url || snippet.apply_url || "",
    source_url: `https://www.linkedin.com/jobs/view/${snippet.linkedin_job_id}/`,
    source_created_at: sourceCreatedAt,
    linkedin_job_id: snippet.linkedin_job_id,
    canonical_url: `https://www.linkedin.com/jobs/view/${snippet.linkedin_job_id}/`,
    normalization_status: isEnriched ? "valid" : "incomplete",
    raw_data: {
      snippet,
      details: details || null,
      source: "linkedin-native",
    },
  };
}

/**
 * Parse a LinkedIn date value into an ISO timestamp string.
 *
 * Handles three formats:
 *  1. ISO date from <time datetime="YYYY-MM-DD"> attribute  (JobSpy reference approach)
 *  2. Full ISO timestamp ("2026-04-15T10:00:00Z")
 *  3. Relative text ("3 days ago", "2 weeks ago", "just now")
 */
function parseJobDate(text?: string): string | null {
  if (!text) return null;
  const t = text.trim();

  // ── Format 1: ISO date from datetime attribute e.g. "2026-04-15" ──────────
  // Reference: JobSpy uses datetime.strptime(datetime_str, "%Y-%m-%d")
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return new Date(t + "T00:00:00.000Z").toISOString();
  }

  // ── Format 2: Full ISO timestamp already ─────────────────────────────────
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    return new Date(t).toISOString();
  }

  // ── Format 3: Relative text ("3 days ago", "2 weeks ago", etc.) ──────────
  // Scrapy Playbook extracts time::text which yields human-readable strings
  const lower = t.toLowerCase();
  const now = new Date();
  let offsetMs = 0;

  const numMatch = lower.match(/(\d+)/);
  const val = numMatch ? parseInt(numMatch[1]) : 1;

  if (lower.includes("second") || lower.includes("just now")) {
    offsetMs = 0;
  } else if (lower.includes("minute")) {
    offsetMs = val * 60 * 1000;
  } else if (lower.includes("hour")) {
    offsetMs = val * 60 * 60 * 1000;
  } else if (lower.includes("day")) {
    offsetMs = val * 24 * 60 * 60 * 1000;
  } else if (lower.includes("week")) {
    offsetMs = val * 7 * 24 * 60 * 60 * 1000;
  } else if (lower.includes("month")) {
    offsetMs = val * 30 * 24 * 60 * 60 * 1000;
  } else {
    return null;
  }

  return new Date(now.getTime() - offsetMs).toISOString();
}
