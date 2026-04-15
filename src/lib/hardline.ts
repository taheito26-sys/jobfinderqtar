import { normalizeJobText, normalizeJobUrl } from '@/lib/job-feed';

export type OperatingMode = 'collect' | 'draft' | 'auto_submit';
export type NormalizationStatus = 'valid' | 'invalid' | 'incomplete';
export type HardlineDecision = 'skip' | 'review' | 'apply_draft' | 'apply_auto';

export type CandidateProfile = {
  legal_name: string;
  email: string;
  phone: string;
  location_city: string;
  location_country: string;
  work_authorization: string;
  visa_status?: string;
  preferred_remote_type: 'remote' | 'hybrid' | 'onsite' | 'flexible';
  allowed_countries: string[];
  target_roles: string[];
  banned_roles: string[];
  salary_floor: number;
  salary_currency: string;
  linkedin_url?: string;
  github_url?: string;
  portfolio_url?: string;
  start_date_availability?: string;
  years_experience_by_domain: Record<string, number>;
  approved_resume_facts: string[];
  approved_answer_bank: Record<string, string>;
  disallowed_claims: string[];
};

export type NormalizedJob = {
  source?: string;
  source_job_id?: string;
  canonical_url?: string;
  title?: string;
  company_name?: string;
  location_text?: string;
  country?: string;
  city?: string;
  remote_type?: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  employment_type?: string;
  seniority?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string;
  description_text?: string;
  posted_at?: string | null;
  discovered_at?: string | null;
  easy_apply_flag?: boolean;
  external_apply_flag?: boolean;
  visa_sponsorship_text?: string | null;
  required_skills?: string[];
  preferred_skills?: string[];
  screening_questions_detected?: string[];
  normalization_status?: NormalizationStatus;
  duplicate_group_key?: string | null;
  archived_flag?: boolean;
};

export type HardlinePolicy = {
  defaultMode: OperatingMode;
  skipBelow: number;
  draftMin: number;
  autoSubmitMin: number;
  maxAutoSubmitPerDay: number;
  maxDraftsPerDay: number;
  cooldownSecondsBetweenSubmissions: number;
  allowedRoleFamilies: string[];
  bannedCompanies: string[];
  preferredLocations: string[];
  requireSubmissionVerification: boolean;
  blockHighRiskQuestions: boolean;
};

export type HardlineReason = { code: string; detail: string };
export type ScoreBreakdown = {
  titleScore: number;
  skillsScore: number;
  domainScore: number;
  seniorityScore: number;
  locationScore: number;
  salaryScore: number;
  authorizationScore: number;
  mandatoryKeywordScore: number;
  sourceTrustScore: number;
};

export type HardlineEvaluation = {
  compositeScore: number;
  decision: HardlineDecision;
  reasons: HardlineReason[];
  hardDisqualifiers: string[];
  breakdown: ScoreBreakdown;
  normalizationStatus: NormalizationStatus;
  duplicateKey: string;
  eligibleForDraft: boolean;
  eligibleForAutoSubmit: boolean;
};

export type TruthGuardResult = {
  allowed: boolean;
  approvedFacts: string[];
  violations: string[];
};

export const DEFAULT_HARDLINE_POLICY: HardlinePolicy = {
  defaultMode: 'draft',
  skipBelow: 60,
  draftMin: 80,
  autoSubmitMin: 90,
  maxAutoSubmitPerDay: 5,
  maxDraftsPerDay: 20,
  cooldownSecondsBetweenSubmissions: 300,
  allowedRoleFamilies: ['Solutions Architect', 'Cloud Architect', 'Infrastructure Architect', 'Technical Program Manager'],
  bannedCompanies: [],
  preferredLocations: ['Qatar', 'UAE', 'Remote'],
  requireSubmissionVerification: true,
  blockHighRiskQuestions: true,
};

const SENIORITY_ORDER = ['intern', 'junior', 'entry', 'associate', 'mid', 'senior', 'staff', 'principal', 'lead', 'director', 'head', 'vp'];

export function normalizeCanonicalUrl(value: string | null | undefined): string {
  return normalizeJobUrl(value);
}

