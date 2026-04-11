
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Profiles
CREATE TABLE public.profiles_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  headline text DEFAULT '',
  summary text DEFAULT '',
  location text DEFAULT '',
  country text DEFAULT '',
  willing_to_relocate boolean DEFAULT false,
  remote_preference text DEFAULT 'flexible' CHECK (remote_preference IN ('remote', 'hybrid', 'onsite', 'flexible')),
  visa_status text DEFAULT '',
  work_authorization text DEFAULT '',
  languages jsonb DEFAULT '[]'::jsonb,
  desired_salary_min numeric DEFAULT 0,
  desired_salary_max numeric DEFAULT 0,
  desired_salary_currency text DEFAULT 'USD',
  desired_seniority text DEFAULT '',
  desired_titles jsonb DEFAULT '[]'::jsonb,
  desired_industries jsonb DEFAULT '[]'::jsonb,
  linkedin_url text DEFAULT '',
  github_url text DEFAULT '',
  portfolio_url text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile" ON public.profiles_v2
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Profile Skills
CREATE TABLE public.profile_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  skill_name text NOT NULL,
  category text DEFAULT 'other',
  proficiency text DEFAULT 'intermediate' CHECK (proficiency IN ('beginner', 'intermediate', 'advanced', 'expert')),
  years_experience numeric DEFAULT 0,
  is_primary boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own skills" ON public.profile_skills
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Employment History
CREATE TABLE public.employment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company text NOT NULL,
  title text NOT NULL,
  location text DEFAULT '',
  start_date date NOT NULL,
  end_date date,
  is_current boolean DEFAULT false,
  description text DEFAULT '',
  achievements jsonb DEFAULT '[]'::jsonb,
  technologies jsonb DEFAULT '[]'::jsonb,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own employment" ON public.employment_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Education History
CREATE TABLE public.education_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  institution text NOT NULL,
  degree text NOT NULL,
  field_of_study text DEFAULT '',
  start_date date,
  end_date date,
  gpa text DEFAULT '',
  achievements jsonb DEFAULT '[]'::jsonb,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.education_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own education" ON public.education_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Certifications
CREATE TABLE public.certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  issuing_organization text NOT NULL,
  issue_date date,
  expiry_date date,
  credential_id text DEFAULT '',
  credential_url text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own certs" ON public.certifications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Proof Points
