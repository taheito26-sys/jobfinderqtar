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
 * Strategy 1: Regular card-based parsing
 */
function parseStrategyCardBased(html: string): LinkedInJobSnippet[] {
  const snippets: LinkedInJobSnippet[] = [];
  const cardRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const cardContent = match[1];

    // Extract job ID from data-entity-urn attribute which has format: urn:li:jobPosting:XXXXX
    const urnMatch = cardContent.match(/data-entity-urn=["']urn:li:jobPosting:(\d+)["']/i);
    if (!urnMatch) continue; // Skip if no valid job posting URN found

    const linkedin_job_id = urnMatch[1];
    
    const titleMatch = cardContent.match(/<h3[^>]*class=["'][^'"]*(base-search-card__title|result-card__title|job-search-card__title)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/h3>/i);
    const title = titleMatch ? titleMatch[2].trim() : "Untitled";
    
    const companyMatch = cardContent.match(/<(h4|span)[^>]*class=["'][^'"]*(base-search-card__subtitle|result-card__subtitle|job-search-card__subtitle)[^'"]*["'][^>]*>[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/i) || 
                         cardContent.match(/<(h4|span)[^>]*class=["'][^'"]*(base-search-card__subtitle|result-card__subtitle|job-search-card__subtitle)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/(h4|span)>/i);
    const company = companyMatch ? companyMatch[3].trim() : "Unknown Company";
    
    const locationMatch = cardContent.match(/<span[^>]*class=["'][^'"]*(job-search-card__location|result-card__location)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i);
    const location = locationMatch ? locationMatch[2].trim() : "Unknown Location";
    
    const dateMatch = cardContent.match(/<time[^>]*class=["'][^'"]*(job-search-card__listdate|result-card__listdate)[^'"]*["'][^>]*>\s*([\s\S]*?)\s*<\/time>/i);
    const source_created_at_text = dateMatch ? dateMatch[2].trim() : undefined;
    
    const linkMatch = cardContent.match(/<a[^>]*class=["'][^'"]*(base-card__full-link|result-card__full-link|job-search-card__full-link)[^'"]*["'][^>]*href=["']([^'"]+)["']/i);
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
 * Strategy 2: Link-based discovery
 * Finds all /jobs/view/ID links and tries to find card info nearby
 */
function parseStrategyLinkBased(html: string): LinkedInJobSnippet[] {
  const snippets: LinkedInJobSnippet[] = [];
  const linkRegex = /\/jobs\/view\/(\d+)/g;
  const seenIds = new Set<string>();
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const jobId = match[1];
    if (seenIds.has(jobId)) continue;
    seenIds.add(jobId);
    
    // Try to find context around this link
    const linkPos = match.index;
    const startPos = Math.max(0, linkPos - 400);
    const endPos = Math.min(html.length, linkPos + 600);
    const context = html.substring(startPos, endPos);
    
    // Basic extraction from context
    const titleMatch = context.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || context.match(/title["']:["']([^'"]+)["']/i);
    const companyMatch = context.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) || context.match(/companyName["']:["']([^'"]+)["']/i);
    const locationMatch = context.match(/<span[^>]*class=["'][^'"]*location[^'"]*["'][^>]*>([\s\S]*?)<\/span>/i);

    snippets.push({
      linkedin_job_id: jobId,
      title: titleMatch ? titleMatch[1].trim() : "Link Discovery",
      company: companyMatch ? companyMatch[1].trim() : "Unknown",
      location: locationMatch ? locationMatch[1].trim() : "Unknown",
      apply_url: `https://www.linkedin.com/jobs/view/${jobId}`,
      raw_card_payload: { strategy: 'link-discovery', context: context.substring(0, 500) }
    });
  }
  return snippets;
}

export function parseLinkedInJobCards(html: string): LinkedInJobSnippet[] {
  // Try Strategy 1
  let cards = parseStrategyCardBased(html);
  
  // If Strategy 1 fails, try Strategy 2
  if (cards.length === 0) {
    console.log('[LinkedInSearch] Strategy 1 failed, trying Strategy 2 (Link-based)...');
    cards = parseStrategyLinkBased(html);
  }
  
  return cards;
}

export async function fetchLinkedInSearch(input: LinkedInSearchInput): Promise<LinkedInJobSnippet[]> {
  const searchUrl = buildLinkedInSearchUrl(input);
  console.log(`[LinkedInSearch] Final Request URL: ${searchUrl}`);
  
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });
  
  console.log(`[LinkedInSearch] HTTP Status: ${response.status}`);
  const html = await response.text();
  console.log(`[LinkedInSearch] Response HTML Length: ${html.length}`);
  console.log(`[LinkedInSearch] HTML Snippet: ${html.substring(0, 1500).replace(/\s+/g, ' ')}`);
  
  if (!response.ok) {
    if (response.status === 429) throw new Error("LinkedIn_RATE_LIMITED");
    throw new Error(`LinkedIn search failed with status ${response.status}`);
  }
  
  const cards = parseLinkedInJobCards(html);
  console.log(`[LinkedInSearch] Parsed Card Count: ${cards.length}`);
  
  if (cards.length === 0) {
    const indicators = [
      "sign in", "join now", "captcha", "verify you are human", 
      "jobs-search__results-list", "base-card", "job-search-card"
    ];
    const present = indicators.filter(i => html.toLowerCase().includes(i));
    console.log(`[LinkedInSearch] Zero results. Present indicators: ${present.join(', ') || 'none'}`);
  }
  
  return cards;
}
