// LinkedIn normalization logic

export function normalizeLinkedInJob(snippet: any, details?: any): any {
  const isEnriched = !!details;
  
  // Calculate source_created_at from relative text if present
  let sourceCreatedAt = null;
  const dateText = details?.source_created_at || snippet.source_created_at_text;
  
  if (dateText) {
    sourceCreatedAt = parseRelativeDate(dateText);
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
      source: "linkedin-native"
    }
  };
}

/** Parse relative time like "3 days ago" into ISO string approximately */
function parseRelativeDate(text?: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  
  // If it's already an ISO string or date-like, return it
  if (t.includes('t') && t.includes('z') && t.length > 15) return text;
  
  const now = new Date();
  let offsetDays = 0;
  
  const m = t.match(/(\d+)/);
  const val = m ? parseInt(m[1]) : 1;

  if (t.includes('minute') || t.includes('hour')) {
    offsetDays = 0;
  } else if (t.includes('day')) {
    offsetDays = val;
  } else if (t.includes('week')) {
    offsetDays = val * 7;
  } else if (t.includes('month')) {
    offsetDays = val * 30;
  } else {
    return null;
  }
  
  const d = new Date(now.getTime() - offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString();
}