CREATE TABLE public.proof_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'achievement',
  statement text NOT NULL,
  metric_value text DEFAULT '',
  context text DEFAULT '',
  employment_id uuid REFERENCES public.employment_history(id) ON DELETE SET NULL,
  tags jsonb DEFAULT '[]'::jsonb,
  verified boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proof_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own proof points" ON public.proof_points
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Master Documents
CREATE TABLE public.master_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('cv', 'resume', 'cover_letter', 'other')),
  title text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer DEFAULT 0,
  mime_type text DEFAULT '',
  parsed_content jsonb DEFAULT '{}'::jsonb,
  is_primary boolean DEFAULT false,
  version integer DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.master_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own documents" ON public.master_documents
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Job Sources
CREATE TABLE public.job_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_name text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'api', 'rss', 'scraper')),
  config jsonb DEFAULT '{}'::jsonb,
  enabled boolean DEFAULT true,
  supports_auto_submit boolean DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sources" ON public.job_sources
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Jobs
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid REFERENCES public.job_sources(id) ON DELETE SET NULL,
  external_id text DEFAULT '',
  title text NOT NULL,
  company text NOT NULL,
  location text DEFAULT '',
  remote_type text DEFAULT 'unknown' CHECK (remote_type IN ('remote', 'hybrid', 'onsite', 'unknown')),
  description text DEFAULT '',
  requirements jsonb DEFAULT '[]'::jsonb,
  nice_to_haves jsonb DEFAULT '[]'::jsonb,
  salary_min numeric,
  salary_max numeric,
  salary_currency text DEFAULT 'USD',
  seniority_level text DEFAULT '',
  industry text DEFAULT '',
  employment_type text DEFAULT 'full-time',
  apply_url text DEFAULT '',
  posted_at timestamptz,
  expires_at timestamptz,
  raw_data jsonb DEFAULT '{}'::jsonb,
  normalized boolean DEFAULT false,
  status text DEFAULT 'active' CHECK (status IN ('active', 'expired', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own jobs" ON public.jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_jobs_user_status ON public.jobs(user_id, status);
CREATE INDEX idx_jobs_company ON public.jobs(company);

-- Job Embeddings
CREATE TABLE public.job_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  embedding extensions.vector(1536),
  model text DEFAULT 'text-embedding-3-small',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own job embeddings" ON public.job_embeddings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_embeddings.job_id AND j.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_embeddings.job_id AND j.user_id = auth.uid())
  );

-- Profile Embeddings
CREATE TABLE public.profile_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  section text DEFAULT 'full',
  embedding extensions.vector(1536),
  model text DEFAULT 'text-embedding-3-small',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own profile embeddings" ON public.profile_embeddings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Job Matches
CREATE TABLE public.job_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  overall_score integer NOT NULL DEFAULT 0 CHECK (overall_score >= 0 AND overall_score <= 100),
  hard_requirements_score integer DEFAULT 0,
  skill_overlap_score integer DEFAULT 0,
  title_relevance_score integer DEFAULT 0,
  seniority_fit_score integer DEFAULT 0,
  industry_fit_score integer DEFAULT 0,
  location_fit_score integer DEFAULT 0,
  compensation_fit_score integer DEFAULT 0,
  language_fit_score integer DEFAULT 0,
  work_auth_fit_score integer DEFAULT 0,
  match_reasons jsonb DEFAULT '[]'::jsonb,
  missing_requirements jsonb DEFAULT '[]'::jsonb,
  blockers jsonb DEFAULT '[]'::jsonb,
  recommendation text DEFAULT 'review' CHECK (recommendation IN ('apply', 'review', 'skip')),
  semantic_similarity numeric DEFAULT 0,
  scored_at timestamptz NOT NULL DEFAULT now(),
  version integer DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own matches" ON public.job_matches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_job_matches_user_score ON public.job_matches(user_id, overall_score DESC);
CREATE UNIQUE INDEX idx_job_matches_user_job ON public.job_matches(user_id, job_id);

-- Tailored Documents
CREATE TABLE public.tailored_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.job_matches(id) ON DELETE SET NULL,
  master_document_id uuid REFERENCES public.master_documents(id) ON DELETE SET NULL,
  document_type text NOT NULL CHECK (document_type IN ('cv', 'cover_letter')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_content jsonb DEFAULT '{}'::jsonb,
  changes_summary jsonb DEFAULT '[]'::jsonb,
  unsupported_claims jsonb DEFAULT '[]'::jsonb,
  approval_status text DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'needs_revision')),
  approved_at timestamptz,
  approved_by uuid,
  file_path text DEFAULT '',
  version integer DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tailored_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tailored docs" ON public.tailored_documents
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Application Drafts
CREATE TABLE public.application_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.job_matches(id) ON DELETE SET NULL,
  tailored_cv_id uuid REFERENCES public.tailored_documents(id) ON DELETE SET NULL,
  tailored_cover_letter_id uuid REFERENCES public.tailored_documents(id) ON DELETE SET NULL,
  apply_mode text NOT NULL DEFAULT 'manual' CHECK (apply_mode IN ('manual', 'assisted', 'auto_submit')),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'ready_to_apply', 'approved', 'blocked', 'submitted')),
  blockers jsonb DEFAULT '[]'::jsonb,
  notes text DEFAULT '',
  additional_fields jsonb DEFAULT '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own drafts" ON public.application_drafts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Application Submissions
CREATE TABLE public.application_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  draft_id uuid NOT NULL REFERENCES public.application_drafts(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submission_method text DEFAULT 'manual' CHECK (submission_method IN ('manual', 'assisted', 'auto_submit')),
  submission_status text DEFAULT 'submitted' CHECK (submission_status IN ('submitted', 'acknowledged', 'interview', 'offer', 'rejected', 'withdrawn', 'no_response')),
  response_received_at timestamptz,
  outcome_notes text DEFAULT '',
  follow_up_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own submissions" ON public.application_submissions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Activity Log
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own activity" ON public.activity_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity" ON public.activity_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access activity" ON public.activity_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_activity_log_user ON public.activity_log(user_id, created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_v2_updated_at BEFORE UPDATE ON public.profiles_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_employment_history_updated_at BEFORE UPDATE ON public.employment_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_master_documents_updated_at BEFORE UPDATE ON public.master_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tailored_documents_updated_at BEFORE UPDATE ON public.tailored_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_application_drafts_updated_at BEFORE UPDATE ON public.application_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_application_submissions_updated_at BEFORE UPDATE ON public.application_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload own documents" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own documents" ON storage.objects
  FOR SELECT USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own documents" ON storage.objects
  FOR UPDATE USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own documents" ON storage.objects
  FOR DELETE USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);
