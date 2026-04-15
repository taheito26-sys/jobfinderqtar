-- Migration: linkedin_ingestion_pipeline
-- Description: Adds tables and columns for LinkedIn-native ingestion pipeline

-- 1. Create linkedin_search_runs table
CREATE TABLE IF NOT EXISTS public.linkedin_search_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    source_id uuid REFERENCES public.job_sources(id) ON DELETE SET NULL,
    run_mode text NOT NULL CHECK (run_mode IN ('manual', 'scheduled')),
    run_type text NOT NULL CHECK (run_type IN ('discover', 'enrich', 'pipeline')),
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed')),
    search_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
    search_location text,
    remote_preference text,
    posted_within text,
    page_limit int,
    results_discovered int NOT NULL DEFAULT 0,
    results_staged int NOT NULL DEFAULT 0,
    results_enriched int NOT NULL DEFAULT 0,
    results_upserted int NOT NULL DEFAULT 0,
    results_failed int NOT NULL DEFAULT 0,
    error_summary text,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Create linkedin_discovered_jobs table
CREATE TABLE IF NOT EXISTS public.linkedin_discovered_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    source_id uuid REFERENCES public.job_sources(id) ON DELETE SET NULL,
    run_id uuid REFERENCES public.linkedin_search_runs(id) ON DELETE SET NULL,
    linkedin_job_id text NOT NULL,
    title text,
    company text,
    location text,
    listed_at_text text,
    source_created_at timestamptz,
    apply_url text NOT NULL,
    search_url text,
    search_keyword text,
    search_location text,
    page_number int,
    discovery_status text NOT NULL DEFAULT 'new' CHECK (discovery_status IN ('new', 'duplicate', 'queued', 'enriched', 'failed', 'stale')),
    enrichment_status text NOT NULL DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'running', 'success', 'failed', 'skipped')),
    failure_count int NOT NULL DEFAULT 0,
    last_error text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    raw_card_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, linkedin_job_id)
);

-- 3. Alter jobs table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'source_platform') THEN
        ALTER TABLE public.jobs ADD COLUMN source_platform text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'linkedin_job_id') THEN
        ALTER TABLE public.jobs ADD COLUMN linkedin_job_id text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'first_seen_at') THEN
        ALTER TABLE public.jobs ADD COLUMN first_seen_at timestamptz DEFAULT now();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'last_seen_at') THEN
        ALTER TABLE public.jobs ADD COLUMN last_seen_at timestamptz DEFAULT now();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'source_created_at') THEN
        ALTER TABLE public.jobs ADD COLUMN source_created_at timestamptz;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'discovery_run_id') THEN
        ALTER TABLE public.jobs ADD COLUMN discovery_run_id uuid REFERENCES public.linkedin_search_runs(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'raw_source_card') THEN
        ALTER TABLE public.jobs ADD COLUMN raw_source_card jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'jobs' AND COLUMN_NAME = 'raw_source_detail') THEN
        ALTER TABLE public.jobs ADD COLUMN raw_source_detail jsonb;
    END IF;
END $$;

-- 4. Create Indexes
CREATE INDEX IF NOT EXISTS idx_linkedin_search_runs_user_id_created_at ON public.linkedin_search_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_search_runs_source_id_created_at ON public.linkedin_search_runs(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_search_runs_status_created_at ON public.linkedin_search_runs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_discovered_jobs_user_enrichment ON public.linkedin_discovered_jobs(user_id, enrichment_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_discovered_jobs_user_discovery ON public.linkedin_discovered_jobs(user_id, discovery_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_discovered_jobs_user_last_seen ON public.linkedin_discovered_jobs(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_linkedin_discovered_jobs_job_id ON public.linkedin_discovered_jobs(linkedin_job_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_linkedin_job_id ON public.jobs(user_id, linkedin_job_id) WHERE linkedin_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_user_source_platform ON public.jobs(user_id, source_platform);
CREATE INDEX IF NOT EXISTS idx_jobs_user_last_seen_at ON public.jobs(user_id, last_seen_at DESC);

-- 5. RLS Policies
ALTER TABLE public.linkedin_search_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_discovered_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own search runs" ON public.linkedin_search_runs
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can see their own discovered jobs" ON public.linkedin_discovered_jobs
    FOR ALL USING (auth.uid() = user_id);

-- 6. Updated At Trigger for linkedin_discovered_jobs
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER tr_linkedin_discovered_jobs_updated_at
    BEFORE UPDATE ON public.linkedin_discovered_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
