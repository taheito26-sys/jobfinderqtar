-- Hardline personal job-ops foundation.
-- Extends the existing user-owned schema with the decision ledger and evidence tables
-- required for conservative collect/draft/auto-submit workflows.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_job_id text,
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_normalized text,
  ADD COLUMN IF NOT EXISTS location_text text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS seniority text,
  ADD COLUMN IF NOT EXISTS description_text text,
  ADD COLUMN IF NOT EXISTS required_skills_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preferred_skills_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS screening_questions_detected_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS easy_apply_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_apply_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS visa_sponsorship_text text,
  ADD COLUMN IF NOT EXISTS normalization_status text DEFAULT 'incomplete',
  ADD COLUMN IF NOT EXISTS duplicate_group_key text,
  ADD COLUMN IF NOT EXISTS archived_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS discovered_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_normalization_status_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_normalization_status_check
      CHECK (normalization_status IN ('valid', 'invalid', 'incomplete'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_canonical_url_unique
  ON public.jobs (canonical_url)
  WHERE canonical_url IS NOT NULL AND canonical_url <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_job_unique
  ON public.jobs (source_id, source_job_id)
  WHERE source_job_id IS NOT NULL AND source_job_id <> '';

CREATE INDEX IF NOT EXISTS idx_jobs_company_title_city
  ON public.jobs (company_normalized, title, city);

CREATE INDEX IF NOT EXISTS idx_jobs_posted_at
  ON public.jobs (posted_at);

CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at
  ON public.jobs (discovered_at);

CREATE TABLE IF NOT EXISTS public.candidate_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  location_city text NOT NULL DEFAULT '',
  location_country text NOT NULL DEFAULT '',
  work_authorization text NOT NULL DEFAULT '',
  visa_notes text DEFAULT '',
  preferred_remote_type text NOT NULL DEFAULT 'flexible',
  allowed_countries_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_roles_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  banned_roles_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  salary_floor numeric DEFAULT 0,
  salary_currency text NOT NULL DEFAULT 'USD',
  start_date_availability text DEFAULT '',
  linkedin_url text DEFAULT '',
  github_url text DEFAULT '',
  portfolio_url text DEFAULT '',
  master_resume_id uuid,
  profile_version text NOT NULL DEFAULT 'v1',
  approved_resume_facts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_answer_bank_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  disallowed_claims_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.candidate_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own candidate profile" ON public.candidate_profile
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.resume_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  base_resume_id uuid,
  version_label text NOT NULL,
  target_role_family text NOT NULL DEFAULT '',
  source_profile_version text NOT NULL DEFAULT '',
  content_markdown text NOT NULL DEFAULT '',
  content_plaintext text NOT NULL DEFAULT '',
  pdf_path text NOT NULL DEFAULT '',
  content_hash text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resume_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own resume versions" ON public.resume_versions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.answer_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL,
  role_family text NOT NULL DEFAULT '',
  source_profile_version text NOT NULL DEFAULT '',
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_flag boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.answer_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own answer packs" ON public.answer_packs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_name text NOT NULL,
  adapter_type text NOT NULL DEFAULT 'manual',
  base_url text NOT NULL DEFAULT '',
  active_flag boolean NOT NULL DEFAULT true,
  auth_mode text NOT NULL DEFAULT 'none',
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sources" ON public.sources
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.source_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  run_mode text NOT NULL DEFAULT 'collect',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  jobs_seen_count integer NOT NULL DEFAULT 0,
  jobs_inserted_count integer NOT NULL DEFAULT 0,
  jobs_updated_count integer NOT NULL DEFAULT 0,
  jobs_invalid_count integer NOT NULL DEFAULT 0,
  errors_json jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.source_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own source sync runs" ON public.source_sync_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.raw_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  source_job_id text NOT NULL DEFAULT '',
  raw_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_html_path text NOT NULL DEFAULT '',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  checksum text NOT NULL DEFAULT ''
);

ALTER TABLE public.raw_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own raw jobs" ON public.raw_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_jobs_source_job
  ON public.raw_jobs (source_id, source_job_id);

CREATE TABLE IF NOT EXISTS public.job_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  candidate_profile_id uuid NOT NULL REFERENCES public.candidate_profile(id) ON DELETE CASCADE,
  title_score integer NOT NULL DEFAULT 0,
  skills_score integer NOT NULL DEFAULT 0,
  seniority_score integer NOT NULL DEFAULT 0,
  location_score integer NOT NULL DEFAULT 0,
  salary_score integer NOT NULL DEFAULT 0,
  authorization_score integer NOT NULL DEFAULT 0,
  domain_score integer NOT NULL DEFAULT 0,
  disqualifier_score integer NOT NULL DEFAULT 0,
  composite_score integer NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'skip',
  reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  hard_disqualifiers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  scored_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own job scores" ON public.job_scores
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_scores_job_profile
  ON public.job_scores (job_id, candidate_profile_id);

CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  candidate_profile_id uuid NOT NULL REFERENCES public.candidate_profile(id) ON DELETE CASCADE,
  application_mode text NOT NULL DEFAULT 'collect',
  application_status text NOT NULL DEFAULT 'draft_ready',
  decision_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  resume_version_id uuid REFERENCES public.resume_versions(id) ON DELETE SET NULL,
  answer_pack_id uuid REFERENCES public.answer_packs(id) ON DELETE SET NULL,
  tailored_summary_text text NOT NULL DEFAULT '',
  portal_account_email text NOT NULL DEFAULT '',
  draft_url text NOT NULL DEFAULT '',
  submitted_at timestamptz,
  verified_at timestamptz,
  failure_reason text NOT NULL DEFAULT '',
  source_confirmation_ref text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own applications" ON public.applications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_job_candidate
  ON public.applications (job_id, candidate_profile_id);

CREATE TABLE IF NOT EXISTS public.application_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  step_name text NOT NULL,
  step_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  page_url text NOT NULL DEFAULT '',
  selector_used text NOT NULL DEFAULT '',
  input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  screenshot_path text NOT NULL DEFAULT '',
  html_snapshot_path text NOT NULL DEFAULT '',
  event_time timestamptz NOT NULL DEFAULT now(),
  error_text text NOT NULL DEFAULT ''
);

