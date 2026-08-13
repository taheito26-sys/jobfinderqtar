import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectDigestType,
  parseGenericJobEmail,
  parseGulfBoardAlert,
  parseJobEmail,
  parseLinkedInAlert,
  parseLocation,
  parseNaukrigulfDigest,
  stripAuthTokens,
} from '../../supabase/functions/_shared/email-job-parsers.ts';
import { htmlToText } from '../../supabase/functions/_shared/gmail-client.ts';

// A real "Your daily job matches" digest from recommendedjobs@naukrigulf.com.
const digest = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'naukrigulf-digest.txt'),
  'utf-8',
);

describe('parseNaukrigulfDigest', () => {
  const jobs = parseNaukrigulfDigest(digest);

  it('extracts every job in the digest', () => {
    expect(jobs).toHaveLength(15);
  });

  it('parses the first job correctly', () => {
    expect(jobs[0]).toMatchObject({
      title: 'Head of Information Technology (IT)',
      company: 'Confidential Company',
      location: 'Sharjah , Dubai , Abu Dhabi - United Arab Emirates (UAE)',
      country: 'United Arab Emirates (UAE)',
      is_qatar: false,
      experience: '10 - 16 Years',
      source_platform: 'naukrigulf',
    });
  });

  it('handles a company name followed by a blank line', () => {
    // "BAE Systems" is separated from its experience line by an empty line.
    const bae = jobs.find((job) => job.company === 'BAE Systems');
    expect(bae).toMatchObject({
      title: 'Senior IT/ICT Engineer',
      location: 'Qatar - Qatar',
      experience: '8 - 13 Years',
    });
  });

  it('flags the single Qatar role and no others', () => {
    const qatar = jobs.filter((job) => job.is_qatar);
    expect(qatar).toHaveLength(1);
    expect(qatar[0].title).toBe('Senior IT/ICT Engineer');
  });

  it('never mistakes chrome text for a job', () => {
    const titles = jobs.map((job) => job.title);
    expect(titles).not.toContain('Here are job opportunities for you');
    expect(titles).not.toContain('View all jobs');
    expect(titles).not.toContain('Do you find these jobs relevant?');
    for (const job of jobs) {
      expect(job.title).not.toMatch(/^hi\b/i);
      expect(job.company).not.toMatch(/easy apply/i);
      expect(job.title).not.toMatch(/^\d+\s*-\s*\d+\s*years?$/i);
    }
  });

  it('captures titles containing separators and punctuation', () => {
    const titles = jobs.map((job) => job.title);
    expect(titles).toContain('IT Director / IT Manager – Saudi Arabia');
    expect(titles).toContain('Chief Technology Officer (CTO) - Octopus by RTG');
    expect(titles).toContain('IT Engineering Manager Endpoint, SaaS');
  });

  it('keeps repeated titles from different companies', () => {
    const itManagers = jobs.filter((job) => job.title === 'IT Manager');
    expect(itManagers.length).toBeGreaterThan(1);
    expect(new Set(itManagers.map((j) => j.company)).size).toBeGreaterThan(1);
  });

  it('records the posted-date hint in both formats', () => {
    expect(jobs[0].posted_hint).toBe('8 Jul');
    expect(jobs[1].posted_hint).toBe('2d');
  });
});

describe('stripAuthTokens', () => {
  it('removes the NaukriGulf auto-login token', () => {
    const cleaned = stripAuthTokens(
      'https://www.naukrigulf.com/job-123?aut=SECRET&uid=99&title=engineer',
    );
    expect(cleaned).not.toContain('SECRET');
    expect(cleaned).not.toContain('uid');
    expect(cleaned).toContain('title=engineer');
  });

  it('removes LinkedIn identity and tracking parameters', () => {
    const cleaned = stripAuthTokens(
      'https://www.linkedin.com/jobs/view/1?midToken=T&midSig=S&trk=eml&eid=9',
    );
    expect(cleaned).toBe('https://www.linkedin.com/jobs/view/1');
  });

  it('drops credentials embedded in the URL authority', () => {
    expect(stripAuthTokens('https://user:pass@example.com/job')).toBe('https://example.com/job');
  });

  it('rejects anything it cannot safely parse', () => {
    // An unparseable string could still contain a raw token, so it is dropped.
    expect(stripAuthTokens('not-a-url?aut=SECRET')).toBe('');
    expect(stripAuthTokens('javascript:alert(1)')).toBe('');
    expect(stripAuthTokens('')).toBe('');
  });

  it('leaves a clean URL untouched apart from the trailing slash', () => {
    expect(stripAuthTokens('https://www.naukrigulf.com/job-123')).toBe(
      'https://www.naukrigulf.com/job-123',
    );
  });
});

