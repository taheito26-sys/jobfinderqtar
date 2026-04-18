// LinkedIn Job Module
// Handles fetching and normalizing full LinkedIn job details.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getPipelineConfig } from './ai-pipeline.ts';
import {
  extractAllLinkedInJobIds,
  isLinkedInSearchUrl,
  extractLinkedInJobId,
  normalizeLinkedInUrl,
  buildLinkedInGuestSearchUrl,
} from './linkedin-job-helpers.ts';

export function getLinkedInCookieHeader(): string | null {
  const cookie = Deno.env.get('LINKEDIN_LI_AT_COOKIE') || Deno.env.get('LI_AT_COOKIE');
  return cookie ? `li_at=${cookie}` : null;
}

function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchLinkedInJobRawHtml(jobId: string): Promise<string> {
  const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  console.log('Fetching LinkedIn guest HTML:', guestUrl);
  const cookieHeader = getLinkedInCookieHeader();

  const res = await fetch(guestUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    },
  });

  if (!res.ok) throw new Error(`LinkedIn guest API returned ${res.status}`);
  return await res.text();
}

/** Extract ALL job IDs from a LinkedIn search/collection URL */
export { extractAllLinkedInJobIds, isLinkedInSearchUrl, extractLinkedInJobId, normalizeLinkedInUrl, buildLinkedInGuestSearchUrl };

/** Normalise a raw extracted job object into a clean, consistently shaped record */
export function normaliseJobFields(raw: Record<string, any>, fallbackUrl: string): Record<string, any> {
  return {
    title: raw.title || 'Untitled Job',
    company: raw.company || 'Unknown Company',
    location: raw.location || '',
    remote_type: raw.remote_type || 'unknown',
    description: raw.description || '',
    salary_min: raw.salary_min || null,
    salary_max: raw.salary_max || null,
    salary_currency: raw.salary_currency || null,
    employment_type: raw.employment_type || 'full-time',
    seniority_level: raw.seniority_level || '',
    requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
    apply_url: (raw.apply_url as string) || fallbackUrl,
    source_created_at: (raw.source_created_at as string | null) || null,
  };
}

/** Try LinkedIn's guest/public job posting endpoint */
export async function fetchLinkedInJobHtml(jobId: string): Promise<string> {
  const html = await fetchLinkedInJobRawHtml(jobId);

  // Minimal cleanup to reduce tokens for AI fallback.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 15000);
}

