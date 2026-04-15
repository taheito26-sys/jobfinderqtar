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
 * Extracts job cards from LinkedIn Guest Search API HTML
 */
export function parseLinkedInJobCards(html: string): LinkedInJobSnippet[] {
  const snippets: LinkedInJobSnippet[] = [];
  
  // Regex to find <li> tags that represent job cards
  const cardRegex = /<li[^>]+data-id=["'](\d+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  
  while ((match = cardRegex.exec(html)) !== null) {
    const linkedin_job_id = match[1];
    const cardContent = match[2];
    
    // Extract title
    const titleMatch = cardContent.match(/<h3[^>]*class=["'][^'"]*base-search-card__title[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/h3>/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";
    
    // Extract company
    const companyMatch = cardContent.match(/<h4[^>]*class=["'][^'"]*base-search-card__subtitle[^'"]*["'][^>]*>[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/i) || 
                         cardContent.match(/<h4[^>]*class=["'][^'"]*base-search-card__subtitle[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/h4>/i);
    const company = companyMatch ? companyMatch[1].trim() : "Unknown Company";
    
    // Extract location
    const locationMatch = cardContent.match(/<span[^>]*class=["'][^'"]*job-search-card__location[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i);
    const location = locationMatch ? locationMatch[1].trim() : "Unknown Location";
    
    // Extract date text
    const dateMatch = cardContent.match(/<time[^>]*class=["'][^'"]*job-search-card__listdate[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/time>/i);
    const source_created_at_text = dateMatch ? dateMatch[1].trim() : undefined;
    
    // Extract link
    const linkMatch = cardContent.match(/<a[^>]*class=["'][^'"]*base-card__full-link[^'"]*["'][^>]*href=["']([^'"]+)["']/i);
    const apply_url = linkMatch ? linkMatch[1].split('?')[0] : `https://www.linkedin.com/jobs/view/${linkedin_job_id}`;

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
  console.log(`[LinkedInSearch] Fetching: ${searchUrl}`);
  
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });
  
  if (!response.ok) {
    if (response.status === 429) throw new Error("LinkedIn_RATE_LIMITED");
    throw new Error(`LinkedIn search failed with status ${response.status}`);
  }
  
  const html = await response.text();
  return parseLinkedInJobCards(html);
}
