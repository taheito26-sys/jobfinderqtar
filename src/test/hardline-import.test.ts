import { describe, expect, it } from 'vitest';

import {
  buildHardlineJobInsert,
  buildHardlineJobScoreInsert,
  candidateProfileRowToHardlineProfile,
} from '@/lib/hardline-import';

const candidateProfileRow = {
  id: 'profile-1',
  user_id: 'user-1',
  full_name: 'Alex Example',
  email: 'alex@example.com',
  phone: '+97400000000',
  location_city: 'Doha',
  location_country: 'Qatar',
  work_authorization: 'Qatar',
  visa_notes: 'Resident',
  preferred_remote_type: 'remote',
  allowed_countries_json: ['Qatar', 'Remote'],
  target_roles_json: ['Cloud Architect'],
  banned_roles_json: ['Sales'],
  salary_floor: 18000,
  salary_currency: 'QAR',
  approved_resume_facts_json: ['AWS', 'Terraform'],
  approved_answer_bank_json: { relocation: 'Open to Doha' },
  disallowed_claims_json: ['MBA from Harvard'],
  linkedin_url: 'https://linkedin.com/in/alex',
  github_url: 'https://github.com/alex',
  portfolio_url: 'https://alex.example.com',
};

describe('hardline import helpers', () => {
  it('maps a candidate_profile row into a hardline profile', () => {
    const profile = candidateProfileRowToHardlineProfile(candidateProfileRow);

    expect(profile?.location_city).toBe('Doha');
    expect(profile?.target_roles).toEqual(['Cloud Architect']);
    expect(profile?.approved_resume_facts).toContain('AWS');
  });

  it('builds a normalized job row for hardline writes', () => {
    const payload = buildHardlineJobInsert('user-1', {
      title: 'Senior Cloud Architect',
      company: 'Northwind',
      location: 'Doha, Qatar',
      remote_type: 'remote',
      description: 'Build cloud platforms across AWS and Terraform.',
      apply_url: 'https://jobs.example.com/cloud-architect',
      salary_min: 20000,
      salary_max: 26000,
      salary_currency: 'QAR',
      employment_type: 'full-time',
      seniority_level: 'senior',
      requirements: ['AWS', 'Terraform'],
      nice_to_haves: ['Kubernetes'],
    }, {
      sourceLabel: 'search',
      sourceData: { query: 'cloud architect qatar' },
    });

    expect(payload.company).toBe('Northwind');
    expect(payload.apply_url).toBe('https://jobs.example.com/cloud-architect');
    expect(payload.normalized).toBe(false);
    expect(payload.status).toBe('active');
    expect(payload.raw_data?.source).toBe('search');
    expect(payload.raw_data?.job?.title).toBe('Senior Cloud Architect');
  });

  it('builds a conservative score snapshot', () => {
    const profile = candidateProfileRowToHardlineProfile(candidateProfileRow);
    if (!profile) throw new Error('profile missing');

    const scoreRow = buildHardlineJobScoreInsert(
      'user-1',
      'job-1',
      'profile-1',
      profile,
      {
        title: 'Senior Cloud Architect',
        company: 'Northwind',
        location: 'Doha, Qatar',
        remote_type: 'remote',
        description: 'Build cloud platforms across AWS and Terraform.',
        apply_url: 'https://jobs.example.com/cloud-architect',
        salary_min: 20000,
        salary_max: 26000,
        salary_currency: 'QAR',
        employment_type: 'full-time',
        seniority_level: 'senior',
        requirements: ['AWS', 'Terraform'],
      },
    );

    expect(scoreRow.user_id).toBe('user-1');
    expect(scoreRow.candidate_profile_id).toBe('profile-1');
    expect(scoreRow.composite_score).toBeGreaterThanOrEqual(0);
    expect(scoreRow.decision).toMatch(/skip|review|apply_/);
  });
});
