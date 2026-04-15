// LinkedIn Job Module
// Handles fetching and normalizing full LinkedIn job details.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getPipelineConfig } from './ai-pipeline.ts';

/** Extract ALL job IDs from a LinkedIn search/collection URL */
export function extractAllLinkedInJobIds(url: string): string[] {
  const ids = new Set<string>();

  // currentJobId param
  const currentMatch = url.match(/currentJobId=(\d+)/);
  if (currentMatch) ids.add(currentMatch[1]);

  // originToLandingJobPostings param (comma-separated IDs)
  const landingMatch = url.match(/originToLandingJobPostings=([^&]+)/);
  if (landingMatch) {
    const decoded = decodeURIComponent(landingMatch[1]);
    decoded.split(/[,%2C]+/).forEach(id => {
      const trimmed = id.trim();
      if (/^\d+$/.test(trimmed)) ids.add(trimmed);
    });
  }

  // /jobs/view/ID pattern
  const viewMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) ids.add(viewMatch[1]);

  return [...ids];
}

/** Check if this is a LinkedIn search/collection page (not a single job view) */
export function isLinkedInSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname;
    // Search pages, collections, alerts
    if (path.includes('/jobs/search') || path.includes('/jobs/collections')) return true;
    // Has multiple job IDs
    if (u.searchParams.get('originToLandingJobPostings')) return true;
    return false;
  } catch { return false; }
}

/** Extract LinkedIn Job ID from various URL patterns */
export function extractLinkedInJobId(url: string): string | null {
  const match = url.match(/\/jobs\/view\/(\d+)/) || 
                url.match(/currentJobId=(\d+)/) || 
                url.match(/\/jobs\/search\/\?.*jobId=(\d+)/);
  return match ? match[1] : null;
}

/** Normalize LinkedIn URL by removing tracking parameters */
export function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('linkedin.com')) {
      // Keep only clean path for job view
      const jobId = extractLinkedInJobId(url);
      if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;
    }
    return url;
  } catch {
    return url;
  }
}

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
  const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  console.log('Fetching LinkedIn guest HTML:', guestUrl);
  
  const res = await fetch(guestUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  
  if (!res.ok) throw new Error(`LinkedIn guest API returned ${res.status}`);
  const html = await res.text();
  
  // Minimal cleanup to reduce tokens
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
    const html = await fetchLinkedInJobHtml(jobId);
    if (html.length < 200) return null;

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
    } catch (e) {
      console.warn('Primary AI enrichment failed, falling back to Lovable:', e.message);
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
  } catch (e) {
    console.error(`Error enriching LinkedIn job ${jobId}:`, e.message);
    return null;
  }
}
