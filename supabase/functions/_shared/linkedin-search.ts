// LinkedIn Native Search logic
// Based on logic from:
// 1. linkedin-jobs-api-py (Python reference)
// 2. felipfr/linkedin-mcpserver (MCP/Service reference)

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

/**
 * Maps readable time filters to LinkedIn f_TPR values
 */
function mapPostedWithinToLinkedIn(postedWithin?: string): string {
  switch (postedWithin) {
    case "24h": return "r86400";
    case "week": return "r604800";
    case "month": return "r2592000";
    default: return "";
  }
}

/**
 * Maps remote preference to LinkedIn f_WT values
 * 1: On-site, 2: Remote, 3: Hybrid
 */
function mapRemotePreferenceToLinkedIn(remotePref?: string): string {
  switch (remotePref) {
    case "remote": return "2";
    case "onsite": return "1";
    case "hybrid": return "3";
    default: return "";
  }
}

/**
 * Builds a LinkedIn guest job search URL
 */
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
  
  // LinkedIn uses "start" for pagination (usually multiples of 25)
  const start = pageNum * limit;
  params.append("start", start.toString());
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Extracts job cards from LinkedIn Guest Search API HTML.
 * Supports multiple card structures observed in production.
 */
export function parseLinkedInJobCards(html: string): LinkedInJobSnippet[] {
  const snippets: LinkedInJobSnippet[] = [];
  
  // Detect blockage
  if (html.includes('authwall') || html.includes('checkpoint/lg/login')) {
    console.error('[LinkedInSearch] Detected Login/Auth Wall');
    return [];
  }
  if (html.includes('challenge-form') || html.includes('captcha')) {
    console.error('[LinkedInSearch] Detected CAPTCHA Challenge');
    return [];
  }

  // Regex to find <li> tags that represent job cards
  // LinkedIn uses data-entity-id or data-id for the job identifier
  const cardRegex = /<li[^>]+(data-id|data-entity-id)=["']([^'"]+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  
  while ((match = cardRegex.exec(html)) !== null) {
    const rawJobId = match[2];
    const linkedin_job_id = rawJobId.includes(':') ? rawJobId.split(':').pop()! : rawJobId;
    const cardContent = match[3];
    
    // Extract title - Support base-search-card__title AND result-card__title
    const titleMatch = cardContent.match(/<h3[^>]*class=["'][^'"]*(base-search-card__title|result-card__title)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/h3>/i);
    const title = titleMatch ? titleMatch[2].trim() : "Untitled";
    
    // Extract company - Support base-search-card__subtitle AND result-card__subtitle
    const companyMatch = cardContent.match(/<(h4|span)[^>]*class=["'][^'"]*(base-search-card__subtitle|result-card__subtitle)[^'"]*["'][^>]*>[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/i) || 
                         cardContent.match(/<(h4|span)[^>]*class=["'][^'"]*(base-search-card__subtitle|result-card__subtitle)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/(h4|span)>/i);
    const company = companyMatch ? companyMatch[3].trim() : "Unknown Company";
    
    // Extract location - Support job-search-card__location AND result-card__location
    const locationMatch = cardContent.match(/<span[^>]*class=["'][^'"]*(job-search-card__location|result-card__location)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i);
    const location = locationMatch ? locationMatch[2].trim() : "Unknown Location";
    
    // Extract date text - Support job-search-card__listdate AND result-card__listdate
    const dateMatch = cardContent.match(/<time[^>]*class=["'][^'"]*(job-search-card__listdate|result-card__listdate)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/time>/i);
    const source_created_at_text = dateMatch ? dateMatch[2].trim() : undefined;
    
    // Extract link - Support base-card__full-link OR result-card__full-link
    const linkMatch = cardContent.match(/<a[^>]*class=["'][^'"]*(base-card__full-link|result-card__full-link)[^'"]*["'][^>]*href=["']([^'"]+)["']/i);
    const apply_url = linkMatch ? linkMatch[2].split('?')[0] : `https://www.linkedin.com/jobs/view/${linkedin_job_id}`;

    snippets.push({
      linkedin_job_id,
      title,
      company,
      location,
      apply_url,
      source_created_at_text,
      raw_card_payload: { html: cardContent }
    });
  }
  
  return snippets;
}

/**
 * Fetches search results from LinkedIn
 */
export async function fetchLinkedInSearch(input: LinkedInSearchInput): Promise<LinkedInJobSnippet[]> {
  const searchUrl = buildLinkedInSearchUrl(input);
  console.log(`[LinkedInSearch] Request URL: ${searchUrl}`);
  
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });
  
  console.log(`[LinkedInSearch] HTTP Status: ${response.status}`);
  
  if (!response.ok) {
    if (response.status === 429) throw new Error("LinkedIn_RATE_LIMITED");
    throw new Error(`LinkedIn search failed with status ${response.status}`);
  }
  
  const html = await response.text();
  console.log(`[LinkedInSearch] HTML Length: ${html.length}`);
  console.log(`[LinkedInSearch] HTML Snippet: ${html.substring(0, 1000).replace(/\s+/g, ' ')}`);
  
  const cards = parseLinkedInJobCards(html);
  console.log(`[LinkedInSearch] Parsed Card Count: ${cards.length}`);
  
  return cards;
}
