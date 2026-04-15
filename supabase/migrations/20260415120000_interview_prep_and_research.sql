
-- Add legitimacy fields to job_matches
ALTER TABLE public.job_matches
  ADD COLUMN IF NOT EXISTS legitimacy_tier text DEFAULT 'unknown'
    CHECK (legitimacy_tier IN ('high_confidence', 'proceed_with_caution', 'suspicious', 'unknown')),
  ADD COLUMN IF NOT EXISTS legitimacy_score integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS legitimacy_reasons jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS legitimacy_flags jsonb DEFAULT '[]'::jsonb;

-- Company research reports
CREATE TABLE IF NOT EXISTS public.company_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company text NOT NULL,
  ai_strategy text DEFAULT '',
  recent_movements text DEFAULT '',
  engineering_culture text DEFAULT '',
  probable_challenges text DEFAULT '',
  competitive_positioning text DEFAULT '',
  candidate_angle text DEFAULT '',
  summary text DEFAULT '',
  researched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, job_id)
);

ALTER TABLE public.company_research ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own research" ON public.company_research
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Interview story bank (STAR+R)
CREATE TABLE IF NOT EXISTS public.interview_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  situation text NOT NULL DEFAULT '',
  task text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT '',
  reflection text NOT NULL DEFAULT '',
  tags jsonb DEFAULT '[]'::jsonb,
  linked_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  impact_level text DEFAULT 'medium' CHECK (impact_level IN ('low', 'medium', 'high', 'transformative')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.interview_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own interview stories" ON public.interview_stories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
