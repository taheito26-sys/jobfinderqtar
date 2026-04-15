import { describe, expect, it } from 'vitest';

import {
  buildDuplicateGroupKey,
  evaluateJob,
  truthGuardStatements,
  type CandidateProfile,
  type NormalizedJob,
} from '@/lib/hardline';

const profile: CandidateProfile = {
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
  disallowed_claims: ['10 years of AWS experience', 'MBA from Harvard'],
};

const job: NormalizedJob = {
  source: 'greenhouse',
  source_job_id: 'gh-123',
  canonical_url: 'https://jobs.example.com/roles/cloud-architect?utm_source=test',
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
  posted_at: '2026-04-10T00:00:00.000Z',
  discovered_at: '2026-04-11T00:00:00.000Z',
  easy_apply_flag: false,
  external_apply_flag: true,
  visa_sponsorship_text: 'Visa sponsorship available',
  required_skills: ['AWS', 'Terraform'],
  preferred_skills: ['Kubernetes'],
  screening_questions_detected: ['Are you authorized to work in Qatar?'],
  normalization_status: 'valid',
  duplicate_group_key: null,
  archived_flag: false,
};

describe('hardline policy helpers', () => {
  it('builds a canonical duplicate key from the URL when present', () => {
    expect(buildDuplicateGroupKey(job)).toBe('url:jobs.example.com/roles/cloud-architect');
  });

  it('scores a qualified job for auto-submit eligibility', () => {
    const evaluation = evaluateJob(job, profile);

    expect(evaluation.normalizationStatus).toBe('valid');
    expect(evaluation.hardDisqualifiers).toEqual([]);
    expect(evaluation.compositeScore).toBeGreaterThanOrEqual(60);
    expect(evaluation.decision).toBe('review');
    expect(evaluation.eligibleForAutoSubmit).toBe(false);
  });

  it('blocks jobs with a work authorization mismatch', () => {
    const blocked = evaluateJob(
      {
        ...job,
        description_text: 'Must already be authorized to work in the United States.',
        visa_sponsorship_text: '',
      },
      { ...profile, work_authorization: 'Qatar' },
    );

    expect(blocked.decision).toBe('skip');
    expect(blocked.hardDisqualifiers).toContain('work_authorization_mismatch');
  });

  it('truth-guards tailored claims against unsupported statements', () => {
    const ok = truthGuardStatements(['Led cloud migration for 12 services'], profile);
    const blocked = truthGuardStatements(['Led cloud migration for 25 services'], profile);

    expect(ok.allowed).toBe(true);
    expect(blocked.allowed).toBe(false);
    expect(blocked.violations[0]).toMatch(/unsupported_claim/);
  });
});
