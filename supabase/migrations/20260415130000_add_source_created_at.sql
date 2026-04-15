-- Add source_created_at to jobs table.
-- This stores the real original posting date published by the source website,
-- distinct from created_at (our DB insert time) and posted_at (legacy field, never populated).
-- Null means the source did not expose a posting date.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_created_at timestamptz DEFAULT NULL;
