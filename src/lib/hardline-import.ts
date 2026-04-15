import type { CandidateProfile, HardlinePolicy, NormalizedJob } from '@/lib/hardline';
import {
  DEFAULT_HARDLINE_POLICY,
  buildDuplicateGroupKey,
  evaluateJob,
  normalizeCanonicalUrl,
} from '@/lib/hardline';

type ImportedJobLike = {
  title: string;
  company: string;
  location?: string | null;
  remote_type?: string | null;
  description?: string | null;
  salary_min?: number | string | null;
  salary_max?: number | string | null;
  salary_currency?: string | null;
  employment_type?: string | null;
  seniority_level?: string | null;
  requirements?: string[] | null;
  apply_url?: string | null;
  source_url?: string | null;
  source_created_at?: string | null;
  nice_to_haves?: string[] | null;
};

type JobInsertOptions = {
  sourceLabel: string;
  sourceId?: string | null;
  sourceJobId?: string | null;
  normalizationStatus?: 'valid' | 'invalid' | 'incomplete';
  sourceData?: Record<string, unknown>;
};

type CandidateProfileRowLike = {
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
  approved_resume_facts_json?: string[] | null;
  approved_answer_bank_json?: Record<string, string> | null;
  disallowed_claims_json?: string[] | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim();
}

function normalizeCompany(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function splitLocation(location: string | null | undefined) {
  const text = normalizeText(location);
  if (!text) return { city: '', country: '' };
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0] ?? '', country: parts.slice(1).join(', ') };
  }
  return { city: text, country: '' };
}

function toArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function buildSourceJobId(job: ImportedJobLike) {
  const canonicalUrl = normalizeCanonicalUrl(job.apply_url || job.source_url || '');
  if (canonicalUrl) return canonicalUrl;
  const title = normalizeText(job.title).toLowerCase();
  const company = normalizeCompany(job.company);
  const location = normalizeText(job.location).toLowerCase();
  return `${title}|${company}|${location}`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function inferNormalizationStatus(job: ImportedJobLike, fallback: 'valid' | 'invalid' | 'incomplete' = 'incomplete') {
  const description = normalizeText(job.description);
  if (!normalizeText(job.title) || !normalizeText(job.company)) return 'invalid' as const;
  if (job.apply_url && !normalizeCanonicalUrl(job.apply_url)) return fallback;
  if (!description) return 'incomplete' as const;
  return description.length >= 250 ? 'valid' as const : 'incomplete' as const;
}

export function candidateProfileRowToHardlineProfile(row?: CandidateProfileRowLike | null): CandidateProfile | null {
  if (!row) return null;

  return {
    legal_name: normalizeText(row.full_name),
    email: normalizeText(row.email),
    phone: normalizeText(row.phone),
    location_city: normalizeText(row.location_city),
    location_country: normalizeText(row.location_country),
    work_authorization: normalizeText(row.work_authorization),
    visa_status: normalizeText(row.visa_notes),
    preferred_remote_type: (normalizeText(row.preferred_remote_type) || 'flexible') as CandidateProfile['preferred_remote_type'],
    allowed_countries: toArray(row.allowed_countries_json),
    target_roles: toArray(row.target_roles_json),
    banned_roles: toArray(row.banned_roles_json),
    salary_floor: Number(row.salary_floor ?? 0),
    salary_currency: normalizeText(row.salary_currency) || 'USD',
    years_experience_by_domain: {},
    approved_resume_facts: toArray(row.approved_resume_facts_json),
    approved_answer_bank: row.approved_answer_bank_json ?? {},
    disallowed_claims: toArray(row.disallowed_claims_json),
    linkedin_url: normalizeText(row.linkedin_url),
    github_url: normalizeText(row.github_url),
    portfolio_url: normalizeText(row.portfolio_url),
  };
}

export function buildHardlineJobInsert(
  userId: string,
  job: ImportedJobLike,
  options: JobInsertOptions,
) {
  const canonicalUrl = normalizeCanonicalUrl(job.apply_url || job.source_url || '');
  const location = splitLocation(job.location);
  const normalizationStatus = options.normalizationStatus || inferNormalizationStatus(job);
  const sourceJobId = options.sourceJobId || buildSourceJobId(job);

  return {
    user_id: userId,
    source_id: options.sourceId ?? null,
    source_job_id: sourceJobId,
    title: normalizeText(job.title),
    company: normalizeText(job.company),
    company_name: normalizeText(job.company),
    company_normalized: normalizeCompany(job.company),
    location: normalizeText(job.location),
    location_text: normalizeText(job.location),
    country: location.country || '',
    city: location.city || '',
    remote_type: normalizeText(job.remote_type) || 'unknown',
    description: normalizeText(job.description),
    description_text: normalizeText(job.description),
    salary_min: job.salary_min === '' || job.salary_min === null || job.salary_min === undefined ? null : Number(job.salary_min),
    salary_max: job.salary_max === '' || job.salary_max === null || job.salary_max === undefined ? null : Number(job.salary_max),
    salary_currency: normalizeText(job.salary_currency) || null,
    employment_type: normalizeText(job.employment_type) || 'full-time',
    seniority_level: normalizeText(job.seniority_level) || '',
    seniority: normalizeText(job.seniority_level) || '',
    requirements: (job.requirements ?? []) as any,
    required_skills_json: toArray(job.requirements),
    preferred_skills_json: toArray(job.nice_to_haves),
    screening_questions_detected_json: [],
    apply_url: normalizeText(job.apply_url) || null,
    source_url: normalizeText(job.source_url) || normalizeText(job.apply_url) || null,
    canonical_url: canonicalUrl || null,
    raw_data: {
      source: options.sourceLabel,
      source_id: options.sourceId ?? null,
      ...options.sourceData,
      job,
    } as any,
    normalized: normalizationStatus === 'valid',
    status: 'active',
    easy_apply_flag: Boolean(normalizeText(job.apply_url)?.toLowerCase().includes('easy apply')),
    external_apply_flag: Boolean(normalizeText(job.apply_url) || normalizeText(job.source_url)),
    visa_sponsorship_text: '',
    normalization_status: normalizationStatus,
    duplicate_group_key: buildDuplicateGroupKey({
      canonical_url: canonicalUrl,
      title: normalizeText(job.title),
      company_name: normalizeText(job.company),
      city: location.city,
      location_text: normalizeText(job.location),
    }),
    archived_flag: false,
    discovered_at: normalizeText(job.source_created_at) || new Date().toISOString(),
  };
}

export function buildHardlineJobScoreInsert(
  userId: string,
  jobId: string,
  candidateProfileId: string,
  profile: CandidateProfile,
  job: ImportedJobLike,
  policy: HardlinePolicy = DEFAULT_HARDLINE_POLICY,
) {
  const normalizedJob: NormalizedJob = {
    id: jobId,
    source_id: null,
    source_job_id: '',
    canonical_url: normalizeCanonicalUrl(job.apply_url || job.source_url || ''),
    title: normalizeText(job.title),
    company_name: normalizeText(job.company),
    company_normalized: normalizeCompany(job.company),
    location_text: normalizeText(job.location),
    country: splitLocation(job.location).country || '',
    city: splitLocation(job.location).city || '',
    remote_type: (normalizeText(job.remote_type) || 'unknown') as NormalizedJob['remote_type'],
    employment_type: (normalizeText(job.employment_type) || 'full-time') as NormalizedJob['employment_type'],
    seniority: normalizeText(job.seniority_level) || '',
    salary_min: job.salary_min === '' || job.salary_min === null || job.salary_min === undefined ? null : Number(job.salary_min),
    salary_max: job.salary_max === '' || job.salary_max === null || job.salary_max === undefined ? null : Number(job.salary_max),
    salary_currency: normalizeText(job.salary_currency) || null,
    easy_apply_flag: Boolean(normalizeText(job.apply_url)?.toLowerCase().includes('easy apply')),
    external_apply_flag: Boolean(normalizeText(job.apply_url) || normalizeText(job.source_url)),
    posted_at: normalizeText(job.source_created_at) || null,
    discovered_at: normalizeText(job.source_created_at) || new Date().toISOString(),
    description_text: normalizeText(job.description),
    required_skills: toArray(job.requirements),
    preferred_skills: toArray(job.nice_to_haves),
    screening_questions_detected: [],
    visa_sponsorship_text: '',
    normalization_status: inferNormalizationStatus(job),
    duplicate_group_key: buildDuplicateGroupKey({
      canonical_url: normalizeCanonicalUrl(job.apply_url || job.source_url || ''),
      title: normalizeText(job.title),
      company_name: normalizeText(job.company),
      city: splitLocation(job.location).city,
      location_text: normalizeText(job.location),
    }),
    archived_flag: false,
  };

  const evaluation = evaluateJob(normalizedJob, profile, policy);

  return {
    user_id: userId,
    job_id: jobId,
    candidate_profile_id: candidateProfileId,
    title_score: evaluation.breakdown.titleScore,
    skills_score: evaluation.breakdown.skillsScore,
    seniority_score: evaluation.breakdown.seniorityScore,
    location_score: evaluation.breakdown.locationScore,
    salary_score: evaluation.breakdown.salaryScore,
    authorization_score: evaluation.breakdown.authorizationScore,
    domain_score: evaluation.breakdown.domainScore,
    disqualifier_score: evaluation.hardDisqualifiers.length > 0 ? 0 : 100,
    composite_score: evaluation.compositeScore,
    decision: evaluation.decision,
    reasons_json: evaluation.reasons as any,
    hard_disqualifiers_json: evaluation.hardDisqualifiers as any,
    scored_at: new Date().toISOString(),
  };
}

export async function ensureHardlineSource(
  supabaseClient: any,
  userId: string,
  sourceName: string,
  sourceType: string,
  baseUrl = '',
  config: Record<string, unknown> = {},
) {
  const existing = await supabaseClient
    .from('sources')
    .select('id')
    .eq('user_id', userId)
    .eq('source_name', sourceName)
    .maybeSingle();

  if (existing.data?.id) {
    return existing.data.id as string;
  }

  const { data, error } = await supabaseClient
    .from('sources')
    .insert({
      user_id: userId,
      source_name: sourceName,
      adapter_type: sourceType,
      base_url: baseUrl,
      active_flag: true,
      auth_mode: 'none',
      config_json: config,
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

export async function recordHardlineSourceSyncBatch(
  supabaseClient: any,
  userId: string,
  sourceName: string,
  sourceType: string,
  jobs: ImportedJobLike[],
  options: {
    baseUrl?: string;
    config?: Record<string, unknown>;
    runMode?: string;
    normalizeStatus?: 'valid' | 'invalid' | 'incomplete';
  } = {},
) {
  const sourceId = await ensureHardlineSource(
    supabaseClient,
    userId,
    sourceName,
    sourceType,
    options.baseUrl || '',
    options.config || {},
  );

  const { data: run, error: runError } = await supabaseClient
    .from('source_sync_runs')
    .insert({
      user_id: userId,
      source_id: sourceId,
      run_mode: options.runMode || 'collect',
      status: 'running',
      started_at: new Date().toISOString(),
      jobs_seen_count: jobs.length,
      jobs_inserted_count: jobs.length,
      jobs_updated_count: 0,
      jobs_invalid_count: 0,
      errors_json: [],
    })
    .select('id')
    .single();

  if (runError) {
    throw runError;
  }

  const rawRows = jobs.map((job) => ({
    user_id: userId,
    source_id: sourceId,
    source_job_id: buildSourceJobId(job),
    raw_payload_json: {
      source: sourceName,
      source_type: sourceType,
      job,
    },
    raw_html_path: '',
    checksum: hashString(JSON.stringify(job)),
  }));

  if (rawRows.length > 0) {
    const { error: rawError } = await supabaseClient.from('raw_jobs').upsert(rawRows, {
      onConflict: 'source_id,source_job_id',
    });
    if (rawError) {
      throw rawError;
    }
  }

  await supabaseClient
    .from('source_sync_runs')
    .update({
      completed_at: new Date().toISOString(),
      status: 'completed',
    })
    .eq('id', run.id);

  return { sourceId, runId: run.id as string };
}
