import { describe, expect, it } from 'vitest';

import { buildCandidateProfilePayload } from '@/lib/candidate-profile-sync';

describe('candidate profile sync', () => {
  it('maps the legacy profile shape into the hardline candidate profile payload', () => {
    const payload = buildCandidateProfilePayload(
      'user-1',
      {
        full_name: 'Alex Example',
        email: 'alex@example.com',
        phone: '+97400000000',
        location: 'Doha, Qatar',
        country: 'Qatar',
        visa_status: 'Resident',
        work_authorization: 'Qatar',
        remote_preference: 'remote',
        desired_salary_min: 18000,
        desired_salary_currency: 'QAR',
        desired_titles: ['Cloud Architect'],
        linkedin_url: 'https://linkedin.com/in/alex',
        github_url: 'https://github.com/alex',
        portfolio_url: 'https://alex.example.com',
      },
      [{ skill_name: 'AWS', years_experience: 7 }],
      [{ statement: 'Led cloud migration for 12 services' }],
    );

    expect(payload.user_id).toBe('user-1');
    expect(payload.full_name).toBe('Alex Example');
    expect(payload.location_city).toBe('Doha');
    expect(payload.location_country).toBe('Qatar');
    expect(payload.target_roles_json).toEqual(['Cloud Architect']);
    expect(payload.approved_resume_facts_json).toEqual([
      'Led cloud migration for 12 services',
      'AWS',
    ]);
  });
});
