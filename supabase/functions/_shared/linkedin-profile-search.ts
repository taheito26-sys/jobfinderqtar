import { fetchLinkedInSearch, type LinkedInSearchInput, type LinkedInJobSnippet } from './linkedin-search.ts';
import { normalizeLinkedInJob } from './linkedin-normalize.ts';

export type LinkedInProfileContext = {
  desiredTitles: string[];
  headline: string;
  location: string;
  country: string;
  remotePreference: string;
  skills: string[];
  salaryFloor: number;
};

export type LinkedInProfileSearchOptions = LinkedInSearchInput & {
  profile?: LinkedInProfileContext | null;
  minRelevantJobs?: number;
  relevanceThreshold?: number;
};

type RankedLinkedInJob = {
  job: Record<string, unknown>;
  score: number;
};

const ROLE_FAMILY_PATTERNS: Array<{ family: string; patterns: RegExp[] }> = [
  { family: 'architect', patterns: [/\barchitect(?:ure)?\b/i] },
  { family: 'engineer', patterns: [/\bengineer(?:ing)?\b/i] },
  { family: 'developer', patterns: [/\bdeveloper\b/i, /\bsoftware\b/i] },
  { family: 'director', patterns: [/\bdirector\b/i, /\bhead\b/i, /\bvp\b/i, /\bvice president\b/i] },
  { family: 'manager', patterns: [/\bmanager\b/i, /\blead\b/i, /\bleadership\b/i] },
  { family: 'cto', patterns: [/\bcto\b/i, /\bchief technology officer\b/i] },
  { family: 'cloud', patterns: [/\bcloud\b/i] },
  { family: 'security', patterns: [/\bsecurity\b/i, /\bcyber\b/i, /\bsoc\b/i, /\biam\b/i, /\bpam\b/i] },
  { family: 'solutions', patterns: [/\bsolution[s]?\b/i] },
  { family: 'infrastructure', patterns: [/\binfrastructure\b/i, /\bsystems?\b/i, /\bplatform\b/i] },
  { family: 'network', patterns: [/\bnetwork\b/i, /\btelecom\b/i, /\btelco\b/i] },
];

const TITLE_STOPWORDS = new Set([
  'senior',
  'sr',
  'junior',
  'jr',
  'lead',
  'principal',
  'head',
  'chief',
  'staff',
  'associate',
  'technical',
  'global',
  'regional',
  'enterprise',
  'digital',
  'solution',
  'solutions',
  'system',
  'systems',
]);

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(' ').filter((token) => token.length >= 2);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractRoleFamilies(text: string): string[] {
  const normalized = normalizeText(text);
  return ROLE_FAMILY_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)))
    .map(({ family }) => family);
}

function buildTitleVariants(title: string): string[] {
  const normalized = normalizeText(title);
  if (!normalized) return [];

  const tokens = normalized.split(' ').filter(Boolean);
  const withoutStopwords = tokens.filter((token) => !TITLE_STOPWORDS.has(token));
  const families = extractRoleFamilies(normalized);

  const variants = new Set<string>([normalized]);

  if (withoutStopwords.length > 0) {
    variants.add(withoutStopwords.join(' '));
  }

  if (tokens.length >= 2) {
    variants.add(tokens.slice(-2).join(' '));
    variants.add(tokens.slice(0, 2).join(' '));
  }

  if (tokens.length >= 3) {
    variants.add(tokens.slice(-3).join(' '));
    variants.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    variants.add(tokens.slice(1).join(' '));
  }

  for (const family of families) {
    variants.add(family);
    if (withoutStopwords.length > 1) {
      variants.add(`${withoutStopwords[0]} ${family}`);
      variants.add(`${family} ${withoutStopwords[withoutStopwords.length - 1]}`);
    }
  }

  if (normalized.includes('cto')) {
    variants.add('cto');
    variants.add('chief technology officer');
  }

  return dedupeStrings([...variants]).slice(0, 8);
}

export function buildLinkedInSearchVariants(input: {
  keywords: string;
  profile?: LinkedInProfileContext | null;
}): string[] {
  const seeds = new Set<string>();
  const keywords = String(input.keywords || '').trim();

  if (keywords) {
    seeds.add(keywords);
    buildTitleVariants(keywords).forEach((variant) => seeds.add(variant));
  }

  const profileTitles = input.profile?.desiredTitles ?? [];
  profileTitles.forEach((title) => {
    const trimmed = String(title || '').trim();
    if (!trimmed) return;
    seeds.add(trimmed);
    buildTitleVariants(trimmed).forEach((variant) => seeds.add(variant));
  });

  const headline = String(input.profile?.headline || '').trim();
  if (headline) {
    seeds.add(headline);
    buildTitleVariants(headline).forEach((variant) => seeds.add(variant));
  }

  return [...seeds].slice(0, 10);
}