ALTER TABLE public.application_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own application steps" ON public.application_steps
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.applications app
      WHERE app.id = application_steps.application_id AND app.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications app
      WHERE app.id = application_steps.application_id AND app.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.submission_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  evidence_value text NOT NULL DEFAULT '',
  screenshot_path text NOT NULL DEFAULT '',
  html_snapshot_path text NOT NULL DEFAULT '',
  collected_at timestamptz NOT NULL DEFAULT now(),
  confidence_score numeric NOT NULL DEFAULT 0
);

ALTER TABLE public.submission_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own submission evidence" ON public.submission_evidence
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.applications app
      WHERE app.id = submission_evidence.application_id AND app.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications app
      WHERE app.id = submission_evidence.application_id AND app.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  outcome_type text NOT NULL CHECK (outcome_type IN ('interview', 'recruiter_reply', 'rejection', 'assessment', 'offer', 'withdrawn', 'no_response_checkpoint')),
  source text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL DEFAULT now(),
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own outcomes" ON public.outcomes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.applications app
      WHERE app.id = outcomes.application_id AND app.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications app
      WHERE app.id = outcomes.application_id AND app.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.sources(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  value integer NOT NULL DEFAULT 0,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own rate limit events" ON public.rate_limit_events
  FOR ALL USING (
    source_id IS NULL OR EXISTS (
      SELECT 1 FROM public.sources src
      WHERE src.id = rate_limit_events.source_id AND src.user_id = auth.uid()
    )
  ) WITH CHECK (
    source_id IS NULL OR EXISTS (
      SELECT 1 FROM public.sources src
      WHERE src.id = rate_limit_events.source_id AND src.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_candidate_profile_updated_at BEFORE UPDATE ON public.candidate_profile
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_resume_versions_updated_at BEFORE UPDATE ON public.resume_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_answer_packs_updated_at BEFORE UPDATE ON public.answer_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sources_updated_at BEFORE UPDATE ON public.sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