describe('parseNaukrigulfDigest link handling', () => {
  it('attaches sanitised links from the HTML part', () => {
    const html = `
      <a href="https://www.naukrigulf.com/job-a?aut=TOKEN1">Head of Information Technology (IT)</a>
      <a href="https://www.naukrigulf.com/job-b?aut=TOKEN2">IT Engineering Manager Endpoint, SaaS</a>
      <a href="https://www.naukrigulf.com/unsubscribe?aut=TOKEN3">Unsubscribe</a>
    `;
    const jobs = parseNaukrigulfDigest(digest, html);

    expect(jobs[0].apply_url).toBe('https://www.naukrigulf.com/job-a');
    expect(jobs[1].apply_url).toBe('https://www.naukrigulf.com/job-b');
    for (const job of jobs) {
      expect(job.apply_url).not.toMatch(/TOKEN|unsubscribe/);
    }
  });

  it('still parses jobs when no HTML part is present', () => {
    expect(parseNaukrigulfDigest(digest, '')).toHaveLength(15);
    expect(parseNaukrigulfDigest(digest, '')[0].apply_url).toBe('');
  });
});

describe('parseLocation', () => {
  it('splits city lists from the country', () => {
    expect(parseLocation('Sharjah , Dubai - United Arab Emirates (UAE)')).toMatchObject({
      country: 'United Arab Emirates (UAE)',
      is_qatar: false,
    });
  });

  it('recognises Qatar locations', () => {
    expect(parseLocation('Qatar - Qatar').is_qatar).toBe(true);
    expect(parseLocation('Doha - Qatar').is_qatar).toBe(true);
    expect(parseLocation('Lusail - Qatar').is_qatar).toBe(true);
  });

  it('handles an empty location', () => {
    expect(parseLocation('')).toEqual({ location: '', country: '', is_qatar: false });
  });
});

describe('detectDigestType', () => {
  it('routes by sender address', () => {
    expect(detectDigestType('recommendedjobs@naukrigulf.com')).toBe('naukrigulf');
    expect(detectDigestType('jobs-noreply@linkedin.com')).toBe('linkedin');
    expect(detectDigestType('alerts@bayt.com')).toBe('bayt');
    expect(detectDigestType('no-reply@gulftalent.com')).toBe('gulftalent');
    expect(detectDigestType('careers@somecompany.com')).toBe('generic');
  });
});

describe('parseLinkedInAlert', () => {
  it('parses the "Company · Location" layout', () => {
    const text = [
      'Your job alert for solutions architect',
      'Senior Solutions Architect',
      'Ooredoo · Doha, Qatar',
      'Cloud Architect',
      'Vodafone · Doha, Qatar',
    ].join('\n');

    const jobs = parseLinkedInAlert(text);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: 'Senior Solutions Architect',
      company: 'Ooredoo',
      is_qatar: true,
      source_platform: 'linkedin',
    });
  });
});

describe('parseGulfBoardAlert', () => {
  it('parses stacked title/company/location lines', () => {
    const text = [
      'New jobs matching your search',
      'Network Engineer',
      'Ooredoo',
      'Doha, Qatar',
      'IT Manager',
      'Vodafone Qatar',
      'Doha, Qatar',
    ].join('\n');

    const jobs = parseGulfBoardAlert(text, '', 'bayt');
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs[0]).toMatchObject({
      title: 'Network Engineer',
      company: 'Ooredoo',
      is_qatar: true,
      source_platform: 'bayt',
    });
  });
});