export function scoreLinkedInJobAgainstProfile(job: Record<string, unknown>, profile: LinkedInProfileContext): number {
  const desiredTitles = dedupeStrings(profile.desiredTitles);
  const jobTitle = normalizeText(String(job?.title || ''));
  const requirements = Array.isArray(job?.requirements) ? (job.requirements as string[]) : [];
  const jobBlob = normalizeText([
    job?.title,
    job?.company,
    job?.location,
    job?.description,
    requirements.join(' '),
  ].filter(Boolean).join(' '));

  if (!jobTitle) return 0;

  let titleScore = 0;
  let familyScore = 0;

  for (const title of desiredTitles) {
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) continue;

    if (jobTitle === normalizedTitle) {
      titleScore = Math.max(titleScore, 100);
      continue;
    }

    if (jobTitle.includes(normalizedTitle) || normalizedTitle.includes(jobTitle)) {
      titleScore = Math.max(titleScore, 90);
      continue;
    }

    const titleTokens = tokenize(normalizedTitle).filter((token) => !TITLE_STOPWORDS.has(token));
    const matchedTokens = titleTokens.filter((token) => jobTitle.includes(token)).length;
    const tokenScore = titleTokens.length > 0
      ? Math.round((matchedTokens / titleTokens.length) * 60)
      : 0;
    titleScore = Math.max(titleScore, tokenScore);

    const jobFamilies = extractRoleFamilies(jobTitle);
    const titleFamilies = extractRoleFamilies(normalizedTitle);
    if (jobFamilies.length > 0 && titleFamilies.length > 0 && jobFamilies.some((family) => titleFamilies.includes(family))) {
      familyScore = Math.max(familyScore, 45);
    }

    if (jobFamilies.includes('architect') && titleFamilies.includes('architect')) {
      familyScore = Math.max(familyScore, 55);
    }
    if (jobFamilies.includes('engineer') && titleFamilies.includes('engineer')) {
      familyScore = Math.max(familyScore, 55);
    }
  }

  const skillMatches = profile.skills.filter((skill) => jobBlob.includes(normalizeText(skill))).length;
  const skillScore = profile.skills.length > 0
    ? Math.round((skillMatches / Math.max(profile.skills.length, 1)) * 25)
    : 0;

  const locationText = normalizeText(String(job?.location || ''));
  const profileCountry = normalizeText(profile.country);
  const profileLocation = normalizeText(profile.location);
  const locationScore = profileCountry && locationText.includes(profileCountry)
    ? 12
    : profileLocation && locationText.includes(profileLocation)
      ? 10
      : String(job?.remote_type || '').toLowerCase() === 'remote' && profile.remotePreference === 'remote'
        ? 8
        : 0;

  const salaryScore = profile.salaryFloor > 0 && Number(job?.salary_min || 0) >= profile.salaryFloor ? 5 : 0;
  const headlineScore = profile.headline && jobTitle.includes(normalizeText(profile.headline)) ? 10 : 0;

  return Math.min(100, titleScore + familyScore + skillScore + locationScore + salaryScore + headlineScore);
}

function rankLinkedInJobsByProfile(jobs: Record<string, unknown>[], profile: LinkedInProfileContext): RankedLinkedInJob[] {
  return jobs
    .map((job) => ({ job, score: scoreLinkedInJobAgainstProfile(job, profile) }))
    .sort((a, b) => b.score - a.score);
}

function cleanLocationForSearch(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(', ');
  return trimmed;
}

function collectSearchLocations(profile: LinkedInProfileContext | null | undefined, inputLocation?: string): string[] {
  const candidates = [
    inputLocation,
    profile?.country,
    profile?.location,
  ].map((value) => cleanLocationForSearch(String(value || ''))).filter(Boolean);
  return dedupeStrings(candidates).slice(0, 3);
}

