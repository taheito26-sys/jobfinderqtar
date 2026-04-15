import type { CandidateProfile } from '@/lib/hardline';

type ProfileRow = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  country?: string | null;
  visa_status?: string | null;
  work_authorization?: string | null;
  remote_preference?: string | null;
  desired_salary_min?: number | null;
  desired_salary_currency?: string | null;
  desired_titles?: string[] | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
};

type SkillRow = {
  skill_name?: string | null;
  years_experience?: number | null;
};

type ProofPointRow = {
  statement?: string | null;
  metric_value?: string | null;
  category?: string | null;
};

export type CandidateProfileRow = {
  id?: string | null;
  user_id?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  work_authorization?: string | null;
  visa_notes?: string | null;
  preferred_remote_type?: string | null;
  allowed_countries_json?: string[] | null;
  target_roles_json?: string[] | null;
  banned_roles_json?: string[] | null;
  salary_floor?: number | null;
  salary_currency?: string | null;
  start_date_availability?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
  profile_version?: string | null;
  approved_resume_facts_json?: string[] | null;
  approved_answer_bank_json?: Record<string, string> | null;
  disallowed_claims_json?: string[] | null;
};

function parseLocation(value: string | null | undefined): { city: string; country: string } {
  const text = (value ?? '').trim();
  if (!text) return { city: '', country: '' };

  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], country: parts.slice(1).join(', ') };
  return { city: text, country: '' };
}

export function buildCandidateProfileFromRows(
  profileRow?: ProfileRow | null,
  skills: SkillRow[] = [],
  proofPoints: ProofPointRow[] = [],
): CandidateProfile | null {
  if (!profileRow) return null;

  const location = parseLocation(profileRow.location);
  const yearsExperienceByDomain = skills.reduce<Record<string, number>>((acc, skill) => {
    const name = (skill.skill_name ?? '').trim();
    if (!name) return acc;
    const normalized = name.toLowerCase();
    acc[normalized] = Math.max(acc[normalized] ?? 0, Number(skill.years_experience ?? 0));
    return acc;
  }, {});

  const approvedResumeFacts = [
    ...proofPoints.map((proofPoint) => proofPoint.statement ?? '').filter(Boolean),
    ...skills.map((skill) => skill.skill_name ?? '').filter(Boolean),
  ];

  return {
    legal_name: (profileRow.full_name ?? '').trim(),
    email: (profileRow.email ?? '').trim(),
    phone: (profileRow.phone ?? '').trim(),
    location_city: location.city,
    location_country: profileRow.country?.trim() || location.country,
    work_authorization: (profileRow.work_authorization ?? '').trim(),
    visa_status: (profileRow.visa_status ?? '').trim(),
    preferred_remote_type: (profileRow.remote_preference ?? 'flexible') as CandidateProfile['preferred_remote_type'],
    allowed_countries: [profileRow.country, location.country].filter(Boolean).map((value) => String(value).trim()),
    target_roles: profileRow.desired_titles ?? [],
    banned_roles: [],
    salary_floor: Number(profileRow.desired_salary_min ?? 0),
    salary_currency: (profileRow.desired_salary_currency ?? 'USD').trim(),
    years_experience_by_domain: yearsExperienceByDomain,
    approved_resume_facts: approvedResumeFacts,
    approved_answer_bank: {},
    disallowed_claims: [],
    linkedin_url: (profileRow.linkedin_url ?? '').trim(),
    github_url: (profileRow.github_url ?? '').trim(),
    portfolio_url: (profileRow.portfolio_url ?? '').trim(),
  };
}

export function buildCandidateProfileFromCandidateProfileRow(
  profileRow?: CandidateProfileRow | null,
): CandidateProfile | null {
  if (!profileRow) return null;

  return {
    legal_name: (profileRow.full_name ?? '').trim(),
    email: (profileRow.email ?? '').trim(),
    phone: (profileRow.phone ?? '').trim(),
    location_city: (profileRow.location_city ?? '').trim(),
    location_country: (profileRow.location_country ?? '').trim(),
    work_authorization: (profileRow.work_authorization ?? '').trim(),
    visa_status: (profileRow.visa_notes ?? '').trim(),
    preferred_remote_type: (profileRow.preferred_remote_type ?? 'flexible') as CandidateProfile['preferred_remote_type'],
    allowed_countries: (profileRow.allowed_countries_json ?? []).map((value) => String(value).trim()).filter(Boolean),
    target_roles: (profileRow.target_roles_json ?? []).map((value) => String(value).trim()).filter(Boolean),
    banned_roles: (profileRow.banned_roles_json ?? []).map((value) => String(value).trim()).filter(Boolean),
    salary_floor: Number(profileRow.salary_floor ?? 0),
    salary_currency: (profileRow.salary_currency ?? 'USD').trim(),
    years_experience_by_domain: {},
    approved_resume_facts: (profileRow.approved_resume_facts_json ?? []).map((value) => String(value).trim()).filter(Boolean),
    approved_answer_bank: profileRow.approved_answer_bank_json ?? {},
    disallowed_claims: (profileRow.disallowed_claims_json ?? []).map((value) => String(value).trim()).filter(Boolean),
    linkedin_url: (profileRow.linkedin_url ?? '').trim(),
    github_url: (profileRow.github_url ?? '').trim(),
    portfolio_url: (profileRow.portfolio_url ?? '').trim(),
  };
}

export function buildHardlinePreferenceDefaults(prefs: Record<string, string>) {
  return {
    defaultMode: prefs.hardline_default_mode || 'draft',
    skipBelow: Number(prefs.hardline_skip_below || 60),
    draftMin: Number(prefs.hardline_draft_min || 80),
    autoSubmitMin: Number(prefs.hardline_auto_submit_min || 90),
    maxAutoSubmitPerDay: Number(prefs.hardline_max_auto_submit_per_day || 5),
    maxDraftsPerDay: Number(prefs.hardline_max_drafts_per_day || 20),
    requireSubmissionVerification: prefs.hardline_require_submission_verification !== 'false',
  };
}
