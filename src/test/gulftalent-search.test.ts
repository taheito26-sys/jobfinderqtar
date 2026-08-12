import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  filterByKeyword,
  parseGulfTalentDate,
  parseGulfTalentHtml,
} from '../../supabase/functions/_shared/gulftalent-search.ts';

// Captured from https://www.gulftalent.com/qatar/jobs — the live browse page.
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gulftalent-qatar-jobs.html'),
  'utf-8',
);

describe('parseGulfTalentHtml', () => {
  const jobs = parseGulfTalentHtml(fixture, new Date('2026-08-13T00:00:00Z'));

  it('parses job rows from the live browse-page markup', () => {
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('extracts title, company, location and a resolvable apply URL', () => {
    for (const job of jobs) {
      expect(job.title).not.toBe('');
      expect(job.title).not.toMatch(/^https?:/);
      expect(job.company).not.toBe('');
      expect(job.location).not.toBe('');
      expect(job.apply_url).toMatch(/^https:\/\/www\.gulftalent\.com\/qatar\/jobs\//);
      expect(job.external_id).toMatch(/^\d{4,}$/);
      expect(job.source_platform).toBe('gulftalent');
    }
  });

  it('does not mistake the company link for the job link', () => {
    for (const job of jobs) {
      expect(job.apply_url).not.toContain('/companies/');
    }
  });

  it('returns nothing rather than throwing when the markup changes', () => {
    expect(parseGulfTalentHtml('<html><body>no jobs here</body></html>')).toEqual([]);
  });
});

describe('parseGulfTalentDate', () => {
  const now = new Date('2026-08-13T00:00:00Z');

  it('resolves a day/month listing against the current year', () => {
    expect(parseGulfTalentDate('11 Aug', now)).toBe('2026-08-11T00:00:00.000Z');
  });

  it('rolls back a year when the date would otherwise be in the future', () => {
    expect(parseGulfTalentDate('20 Dec', now)).toBe('2025-12-20T00:00:00.000Z');
  });

  it('returns null for unparseable text', () => {
    expect(parseGulfTalentDate('')).toBeNull();
    expect(parseGulfTalentDate('sometime')).toBeNull();
  });
});

describe('filterByKeyword', () => {
  const jobs = [
    { title: 'Network Engineer', company: 'Ooredoo' },
    { title: 'Head Chef', company: 'Marriott' },
    { title: 'Accountant', company: 'Network Systems LLC' },
  ] as ReturnType<typeof parseGulfTalentHtml>;

  it('keeps jobs matching a keyword token in the title or company', () => {
    const matched = filterByKeyword(jobs, 'network');
    expect(matched.map((j) => j.title)).toEqual(['Network Engineer', 'Accountant']);
  });

  it('falls back to the full feed when the keyword has no usable tokens', () => {
    // Tokens shorter than 3 chars are dropped; with nothing left to match on,
    // filtering everything out would be worse than returning the raw feed.
    expect(filterByKeyword(jobs, 'of a').length).toBe(jobs.length);
  });

  it('returns nothing when a real keyword matches no listing', () => {
    // GulfTalent only exposes the ~25 most recent jobs, so a legitimate miss is
    // expected — better than handing back unrelated roles.
    expect(filterByKeyword(jobs, 'anaesthetist')).toEqual([]);
  });

  it('returns everything when no keyword is supplied', () => {
    expect(filterByKeyword(jobs, '').length).toBe(jobs.length);
  });
});
