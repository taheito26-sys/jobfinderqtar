-- Allow jobs to be marked as applied so the feed can surface them separately.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname
  INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'jobs'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%status IN (''active'', ''expired'', ''closed'', ''archived'')%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jobs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('active', 'expired', 'closed', 'archived', 'applied'));
