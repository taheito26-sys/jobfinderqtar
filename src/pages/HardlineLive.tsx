import { useEffect, useMemo, useState } from 'react';

import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_HARDLINE_POLICY,
  evaluateJob,
  type CandidateProfile,
  type NormalizedJob,
} from '@/lib/hardline';
import { buildCandidateProfileFromRows, buildHardlinePreferenceDefaults } from '@/lib/hardline-profile';
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  CheckCircle2,
  FileDown,
  Hourglass,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

const sampleJob: NormalizedJob = {
  source: 'greenhouse',
  source_job_id: 'gh-123',
  canonical_url: 'https://jobs.example.com/roles/cloud-architect',
  title: 'Senior Cloud Architect',
  company_name: 'Northwind',
  location_text: 'Remote - Doha',
  country: 'Qatar',
  city: 'Doha',
  remote_type: 'remote',
  employment_type: 'full-time',
  seniority: 'senior',
  salary_min: 20000,
  salary_max: 26000,
  salary_currency: 'QAR',
  description_text: 'Need AWS, Terraform, and stakeholder leadership. Remote in Qatar.',
  easy_apply_flag: false,
  external_apply_flag: true,
  visa_sponsorship_text: 'Visa sponsorship available',
  required_skills: ['AWS', 'Terraform'],
  preferred_skills: ['Kubernetes'],
  screening_questions_detected: ['Are you authorized to work in Qatar?'],
  normalization_status: 'valid',
  archived_flag: false,
};

const modeCards = [
  {
    name: 'Collect',
    icon: Bot,
    description: 'Ingest, normalize, score, and classify. Never submits anything.',
  },
  {
    name: 'Draft',
    icon: FileDown,
    description: 'Tailor resumes and prepare answers, then stop before final submit.',
  },
  {
    name: 'Auto-submit',
    icon: CheckCircle2,
    description: 'Allowed only for the highest-confidence jobs with verified evidence.',
  },
];

const gatingRows = [
  ['Skip below', '0-59'],
  ['Review band', '60-79'],
  ['Draft band', '80-89'],
  ['Auto-submit band', '90-100'],
  ['Truth guard', 'No unsupported claims or invented facts'],
  ['Verification', 'Final submission needs external evidence'],
  ['Controls', 'Daily caps, cooldowns, quiet hours, retry backoff'],
];

const EMPTY_PROFILE: CandidateProfile = {
  legal_name: '',
  email: '',
  phone: '',
  location_city: '',
  location_country: '',
  work_authorization: '',
  preferred_remote_type: 'flexible',
  allowed_countries: [],
  target_roles: [],
  banned_roles: [],
  salary_floor: 0,
  salary_currency: 'USD',
  years_experience_by_domain: {},
  approved_resume_facts: [],
  approved_answer_bank: {},
  disallowed_claims: [],
};

