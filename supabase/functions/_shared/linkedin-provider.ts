// LinkedIn Provider for search and details
// Inspired by MCP/Service architecture

import { type LinkedInSearchInput } from "./linkedin-search.ts";
import { fetchProfileAwareLinkedInSearch, type LinkedInProfileContext } from "./linkedin-profile-search.ts";
import { fetchLinkedInJobHtml } from "./linkedin-job.ts";

export interface LinkedInProviderSearchInput extends LinkedInSearchInput {
  profile?: LinkedInProfileContext | null;
}

export class LinkedInProvider {
  /**
   * Search for jobs on LinkedIn
   */
  async searchJobs(input: LinkedInProviderSearchInput) {
    try {
      console.log(`[LinkedInProvider] Searching for "${input.keywords}" in "${input.location || 'Global'}"`);
      const { jobs } = await fetchProfileAwareLinkedInSearch({
        ...input,
        profile: input.profile || null,
      });

      return {
        success: true,
        jobs,
        count: jobs.length
      };
    } catch (err: any) {
      console.error(`[LinkedInProvider] Search failed:`, err.message);
      return {
        success: false,
        error: err.message,
        error_type: this.getErrorType(err.message)
      };
    }
  }

  /**
   * Get full details for a LinkedIn job
   */
  async getJobDetails(jobId: string, userId: string) {
    try {
      // Note: We reuse the enrichment logic from linkedin-job.ts which uses AI
      // but here we can add provider-specific logic if needed
      const { enrichLinkedInJob } = await import("./linkedin-job.ts");
      const details = await enrichLinkedInJob(jobId, userId);
      
      return {
        success: !!details,
        details
      };
    } catch (err: any) {
      console.error(`[LinkedInProvider] Detail fetch failed:`, err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  private getErrorType(msg: string): string {
    if (msg.includes("RATE_LIMITED")) return "RATE_LIMIT";
    if (msg.includes("status 401")) return "AUTH_ERROR";
    if (msg.includes("status 402")) return "BILLING_ERROR";
    return "UNKNOWN_ERROR";
  }
}

export const linkedinProvider = new LinkedInProvider();
