CREATE TABLE public.job_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  subscription_type TEXT NOT NULL DEFAULT 'company',
  name TEXT NOT NULL,
  url TEXT DEFAULT '',
  search_query TEXT DEFAULT '',
  country TEXT DEFAULT '',
  check_interval_hours INTEGER DEFAULT 6,
  last_checked_at TIMESTAMP WITH TIME ZONE,
  jobs_found_total INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT job_subscriptions_type_check CHECK (subscription_type IN ('company', 'careers_url', 'linkedin_company', 'linkedin_profile', 'keyword_alert'))
);

ALTER TABLE public.job_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own subscriptions"
ON public.job_subscriptions
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_job_subscriptions_updated_at
BEFORE UPDATE ON public.job_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();