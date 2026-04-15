type LegacyProfile = {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  country: string;
  visa_status: string;
  work_authorization: string;
  remote_preference: string;
  desired_salary_min: number;
  desired_salary_currency: string;
  desired_titles: string[];
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
};

type SkillRow = { skill_name?: string | null; years_experience?: number | null };
type ProofPointRow = { statement?: string | null };

function splitLocation(value: string) {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  return {
    city: parts[0] ?? value.trim(),
    country: parts.slice(1).join(', '),
  };
}

export function buildCandidateProfilePayload(
  userId: string,
  profile: LegacyProfile,
  skills: SkillRow[] = [],
  proofPoints: ProofPointRow[] = [],
) {
  const location = splitLocation(profile.location || '');
  const approvedResumeFacts = [
    ...proofPoints.map((item) => item.statement ?? '').filter(Boolean),
    ...skills.map((item) => item.skill_name ?? '').filter(Boolean),
  ];

  return {
    user_id: userId,
    full_name: profile.full_name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    location_city: location.city || '',
    location_country: profile.country || location.country || '',
    work_authorization: profile.work_authorization || '',
    visa_notes: profile.visa_status || '',
    preferred_remote_type: profile.remote_preference || 'flexible',
    allowed_countries_json: [profile.country, location.country].filter(Boolean),
    target_roles_json: profile.desired_titles || [],
    banned_roles_json: [],
    salary_floor: profile.desired_salary_min || 0,
    salary_currency: profile.desired_salary_currency || 'USD',
    start_date_availability: '',
    linkedin_url: profile.linkedin_url || '',
    github_url: profile.github_url || '',
    portfolio_url: profile.portfolio_url || '',
    profile_version: 'legacy-sync',
    approved_resume_facts_json: approvedResumeFacts,
    approved_answer_bank_json: {},
    disallowed_claims_json: [],
  };
}

export async function syncCandidateProfile(
  userId: string,
  profile: LegacyProfile,
  skills: SkillRow[] = [],
  proofPoints: ProofPointRow[] = [],
) {
  void userId;
  void profile;
  void skills;
  void proofPoints;
  return { data: null, error: null };
}
