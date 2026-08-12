/**
 * Live smoke test — hits the real job boards over the network.
 *
 * Skipped by default so the normal suite stays offline and deterministic.
 * Run it when you suspect a source has broken:
 *
 *   LIVE_SOURCE_TEST=1 npx vitest run src/test/live-sources.test.ts
 *
 * A failure here means the upstream site changed (markup, URL shape, or
 * blocking policy) — not that the parsing logic regressed.
 */
import { describe, expect, it } from 'vitest';

import { searchNaukrigulf } from '../../supabase/functions/_shared/naukrigulf-search.ts';
import { searchGulfTalent } from '../../supabase/functions/_shared/gulftalent-search.ts';

const live = process.env.LIVE_SOURCE_TEST === '1';

describe.skipIf(!live)('live job sources', () => {
  it('Naukrigulf returns Qatar jobs relevant to the keyword', async () => {
    const jobs = await searchNaukrigulf('engineer', 'qatar', 25);

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.title && j.apply_url.startsWith('http'))).toBe(true);

    // The API filters server-side, so most titles should be on-topic.
    const onTopic = jobs.filter((j) => /engineer|engineering|technical/i.test(j.title));
    expect(onTopic.length).toBeGreaterThan(0);
  }, 30_000);

  it('GulfTalent parses rows off the live browse page', async () => {
    const jobs = await searchGulfTalent('', 25);

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.title && j.company && j.external_id)).toBe(true);
    expect(jobs.every((j) => j.apply_url.includes('/jobs/'))).toBe(true);
  }, 30_000);
});
