import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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

import {
  DEFAULT_HARDLINE_POLICY,
  evaluateJob,
  type CandidateProfile,
  type NormalizedJob,
} from '@/lib/hardline';

const sampleProfile: CandidateProfile = {
  legal_name: 'Alex Example',
  email: 'alex@example.com',
  phone: '+97400000000',
  location_city: 'Doha',
  location_country: 'Qatar',
  work_authorization: 'Qatar',
  preferred_remote_type: 'remote',
  allowed_countries: ['Qatar', 'UAE', 'Remote'],
  target_roles: ['Cloud Architect', 'Solutions Architect'],
  banned_roles: ['Sales', 'Recruitment'],
  salary_floor: 18000,
  salary_currency: 'QAR',
  years_experience_by_domain: { cloud: 7, architecture: 5 },
  approved_resume_facts: [
    'Led cloud migration for 12 services',
    'Built Terraform modules used by 6 teams',
    'AWS',
    'Terraform',
  ],
  approved_answer_bank: { relocation: 'Open to Qatar and remote roles only' },
  disallowed_claims: ['10 years of AWS experience'],
};

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

const evaluation = evaluateJob(sampleJob, sampleProfile);

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

const Hardline = () => {
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
                Default mode locked to draft
              </Badge>
              <Badge variant="outline">Personal use only</Badge>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Decision engine before automation.</h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                The system only advances when the job is valid, the profile is truthful, and the evidence trail is intact.
                Browser work is a downstream effect, not the product.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Skip below</p>
                <p className="text-xl font-semibold">{DEFAULT_HARDLINE_POLICY.skipBelow}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Draft min</p>
                <p className="text-xl font-semibold">{DEFAULT_HARDLINE_POLICY.draftMin}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Auto-submit min</p>
                <p className="text-xl font-semibold">{DEFAULT_HARDLINE_POLICY.autoSubmitMin}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Daily auto cap</p>
                <p className="text-xl font-semibold">{DEFAULT_HARDLINE_POLICY.maxAutoSubmitPerDay}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-medium">Example classification</h3>
            </div>
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
            </div>
            <Separator />
            <div className="space-y-2 text-xs text-muted-foreground">
              {evaluation.hardDisqualifiers.length === 0 ? (
                <div className="flex items-start gap-2 text-foreground">
                  <BadgeCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-500" />
                  <span>No hard disqualifiers in the sample job.</span>
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

export default Hardline;
