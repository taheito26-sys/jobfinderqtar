
-- linkedin_profiles table
CREATE TABLE public.linkedin_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  linkedin_sub text UNIQUE,
  full_name text,
  email text,
  avatar_url text,
  headline text,
  profile_url text,
  raw_claims jsonb DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.linkedin_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own linkedin profile"
  ON public.linkedin_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_linkedin_profiles_updated_at
  BEFORE UPDATE ON public.linkedin_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- application_events table
CREATE TABLE public.application_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  draft_id uuid,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own application events"
  ON public.application_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add source_url to jobs
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS source_url text DEFAULT '';
