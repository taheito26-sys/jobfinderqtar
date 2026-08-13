import { describe, expect, it } from 'vitest';

import {
  buildJobAlertQuery,
  decodeBase64Url,
  extractBodies,
  htmlToText,
} from '../../supabase/functions/_shared/gmail-client.ts';

/** Gmail encodes bodies as base64url without padding. */
function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('decodeBase64Url', () => {
  it('decodes unpadded base64url', () => {
    expect(decodeBase64Url(toBase64Url('Head of IT'))).toBe('Head of IT');
  });

  it('decodes multi-byte characters', () => {
    // Digest titles contain en dashes: "IT Director / IT Manager – Saudi Arabia"
    const value = 'IT Director – Saudi Arabia';
    expect(decodeBase64Url(toBase64Url(value))).toBe(value);
  });

  it('returns empty string for malformed input rather than throwing', () => {
    expect(decodeBase64Url('!!!not base64!!!')).toBe('');
    expect(decodeBase64Url('')).toBe('');
  });
});

describe('extractBodies', () => {
  it('reads a simple multipart/alternative message', () => {
    const bodies = extractBodies({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: toBase64Url('plain body') } },
        { mimeType: 'text/html', body: { data: toBase64Url('<p>html body</p>') } },
      ],
    });

    expect(bodies.text).toBe('plain body');
    expect(bodies.html).toBe('<p>html body</p>');
  });

  it('finds bodies nested inside multipart/mixed', () => {
    const bodies = extractBodies({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: toBase64Url('nested text') } },
            { mimeType: 'text/html', body: { data: toBase64Url('<b>nested html</b>') } },
          ],
        },
        { mimeType: 'image/png', body: { data: toBase64Url('binary') } },
      ],
    });

    expect(bodies.text).toBe('nested text');
    expect(bodies.html).toBe('<b>nested html</b>');
  });

  it('handles a single-part text message', () => {
    const bodies = extractBodies({
      mimeType: 'text/plain',
      body: { data: toBase64Url('just text') },
    });

    expect(bodies.text).toBe('just text');
    expect(bodies.html).toBe('');
  });

  it('returns empty strings for an undefined payload', () => {
    expect(extractBodies(undefined)).toEqual({ text: '', html: '' });
  });
});

describe('htmlToText', () => {
  it('turns table cells and rows into separate lines', () => {
    // NaukriGulf lays each job out as a table row, and the parsers are
    // line-oriented, so these boundaries must survive.
    const text = htmlToText(
      '<table><tr><td>Head of IT</td><td>Confidential Company</td></tr>' +
      '<tr><td>10 - 16 Years</td></tr></table>',
    );

    const lines = text.split('\n').filter(Boolean);
    expect(lines).toContain('Head of IT');
    expect(lines).toContain('Confidential Company');
    expect(lines).toContain('10 - 16 Years');
  });

  it('drops script and style content', () => {
    const text = htmlToText('<style>.a{color:red}</style><script>alert(1)</script><p>Real</p>');
    expect(text).not.toMatch(/color:red|alert/);
    expect(text).toContain('Real');
  });

  it('decodes the entities that appear in job titles', () => {
    expect(htmlToText('<p>R&amp;D Manager</p>')).toContain('R&D Manager');
    expect(htmlToText('<p>Dev&nbsp;Ops</p>')).toContain('Dev Ops');
    expect(htmlToText('<p>Sales &#38; Marketing</p>')).toContain('Sales & Marketing');
  });

  it('collapses runs of blank lines', () => {
    expect(htmlToText('<p>A</p><p></p><p></p><p>B</p>')).not.toMatch(/\n{3,}/);
  });
});

describe('buildJobAlertQuery', () => {
  it('covers every supported sender and bounds the window', () => {
    const query = buildJobAlertQuery(14);

    for (const domain of ['naukrigulf.com', 'linkedin.com', 'bayt.com', 'gulftalent.com']) {
      expect(query).toContain(`from:${domain}`);
    }
    expect(query).toContain('newer_than:14d');
  });
});