function dedupeJobsByIdentity(jobs: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];

  for (const job of jobs) {
    const key = String(job?.linkedin_job_id || job?.external_id || job?.apply_url || job?.source_url || '')
      .trim()
      .toLowerCase() ||
      `${String(job?.title || '').trim().toLowerCase()}|${String(job?.company || '').trim().toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(job);
  }

  return result;
}

function normalizeLinkedInSnippets(snippets: LinkedInJobSnippet[]): Record<string, unknown>[] {
  return snippets.map((snippet) => normalizeLinkedInJob(snippet));
}

export async function fetchProfileAwareLinkedInSearch(
  input: LinkedInProfileSearchOptions,
): Promise<{ jobs: Record<string, unknown>[]; debug: Record<string, unknown>[] }> {
  const profile = input.profile ?? null;
  const locations = collectSearchLocations(profile, input.location);
  const seeds = buildLinkedInSearchVariants({ keywords: input.keywords, profile });
  const debug: Record<string, unknown>[] = [];
  const collected = new Map<string, { job: Record<string, unknown>; score: number }>();
  const directLimit = Math.max(1, Number(input.limit || 25));
  const minRelevantJobs = Math.max(1, Number(input.minRelevantJobs || 3));
  const relevanceThreshold = Math.max(0, Number(input.relevanceThreshold || 25));

  const searchWithSeed = async (seed: string, location: string | undefined) => {
    const snippets = await fetchLinkedInSearch({
      keywords: seed,
      location,
      limit: directLimit,
      pageNum: input.pageNum,
      postedWithin: input.postedWithin,
      remotePreference: input.remotePreference,
    });
    return normalizeLinkedInSnippets(snippets);
  };

  const directJobs = await searchWithSeed(input.keywords, locations[0] || input.location);
  if (!profile) {
    return { jobs: dedupeJobsByIdentity(directJobs), debug: [{ strategy: 'direct_only', count: directJobs.length }] };
  }

  const rankedDirect = rankLinkedInJobsByProfile(directJobs, profile);
  const directRelevant = rankedDirect.filter((entry) => entry.score >= relevanceThreshold);

  if (directRelevant.length >= minRelevantJobs || rankedDirect[0]?.score >= relevanceThreshold + 10) {
    const jobs = dedupeJobsByIdentity((directRelevant.length > 0 ? directRelevant : rankedDirect).map((entry) => entry.job));
    return {
      jobs,
      debug: [{
        strategy: 'direct_profile_ranked',
        top_score: rankedDirect[0]?.score ?? 0,
        kept: jobs.length,
        threshold: relevanceThreshold,
      }],
    };
  }

  for (const seed of seeds) {
    for (const location of locations.length > 0 ? locations : ['']) {
      const jobs = await searchWithSeed(seed, location || undefined);
      const ranked = rankLinkedInJobsByProfile(jobs, profile);
      const topScore = ranked[0]?.score ?? 0;

      debug.push({
        seed,
        location: location || null,
        total: jobs.length,
        top_score: topScore,
      });

      if (topScore < relevanceThreshold) continue;

      for (const entry of ranked.filter((item) => item.score >= relevanceThreshold)) {
        const key = String(entry.job?.linkedin_job_id || entry.job?.apply_url || entry.job?.title || '')
          .trim()
          .toLowerCase();
        if (!key) continue;
        const existing = collected.get(key);
        if (!existing || entry.score > existing.score) {
          collected.set(key, { job: entry.job, score: entry.score });
        }
      }

      if (collected.size >= directLimit) break;
    }
    if (collected.size >= directLimit) break;
  }

  const jobs = [...collected.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.job);

  if (jobs.length > 0) {
    return {
      jobs: dedupeJobsByIdentity(jobs),
      debug: [{ strategy: 'profile_fallback', seeds: seeds.slice(0, 6), locations, collected: jobs.length }, ...debug],
    };
  }

  const fallbackJobs = dedupeJobsByIdentity(directJobs);
  return {
    jobs: fallbackJobs,
    debug: [{ strategy: 'direct_fallback', top_score: rankedDirect[0]?.score ?? 0, kept: fallbackJobs.length }, ...debug],
  };
}

export async function loadLinkedInProfileContext(
  supabaseClient: any,
  userId: string,
): Promise<LinkedInProfileContext | null> {
  const [profileRes, skillsRes] = await Promise.all([
    supabaseClient
      .from('profiles_v2')
      .select('headline, location, country, remote_preference, desired_salary_min, desired_titles')
      .eq('user_id', userId)
      .maybeSingle(),
    supabaseClient
      .from('profile_skills')
      .select('skill_name')
      .eq('user_id', userId),
  ]);

  const profile = profileRes?.data as Record<string, unknown> | null;
  if (!profile) return null;

  return {
    desiredTitles: Array.isArray(profile.desired_titles)
      ? profile.desired_titles.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    headline: String(profile.headline || '').trim(),
    location: String(profile.location || '').trim(),
    country: String(profile.country || '').trim(),
    remotePreference: String(profile.remote_preference || '').trim(),
    skills: (skillsRes.data || [])
      .map((row: any) => String(row?.skill_name || '').trim())
      .filter(Boolean),
    salaryFloor: Number(profile.desired_salary_min || 0),
  };
}