const HardlineLive = () => {
  const { user } = useAuth();
  const [profileRow, setProfileRow] = useState<any | null>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [proofPoints, setProofPoints] = useState<any[]>([]);
  const [latestJob, setLatestJob] = useState<NormalizedJob | null>(null);
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      const [profileRes, skillsRes, proofRes, prefsRes, jobRes] = await Promise.all([
        supabase.from('profiles_v2').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('profile_skills').select('*').eq('user_id', user.id),
        supabase.from('proof_points').select('*').eq('user_id', user.id),
        supabase.from('user_preferences').select('*').eq('user_id', user.id).in('key', [
          'hardline_default_mode',
          'hardline_skip_below',
          'hardline_draft_min',
          'hardline_auto_submit_min',
          'hardline_max_auto_submit_per_day',
          'hardline_max_drafts_per_day',
          'hardline_require_submission_verification',
        ]),
        supabase.from('jobs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1),
      ]);

      setProfileRow(profileRes.data ?? null);
      setSkills(skillsRes.data ?? []);
      setProofPoints(proofRes.data ?? []);
      const legacyJob = jobRes.data?.[0] as any | undefined;
      setLatestJob(legacyJob ? {
        source: legacyJob.source ?? 'manual',
        source_job_id: legacyJob.external_id ?? legacyJob.source_job_id ?? '',
        canonical_url: legacyJob.canonical_url ?? legacyJob.apply_url ?? '',
        title: legacyJob.title ?? '',
        company_name: legacyJob.company_name ?? legacyJob.company ?? '',
        location_text: legacyJob.location_text ?? legacyJob.location ?? '',
        country: legacyJob.country ?? '',
        city: legacyJob.city ?? '',
        remote_type: legacyJob.remote_type ?? 'unknown',
        employment_type: legacyJob.employment_type ?? 'full-time',
        seniority: legacyJob.seniority ?? legacyJob.seniority_level ?? '',
        salary_min: legacyJob.salary_min ?? null,
        salary_max: legacyJob.salary_max ?? null,
        salary_currency: legacyJob.salary_currency ?? 'USD',
        description_text: legacyJob.description_text ?? legacyJob.description ?? '',
        posted_at: legacyJob.posted_at ?? null,
        discovered_at: legacyJob.discovered_at ?? legacyJob.created_at ?? null,
        easy_apply_flag: legacyJob.easy_apply_flag ?? false,
        external_apply_flag: legacyJob.external_apply_flag ?? Boolean(legacyJob.apply_url),
        visa_sponsorship_text: legacyJob.visa_sponsorship_text ?? null,
        required_skills: Array.isArray(legacyJob.required_skills_json) ? legacyJob.required_skills_json : Array.isArray(legacyJob.requirements) ? legacyJob.requirements : [],
        preferred_skills: Array.isArray(legacyJob.preferred_skills_json) ? legacyJob.preferred_skills_json : Array.isArray(legacyJob.nice_to_haves) ? legacyJob.nice_to_haves : [],
        screening_questions_detected: Array.isArray(legacyJob.screening_questions_detected_json) ? legacyJob.screening_questions_detected_json : [],
        normalization_status: legacyJob.normalization_status ?? (legacyJob.title && legacyJob.company_name ? 'valid' : 'incomplete'),
        duplicate_group_key: legacyJob.duplicate_group_key ?? null,
        archived_flag: legacyJob.archived_flag ?? false,
      } : null);
      const prefMap: Record<string, string> = {};
      (prefsRes.data ?? []).forEach((row: any) => {
        prefMap[row.key] = row.value;
      });
      setPrefs(prefMap);
      setLoading(false);
    };

    load();
  }, [user]);

  const candidateProfile = useMemo(
    () => buildCandidateProfileFromRows(profileRow, skills, proofPoints) ?? EMPTY_PROFILE,
    [profileRow, skills, proofPoints],
  );

  const policy = useMemo(
    () => ({
      ...DEFAULT_HARDLINE_POLICY,
      ...buildHardlinePreferenceDefaults(prefs),
    }),
    [prefs],
  );

  const evaluation = useMemo(
    () => evaluateJob(latestJob ?? sampleJob, candidateProfile, policy),
    [candidateProfile, latestJob, policy],
  );

  const profileSummary = candidateProfile.legal_name
    ? [
      candidateProfile.legal_name,
      candidateProfile.location_city,
      candidateProfile.location_country,
      candidateProfile.work_authorization,
      candidateProfile.target_roles.join(', '),
      `${candidateProfile.approved_resume_facts.length} approved facts`,
    ].filter(Boolean)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hardline Control Center"
        description="Conservative defaults, exact evidence, and no silent success states."
      />

      <Card className="border-primary/20 bg-gradient-to-br from-background via-background to-primary/5">
        <CardContent className="p-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                Default mode: {policy.defaultMode}
              </Badge>
              <Badge variant="outline">Personal use only</Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Decision engine before automation.</h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                The system only advances when the job is valid, the profile is truthful, and the evidence trail is intact.
                Browser work is a downstream effect, not the product.
              </p>
              {candidateProfile.legal_name ? (
                <p className="text-xs text-muted-foreground">
                  Live profile loaded for {profileSummary.join(' · ')}.
                </p>
              ) : (
                <p className="text-xs text-amber-600">
                  No profile loaded yet. Populate your Profile page to activate live scoring.
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Skip below</p>
                <p className="text-xl font-semibold">{policy.skipBelow}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Draft min</p>
                <p className="text-xl font-semibold">{policy.draftMin}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Auto-submit min</p>
                <p className="text-xl font-semibold">{policy.autoSubmitMin}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Daily auto cap</p>
                <p className="text-xl font-semibold">{policy.maxAutoSubmitPerDay}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-medium">Example classification</h3>
            </div>
            {loading ? <p className="text-sm text-muted-foreground">Loading live profile and latest job...</p> : null}
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Decision</span>
                <Badge>{evaluation.decision}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Composite score</span>
                <span className="font-semibold">{evaluation.compositeScore}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Mode gate</span>
                <span className="font-semibold">{evaluation.eligibleForAutoSubmit ? 'eligible' : 'blocked'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Latest job</span>
                <span className="font-semibold">{latestJob?.title ?? sampleJob.title}</span>
              </div>
            </div>
            <Separator />
            <div className="space-y-2 text-xs text-muted-foreground">
              {evaluation.hardDisqualifiers.length === 0 ? (
                <div className="flex items-start gap-2 text-foreground">
                  <BadgeCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-500" />
                  <span>No hard disqualifiers in the current example.</span>
                </div>
              ) : (
                evaluation.hardDisqualifiers.map((disqualifier) => (
                  <div key={disqualifier} className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 text-amber-500" />
                    <span>{disqualifier}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {modeCards.map(({ name, icon: Icon, description }) => (
          <Card key={name}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                {name}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              {description}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              Gating Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {gatingRows.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 rounded-lg border bg-background px-3 py-2">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-sm text-muted-foreground text-right">{value}</span>
              </div>
            ))}
            <div className="rounded-lg border bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Thresholds are read from `user_preferences`, so the Settings page can govern behavior without code changes.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Hourglass className="h-4 w-4 text-muted-foreground" />
              Submission Evidence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
              <span>Browser click logs are not proof of submission.</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
              <span>Confirmation text, ID, portal status, or confirmation email is required.</span>
            </div>
            <div className="flex items-start gap-2">
              <FileDown className="mt-0.5 h-4 w-4 text-primary" />
              <span>Screenshots and HTML snapshots are stored for every critical step.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default HardlineLive;