export function extractLinkedInJobDetailsFromHtml(html: string, jobId: string): Record<string, any> | null {
  const title = stripHtmlTags(
    html.match(/<h2[^>]*class="[^"]*top-card-layout__title[^"]*topcard__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ||
    html.match(/<h1[^>]*class="[^"]*top-card-layout__title[^"]*topcard__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    ''
  );
  const company = stripHtmlTags(
    html.match(/<a[^>]*class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
    html.match(/<span[^>]*class="[^"]*topcard__flavor[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
    ''
  );
  const locationMatches = [...html.matchAll(/<span[^>]*class="[^"]*topcard__flavor[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)];
  const location = stripHtmlTags(locationMatches[0]?.[1] || '');
  const postedText = stripHtmlTags(
    html.match(/<span[^>]*class="[^"]*posted-time-ago__text[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''
  );
  const descriptionHtml = html.match(/<div[^>]*class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const description = stripHtmlTags(descriptionHtml);
  const criteriaMatches = [...html.matchAll(/<li[^>]*class="[^"]*description__job-criteria-item[^"]*"[^>]*>[\s\S]*?<h3[^>]*class="[^"]*description__job-criteria-subheader[^"]*"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<span[^>]*class="[^"]*description__job-criteria-text[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/li>/gi)];
  const criteria = Object.fromEntries(criteriaMatches.map((match) => [
    stripHtmlTags(match[1]).toLowerCase(),
    stripHtmlTags(match[2]),
  ]));

  if (!title && !company && !description) return null;

  return normaliseJobFields({
    title: title || 'Untitled Job',
    company: company || 'Unknown Company',
    location: location || '',
    remote_type: /remote/i.test(`${location} ${description}`) ? 'remote' : 'unknown',
    description,
    employment_type: criteria['employment type']?.toLowerCase() || 'full-time',
    seniority_level: criteria['seniority level'] || '',
    requirements: description
      .split(/\n+/)
      .map((line) => line.trim().replace(/^[·•\-\u2022]\s*/, ''))
      .filter((line) => line.length >= 20)
      .slice(0, 8),
    apply_url: `https://www.linkedin.com/jobs/view/${jobId}/`,
    source_created_at: postedText || null,
  }, `https://www.linkedin.com/jobs/view/${jobId}/`);
}

/** Parse relative time like "3 days ago" into ISO string approximately */
export function parseLinkedInRelativeDate(text?: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const now = new Date();
  
  let offsetDays = 0;
  if (t.includes('minute') || t.includes('hour')) offsetDays = 0;
  else if (t.includes('day')) {
    const m = t.match(/(\d+)/);
    offsetDays = m ? parseInt(m[1]) : 1;
  } else if (t.includes('week')) {
    const m = t.match(/(\d+)/);
    offsetDays = (m ? parseInt(m[1]) : 1) * 7;
  } else if (t.includes('month')) {
    const m = t.match(/(\d+)/);
    offsetDays = (m ? parseInt(m[1]) : 1) * 30;
  } else {
    return null;
  }
  
  const d = new Date(now.getTime() - offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/** Main extraction logic using AI */
export async function enrichLinkedInJob(jobId: string, userId: string): Promise<Record<string, any> | null> {
  try {
    const rawHtml = await fetchLinkedInJobRawHtml(jobId);
    if (rawHtml.length < 200) return null;

    const direct = extractLinkedInJobDetailsFromHtml(rawHtml, jobId);
    if (direct) {
      return {
        ...direct,
        linkedin_job_id: jobId,
        source_platform: 'linkedin',
        raw_source_detail: { strategy: 'guest-html-direct' }
      };
    }

    const html = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 15000);

    const today = new Date().toISOString().split('T')[0];
    const jobUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;
    
    const prompt = `Analyse this LinkedIn job page content:
Today's date: ${today}
Source URL: ${jobUrl}

Return ONLY valid JSON:
{
  "title": string,
  "company": string,
  "location": string,
  "remote_type": "remote"|"hybrid"|"onsite"|"unknown",
  "description": string,
  "salary_min": number|null,
  "salary_max": number|null,
  "salary_currency": string|null,
  "employment_type": "full-time"|"part-time"|"contract"|"internship",
  "seniority_level": string,
  "requirements": string[],
  "apply_url": string,
  "source_created_at": string|null,
  "raw_detail": object
}

CONTENT:
${html}`;

    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    let extracted: any = null;

    // Try primary AI from config
    try {
      const config = await getPipelineConfig(userId);
      if (config.primary && config.primary.apiKey && config.primary.provider !== 'lovable') {
        const p = config.primary;
        const res = await fetch(p.url, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...(p.provider === 'anthropic' ? { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' } : { 'Authorization': `Bearer ${p.apiKey}` })
          },
          body: JSON.stringify({
            model: p.model,
            messages: [{ role: 'user', content: prompt }],
            ...(p.provider !== 'anthropic' ? { temperature: 0.1 } : { max_tokens: 4000 })
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          const content = p.provider === 'anthropic' ? data.content[0].text : data.choices[0].message.content;
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Primary AI enrichment failed, falling back to Lovable:', msg);
    }

    // Fallback to Lovable
    if (!extracted && lovableKey) {
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1
        })
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
      }
    }

    if (extracted) {
      const normalized = normaliseJobFields(extracted, jobUrl);
      return {
        ...normalized,
        linkedin_job_id: jobId,
        source_platform: 'linkedin',
        raw_source_detail: extracted
      };
    }

    return null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error enriching LinkedIn job ${jobId}:`, msg);
    return null;
  }
}
