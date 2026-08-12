import { afterEach, describe, expect, it, vi } from 'vitest';

import { searchNaukrigulf } from '../../supabase/functions/_shared/naukrigulf-search.ts';

// Shaped exactly like a live response from
// https://www.naukrigulf.com/spapi/jobapi/search?Location=qatar&Keywords=...
const apiResponse = {
  TotalJobsCount: '17',
  Jobs: [
    {
      Job: {
        Designation: 'Solution Architect',
        Location: 'Doha - Qatar',
        Experience: { Min: '8', Max: '15' },
        Company: { Name: 'Atland Petro', Id: '351019' },
        JobId: '120826001447',
        JdURL: 'https://www.naukrigulf.com/solution-architect-jobs-n-jid-120826001447',
        LatestPostedDate: '1786471779',
        Vacancies: '1',
        keywords: 'Cloud, Architecture',
      },
    },
    {
      // Duplicate JobId — must be dropped.
      Job: {
        Designation: 'Solution Architect',
        Location: 'Doha - Qatar',
        Company: { Name: 'Atland Petro' },
        JobId: '120826001447',
        JdURL: 'https://www.naukrigulf.com/solution-architect-jobs-n-jid-120826001447',
        LatestPostedDate: '1786471779',
      },
    },
    {
      // Missing title — must be skipped rather than emitted blank.
      Job: {
        Designation: '',
        Company: { Name: 'Nowhere' },
        JobId: '999',
        JdURL: 'https://www.naukrigulf.com/x-n-jid-999',
      },
    },
    {
      // Missing company should fall back, not crash.
      Job: {
        Designation: 'Network Engineer',
        Location: '',
        JobId: '120826001448',
        JdURL: 'https://www.naukrigulf.com/network-engineer-jobs-n-jid-120826001448',
        LatestPostedDate: 'not-a-date',
      },
    },
  ],
};

function mockFetch(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchNaukrigulf', () => {
  it('maps the API payload onto the shared job shape', async () => {
    vi.stubGlobal('fetch', mockFetch(apiResponse));

    const jobs = await searchNaukrigulf('solutions architect');

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: 'Solution Architect',
      company: 'Atland Petro',
      location: 'Doha - Qatar',
      apply_url: 'https://www.naukrigulf.com/solution-architect-jobs-n-jid-120826001447',
      external_id: '120826001447',
      source_platform: 'naukrigulf',
    });
    expect(jobs[0].source_created_at).toBe(new Date(1786471779 * 1000).toISOString());
    expect(jobs[0].description).toContain('8-15 years');
  });

  it('drops duplicates and entries without a usable title', async () => {
    vi.stubGlobal('fetch', mockFetch(apiResponse));

    const jobs = await searchNaukrigulf('anything');

    expect(jobs.map((j) => j.external_id)).toEqual(['120826001447', '120826001448']);
    expect(jobs.every((j) => j.title !== '')).toBe(true);
  });

  it('falls back for missing company/location and an invalid date', async () => {
    vi.stubGlobal('fetch', mockFetch(apiResponse));

    const jobs = await searchNaukrigulf('anything');
    const fallback = jobs[1];

    expect(fallback.company).toBe('Unknown Company');
    expect(fallback.location).toBe('Qatar');
    expect(fallback.source_created_at).toBeNull();
  });

  it('sends the Keywords parameter — the only spelling the API honours', async () => {
    const fetchMock = mockFetch(apiResponse);
    vi.stubGlobal('fetch', fetchMock);

    await searchNaukrigulf('network engineer', 'qatar');

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('Keywords')).toBe('network engineer');
    expect(url.searchParams.get('Location')).toBe('qatar');
  });

  it('respects the limit', async () => {
    vi.stubGlobal('fetch', mockFetch(apiResponse));
    expect(await searchNaukrigulf('anything', 'qatar', 1)).toHaveLength(1);
  });

  it('returns an empty list instead of throwing when the API fails', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 503));
    expect(await searchNaukrigulf('anything')).toEqual([]);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await searchNaukrigulf('anything')).toEqual([]);
  });
});
