// LinkedIn Search Module
// Handles building LinkedIn Guest Search URLs and extracting job card data.

export interface LinkedInSearchConfig {
  keywords: string[];
  location?: string;
  remote_preference?: "remote" | "onsite" | "hybrid" | "flexible";
  posted_within?: "24h" | "week" | "month" | "any";
  page_limit?: number;
  results_per_page?: number;
}

export interface LinkedInJobCard {
  linkedin_job_id: string;
  title: string;
  company: string;
  location: string;
  listed_at_text?: string;
  apply_url: string;
  search_url: string;
  search_keyword: string;
  search_location: string;
  page_number: number;
  raw_card_payload: any;
}

/**
 * Maps readable time filters to LinkedIn f_TPR values
 */
export function mapPostedWithinToLinkedIn(postedWithin?: string): string {
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
export function mapRemotePreferenceToLinkedIn(remotePref?: string): string {
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
export function buildLinkedInSearchUrl(
  keyword: string, 
  location: string = "", 
  filters: Partial<LinkedInSearchConfig> = {}, 
  pageNum: number = 0
): string {
  const baseUrl = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
  const params = new URLSearchParams();
  
  params.append("keywords", keyword);
  if (location) params.append("location", location);
  
  const f_TPR = mapPostedWithinToLinkedIn(filters.posted_within);
  if (f_TPR) params.append("f_TPR", f_TPR);
  
  const f_WT = mapRemotePreferenceToLinkedIn(filters.remote_preference);
  if (f_WT) params.append("f_WT", f_WT);
  
  // LinkedIn uses "start" for pagination (usually multiples of 25)
  const start = pageNum * (filters.results_per_page || 25);
  params.append("start", start.toString());
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Extracts job cards from LinkedIn Guest Search API HTML
 * Note: Guest Search API returns a list of <li> elements directly
 */
export function extractJobCardsFromHtml(
  html: string, 
  searchUrl: string, 
  keyword: string, 
  location: string, 
  pageNum: number
): LinkedInJobCard[] {
  const cards: LinkedInJobCard[] = [];
  
  // Regex to find <li> tags that represent job cards
  // LinkedIn guest search li usually looks like: <li data-id="123456789">...</li>
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
    const loc = locationMatch ? locationMatch[1].trim() : location;
    
    // Extract date text
    const dateMatch = cardContent.match(/<time[^>]*class=["'][^'"]*job-search-card__listdate[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/time>/i);
    const listed_at_text = dateMatch ? dateMatch[1].trim() : undefined;
    
    // Extract link
    const linkMatch = cardContent.match(/<a[^>]*class=["'][^'"]*base-card__full-link[^'"]*["'][^>]*href=["']([^'"]+)["']/i);
    const apply_url = linkMatch ? linkMatch[1].split('?')[0] : `https://www.linkedin.com/jobs/view/${linkedin_job_id}`;

    cards.push({
      linkedin_job_id,
      title,
      company,
      location: loc,
      listed_at_text,
      apply_url,
      search_url: searchUrl,
      search_keyword: keyword,
      search_location: location,
      page_number: pageNum,
      raw_card_payload: { html: cardContent }
    });
  }
  
  return cards;
}

/**
 * Fetches a search page and extracts cards
 */
export async function fetchLinkedInSearchPage(
  keyword: string, 
  location: string, 
  filters: Partial<LinkedInSearchConfig>, 
  pageNum: number
): Promise<LinkedInJobCard[]> {
  const searchUrl = buildLinkedInSearchUrl(keyword, location, filters, pageNum);
  console.log(`Fetching LinkedIn Search Page: ${searchUrl}`);
  
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });
  
  if (!response.ok) {
    if (response.status === 429) {
      console.warn("LinkedIn search rate limited (429)");
      throw new Error("LinkedIn rate limited");
    }
    throw new Error(`LinkedIn search failed with status ${response.status}`);
  }
  
  const html = await response.text();
  return extractJobCardsFromHtml(html, searchUrl, keyword, location, pageNum);
}