export function buildDuplicateGroupKey(job: Pick<NormalizedJob, 'canonical_url' | 'title' | 'company_name' | 'city' | 'location_text'>): string {
  const canonicalUrl = normalizeCanonicalUrl(job.canonical_url);
  if (canonicalUrl) return `url:${canonicalUrl}`;

  const title = normalizeJobText(job.title);
  const company = normalizeJobText(job.company_name);
  const city = normalizeJobText(job.city);
  const location = normalizeJobText(job.location_text);
  return `fingerprint:${title}|${company}|${city || location}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function tokens(value: string | null | undefined): string[] {
  return normalizeJobText(value).split(' ').filter(Boolean);
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 50;
  const rightSet = new Set(right.map((value) => normalizeJobText(value)));
  const matches = left.filter((value) => rightSet.has(normalizeJobText(value))).length;
  return clamp(Math.round((matches / Math.max(left.length, right.length)) * 100));
}

function keywordPresenceScore(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 50;
  const normalized = normalizeJobText(text);
  const matches = keywords.filter((keyword) => normalized.includes(normalizeJobText(keyword))).length;
  return clamp(Math.round((matches / keywords.length) * 100));
}

function titleScore(job: NormalizedJob, profile: CandidateProfile): number {
  const title = normalizeJobText(job.title);
  if (!title) return 0;
  const targetRoles = profile.target_roles.map((role) => normalizeJobText(role));
  if (targetRoles.some((role) => title.includes(role) || role.includes(title))) return 100;
  return overlapScore(tokens(job.title), profile.target_roles.flatMap(tokens));
}

function skillsScore(job: NormalizedJob, profile: CandidateProfile): number {
  const allSignals = [...(job.required_skills ?? []), ...(job.preferred_skills ?? [])];
  if (allSignals.length === 0) return 50;
  const profileFacts = [...profile.approved_resume_facts, ...Object.keys(profile.years_experience_by_domain)];
  return overlapScore(allSignals, profileFacts);
}

function domainScore(job: NormalizedJob, profile: CandidateProfile): number {
  const haystack = `${job.title ?? ''} ${job.description_text ?? ''} ${job.seniority ?? ''}`;
  const positive = keywordPresenceScore(haystack, profile.target_roles);
  const negative = profile.banned_roles.some((role) => normalizeJobText(haystack).includes(normalizeJobText(role)));
  return negative ? Math.min(positive, 20) : positive;
}

function seniorityScore(job: NormalizedJob, profile: CandidateProfile): number {
  const text = normalizeJobText(`${job.title ?? ''} ${job.seniority ?? ''}`);
  const experience = Math.max(0, ...Object.values(profile.years_experience_by_domain));
  const experienceScore = experience >= 8 ? 100 : experience >= 5 ? 85 : experience >= 3 ? 70 : 50;
  const matchedLevel = SENIORITY_ORDER.find((level) => text.includes(level));
  if (!matchedLevel) return experienceScore;
  if (['lead', 'principal', 'staff', 'director', 'head', 'vp'].includes(matchedLevel)) return experience >= 7 ? 95 : 55;
  if (['senior'].includes(matchedLevel)) return experience >= 5 ? 90 : 60;
  if (['mid', 'associate'].includes(matchedLevel)) return experience >= 3 ? 85 : 50;
  return experienceScore;
}

function locationScore(job: NormalizedJob, profile: CandidateProfile, policy: HardlinePolicy): number {
  const location = normalizeJobText(`${job.country ?? ''} ${job.city ?? ''} ${job.location_text ?? ''}`);
  if (!location) return 50;
  if (job.remote_type === 'remote' && profile.preferred_remote_type === 'remote') return 100;
  if (profile.allowed_countries.some((country) => location.includes(normalizeJobText(country)))) return 95;
  if (policy.preferredLocations.some((value) => location.includes(normalizeJobText(value)))) return 90;
  if (job.remote_type === 'hybrid' && profile.preferred_remote_type !== 'onsite') return 75;
  if (job.remote_type === 'onsite' && profile.preferred_remote_type === 'remote') return 25;
  return 55;
}

function salaryScore(job: NormalizedJob, profile: CandidateProfile): number {
  const maxSalary = typeof job.salary_max === 'number' ? job.salary_max : job.salary_min ?? 0;
  const minSalary = typeof job.salary_min === 'number' ? job.salary_min : maxSalary;
  if (!profile.salary_floor || (!job.salary_min && !job.salary_max)) return 50;
  if (maxSalary < profile.salary_floor) return 0;
  if (minSalary >= profile.salary_floor) return 100;
  return 70;
}

function authorizationScore(job: NormalizedJob, profile: CandidateProfile): number {
  const text = normalizeJobText(`${job.description_text ?? ''} ${job.visa_sponsorship_text ?? ''}`);
  const authorization = normalizeJobText(profile.work_authorization);
  if (!authorization) return 50;
  if (text.includes('must be authorized') && !text.includes(authorization)) return 0;
  if (text.includes('visa sponsorship') || text.includes('sponsorship available')) return 90;
  if (text.includes(authorization)) return 100;
  return 60;
}

function mandatoryKeywordScore(job: NormalizedJob, profile: CandidateProfile): number {
  const required = job.required_skills ?? [];
  if (required.length === 0) return 50;
  const profileFacts = [...profile.approved_resume_facts, ...Object.keys(profile.years_experience_by_domain)];
  return required.every((skill) => profileFacts.some((fact) => normalizeJobText(fact).includes(normalizeJobText(skill)))) ? 100 : 55;
}

function sourceTrustScore(job: NormalizedJob): number {
  if (!job.title || !job.company_name || !job.description_text) return 20;
  if (job.external_apply_flag) return 70;
  if (job.easy_apply_flag) return 80;
  return 85;
}

function collectHardDisqualifiers(job: NormalizedJob, profile: CandidateProfile, policy: HardlinePolicy): string[] {
  const reasons: string[] = [];
  const title = normalizeJobText(job.title);
  const company = normalizeJobText(job.company_name);
  const description = normalizeJobText(job.description_text);
  const url = normalizeCanonicalUrl(job.canonical_url);
  const location = normalizeJobText(`${job.country ?? ''} ${job.city ?? ''} ${job.location_text ?? ''}`);

  if (job.normalization_status === 'invalid' || !job.title || !job.company_name || !url) reasons.push('job_invalid');
  if (job.normalization_status === 'incomplete' || !description) reasons.push('job_incomplete');
  if (policy.bannedCompanies.some((entry) => company.includes(normalizeJobText(entry)))) reasons.push('banned_company');
  if (profile.banned_roles.some((entry) => title.includes(normalizeJobText(entry)))) reasons.push('banned_role');
  if (policy.allowedRoleFamilies.length > 0 && !policy.allowedRoleFamilies.some((entry) => title.includes(normalizeJobText(entry)))) {
    reasons.push('role_family_outside_policy');
  }
  if (profile.allowed_countries.length > 0 && !profile.allowed_countries.some((entry) => location.includes(normalizeJobText(entry)))) {
    if (job.remote_type !== 'remote') reasons.push('location_outside_policy');
  }
  if (typeof job.salary_min === 'number' && job.salary_min < profile.salary_floor) reasons.push('salary_below_floor');
  const authText = normalizeJobText(`${job.description_text ?? ''} ${job.visa_sponsorship_text ?? ''}`);
  const auth = normalizeJobText(profile.work_authorization);
  if (/authorized to work|must be authorized|work authorization/i.test(`${job.description_text ?? ''} ${job.visa_sponsorship_text ?? ''}`)
    && auth
    && !authText.includes(auth)
    && !authText.includes('visa sponsorship')) {
    reasons.push('work_authorization_mismatch');
  }
  const supportedFacts = [...profile.approved_resume_facts, ...Object.keys(profile.years_experience_by_domain)];
  if ((job.required_skills ?? []).some((skill) => !supportedFacts.some((fact) => normalizeJobText(fact).includes(normalizeJobText(skill))))) {
    reasons.push('mandatory_skill_missing');
  }
  if (job.external_apply_flag === false && job.easy_apply_flag === false) reasons.push('unsupported_form_flow');
  if ((job.screening_questions_detected ?? []).some((question) => /captcha|robot|automation/i.test(question))) {
    reasons.push('anti_automation_obstacle');
  }

  return [...new Set(reasons)];
}

export function evaluateJob(job: NormalizedJob, profile: CandidateProfile, policy: HardlinePolicy = DEFAULT_HARDLINE_POLICY): HardlineEvaluation {
  const duplicateKey = buildDuplicateGroupKey(job);
  const normalizationStatus: NormalizationStatus =
    job.normalization_status
    ?? (!job.title || !job.company_name || !normalizeCanonicalUrl(job.canonical_url)
      ? 'invalid'
      : !job.description_text
        ? 'incomplete'
        : 'valid');
  const hardDisqualifiers = collectHardDisqualifiers(job, profile, policy);
  const baseReasons: HardlineReason[] = [
    { code: 'title', detail: job.title ?? 'missing title' },
    { code: 'company', detail: job.company_name ?? 'missing company' },
  ];

  if (normalizationStatus !== 'valid' || hardDisqualifiers.length > 0) {
    return {
      compositeScore: 0,
      decision: 'skip',
      reasons: baseReasons.concat(hardDisqualifiers.map((value) => ({ code: 'hard_disqualifier', detail: value }))),
      hardDisqualifiers,
      breakdown: {
        titleScore: 0,
        skillsScore: 0,
        domainScore: 0,
        seniorityScore: 0,
        locationScore: 0,
        salaryScore: 0,
        authorizationScore: 0,
        mandatoryKeywordScore: 0,
        sourceTrustScore: 0,
      },
      normalizationStatus,
      duplicateKey,
      eligibleForDraft: false,
      eligibleForAutoSubmit: false,
    };
  }

  const breakdown: ScoreBreakdown = {
    titleScore: titleScore(job, profile),
    skillsScore: skillsScore(job, profile),
    domainScore: domainScore(job, profile),
    seniorityScore: seniorityScore(job, profile),
    locationScore: locationScore(job, profile, policy),
    salaryScore: salaryScore(job, profile),
    authorizationScore: authorizationScore(job, profile),
    mandatoryKeywordScore: mandatoryKeywordScore(job, profile),
    sourceTrustScore: sourceTrustScore(job),
  };

  const compositeScore = clamp(Math.round(
    (breakdown.titleScore * 0.12)
    + (breakdown.skillsScore * 0.24)
    + (breakdown.domainScore * 0.12)
    + (breakdown.seniorityScore * 0.10)
    + (breakdown.locationScore * 0.12)
    + (breakdown.salaryScore * 0.10)
    + (breakdown.authorizationScore * 0.12)
    + (breakdown.mandatoryKeywordScore * 0.05)
    + (breakdown.sourceTrustScore * 0.03),
  ));

  const decision: HardlineDecision =
    compositeScore < policy.skipBelow ? 'skip'
      : compositeScore < policy.draftMin ? 'review'
        : compositeScore < policy.autoSubmitMin ? 'apply_draft'
          : 'apply_auto';

  return {
    compositeScore,
    decision,
    reasons: [
      { code: 'score', detail: `Composite score ${compositeScore}` },
      { code: 'title_score', detail: `Title score ${breakdown.titleScore}` },
      { code: 'skills_score', detail: `Skills score ${breakdown.skillsScore}` },
      { code: 'location_score', detail: `Location score ${breakdown.locationScore}` },
    ],
    hardDisqualifiers,
    breakdown,
    normalizationStatus,
    duplicateKey,
    eligibleForDraft: decision === 'apply_draft' || decision === 'apply_auto',
    eligibleForAutoSubmit: decision === 'apply_auto',
  };
}

export function buildAllowedFacts(profile: CandidateProfile): string[] {
  return [
    profile.legal_name,
    profile.location_city,
    profile.location_country,
    profile.work_authorization,
    profile.visa_status ?? '',
    profile.salary_currency,
    ...profile.target_roles,
    ...Object.keys(profile.years_experience_by_domain),
    ...profile.approved_resume_facts,
    ...Object.values(profile.approved_answer_bank),
  ].map((value) => value.trim()).filter(Boolean);
}

export function truthGuardStatements(statements: string[], profile: CandidateProfile): TruthGuardResult {
  const approvedFacts = buildAllowedFacts(profile);
  const normalizedApprovedFacts = [
    profile.legal_name,
    profile.location_city,
    profile.location_country,
    profile.work_authorization,
    profile.visa_status ?? '',
    profile.salary_currency,
    ...profile.target_roles,
    ...profile.approved_resume_facts,
    ...Object.values(profile.approved_answer_bank),
  ].map((value) => normalizeJobText(value)).filter(Boolean);
  const normalizedDisallowedClaims = profile.disallowed_claims.map((value) => normalizeJobText(value));
  const violations: string[] = [];

  statements.forEach((statement) => {
    const normalized = normalizeJobText(statement);
    if (!normalized) return;
    if (normalizedDisallowedClaims.some((claim) => claim && normalized.includes(claim))) {
      violations.push(`disallowed_claim:${statement}`);
      return;
    }
    if (!normalizedApprovedFacts.some((fact) => fact && normalized.includes(fact))) {
      violations.push(`unsupported_claim:${statement}`);
    }
  });

  return {
    allowed: violations.length === 0,
    approvedFacts,
    violations,
  };
}

export function isModeAllowedForDecision(mode: OperatingMode, decision: HardlineDecision): boolean {
  if (mode === 'collect') return decision === 'skip' || decision === 'review';
  if (mode === 'draft') return decision === 'review' || decision === 'apply_draft' || decision === 'apply_auto';
  return decision === 'apply_auto';
}
