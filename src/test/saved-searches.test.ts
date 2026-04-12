import { describe, expect, it } from 'vitest';

import {
  buildPresetSubscriptionQuery,
  matchesSavedSearchKeywords,
  parseKeywordList,
  parseSavedSearches,
  stringifySavedSearches,
  type SavedSearchPreset,
} from '@/lib/saved-searches';

const preset: SavedSearchPreset = {
  id: 'preset-1',
  name: 'Remote React',
  search: 'react engineer',
  includeKeywords: ['remote', 'typescript'],
  excludeKeywords: ['senior manager'],
  filters: {
    statusFilter: 'all',
    companyFilter: 'all',
    remoteFilter: 'remote',
    locationFilter: 'all',
    scoreRange: [0, 100],
    recommendationFilter: 'all',
    seniorityFilter: 'all',
    industryFilter: 'all',
    sourceFilter: 'all',
    hasSalary: 'all',
    dateFilter: 'all',
    employmentTypeFilter: 'all',
    feedMode: 'recommended',
  },
  createdAt: new Date().toISOString(),
};

describe('saved search helpers', () => {
  it('parses keyword lists cleanly', () => {
    expect(parseKeywordList('remote, typescript,  qa  ')).toEqual(['remote', 'typescript', 'qa']);
  });

  it('round-trips saved searches through preference storage', () => {
    const serialized = stringifySavedSearches([preset]);
    expect(parseSavedSearches(serialized)).toEqual([preset]);
    expect(parseSavedSearches('not-json')).toEqual([]);
  });

  it('matches include and exclude keywords against job text', () => {
    const haystack = 'Remote React engineer role working with TypeScript and design systems';
    expect(matchesSavedSearchKeywords(haystack, preset.includeKeywords, preset.excludeKeywords)).toBe(true);
    expect(matchesSavedSearchKeywords(`${haystack} senior manager`, preset.includeKeywords, preset.excludeKeywords)).toBe(false);
  });

  it('builds alert subscription queries from saved presets', () => {
    expect(buildPresetSubscriptionQuery(preset)).toBe('react engineer remote typescript');
  });
});
