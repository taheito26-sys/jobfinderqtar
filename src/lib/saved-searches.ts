import type { FeedMode } from '@/lib/job-feed';

export type SavedSearchFilters = {
  statusFilter: string;
  companyFilter: string;
  remoteFilter: string;
  locationFilter: string;
  scoreRange: [number, number];
  recommendationFilter: string;
  seniorityFilter: string;
  industryFilter: string;
  sourceFilter: string;
  hasSalary: string;
  dateFilter: string;
  employmentTypeFilter: string;
  feedMode: FeedMode;
};

export type SavedSearchPreset = {
  id: string;
  name: string;
  search: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  filters: SavedSearchFilters;
  alertSubscriptionId?: string | null;
  createdAt: string;
};

export function parseKeywordList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseSavedSearches(value: string | null | undefined): SavedSearchPreset[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedSearchPreset => Boolean(item?.id && item?.name));
  } catch {
    return [];
  }
}

export function stringifySavedSearches(presets: SavedSearchPreset[]): string {
  return JSON.stringify(presets);
}

export function matchesSavedSearchKeywords(
  haystack: string,
  includeKeywords: string[],
  excludeKeywords: string[],
): boolean {
  const normalized = haystack.toLowerCase();
  const includesOk = includeKeywords.every((keyword) => normalized.includes(keyword.toLowerCase()));
  const excludesOk = excludeKeywords.every((keyword) => !normalized.includes(keyword.toLowerCase()));
  return includesOk && excludesOk;
}

export function buildPresetSubscriptionQuery(preset: SavedSearchPreset): string {
  return [preset.search, ...preset.includeKeywords].filter(Boolean).join(' ').trim();
}