describe('parseGenericJobEmail', () => {
  it('extracts "Title at Company" constructions', () => {
    const text = [
      'We found roles for you',
      'Solutions Architect at Ooredoo',
      'Doha, Qatar',
    ].join('\n');

    const jobs = parseGenericJobEmail(text);
    expect(jobs[0]).toMatchObject({
      title: 'Solutions Architect',
      company: 'Ooredoo',
      is_qatar: true,
    });
  });

  it('does not invent jobs from prose', () => {
    const text = 'Thanks for signing up.\nYour preferences have been saved.';
    expect(parseGenericJobEmail(text)).toEqual([]);
  });
});

describe('HTML-only digest (the real Gmail path)', () => {
  // Many digests ship HTML with no text/plain part, so gmail-client derives the
  // text with htmlToText and the parser runs on that. This exercises the whole
  // chain the way production does, using NaukriGulf's table layout.
  const job = (title: string, company: string, exp: string, loc: string, date: string) => `
    <tr>
      <td><a href="https://www.naukrigulf.com/${title.toLowerCase().replace(/\W+/g, '-')}?aut=SECRET">${title}</a></td>
      <td>${company}</td>
    </tr>
    <tr><td>${exp}</td><td>${loc}</td><td>Easy Apply</td><td>${date}</td></tr>
  `;

  const html = `
    <html><body>
      <p>Hi MOHAMED ABDELAZIM,</p>
      <p>Here are job opportunities for you</p>
      <table>
        ${job('Head of Information Technology', 'Confidential Company', '10 - 16 Years', 'Dubai - United Arab Emirates (UAE)', '8 Jul')}
        ${job('Senior IT ICT Engineer', 'BAE Systems', '8 - 13 Years', 'Qatar - Qatar', '15 Jul')}
      </table>
      <a href="https://www.naukrigulf.com/unsubscribe?aut=SECRET">Unsubscribe</a>
    </body></html>
  `;

  const derivedText = htmlToText(html);
  const jobs = parseNaukrigulfDigest(derivedText, html);

  it('recovers both jobs from HTML alone', () => {
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.title)).toEqual([
      'Head of Information Technology',
      'Senior IT ICT Engineer',
    ]);
  });

  it('keeps company and location aligned to the right job', () => {
    expect(jobs[1]).toMatchObject({
      company: 'BAE Systems',
      location: 'Qatar - Qatar',
      is_qatar: true,
    });
    expect(jobs[0].is_qatar).toBe(false);
  });

  it('strips the auto-login token from every recovered link', () => {
    for (const parsed of jobs) {
      expect(parsed.apply_url).not.toContain('SECRET');
      expect(parsed.apply_url).not.toContain('unsubscribe');
    }
    expect(jobs[0].apply_url).toContain('naukrigulf.com');
  });

  it('does not import the greeting as a job', () => {
    expect(jobs.map((j) => j.title)).not.toContain('Hi MOHAMED ABDELAZIM,');
  });
});

describe('parseJobEmail', () => {
  it('selects the NaukriGulf parser from the sender', () => {
    const result = parseJobEmail({
      from: 'NaukriGulf <recommendedjobs@naukrigulf.com>',
      subject: 'Your daily job matches',
      text: digest,
    });

    expect(result.parser).toBe('naukrigulf');
    expect(result.jobs).toHaveLength(15);
  });

  it('falls back to the generic parser when a known sender yields nothing', () => {
    const result = parseJobEmail({
      from: 'jobs@linkedin.com',
      subject: 'jobs',
      text: 'Solutions Architect at Ooredoo\nDoha, Qatar',
    });

    expect(result.parser).toBe('linkedin->generic');
    expect(result.jobs[0].company).toBe('Ooredoo');
  });

  it('returns an empty result for a non-job email rather than guessing', () => {
    const result = parseJobEmail({
      from: 'billing@example.com',
      subject: 'Your invoice',
      text: 'Your invoice is attached.\nThank you for your business.',
    });

    expect(result.jobs).toEqual([]);
  });
});
