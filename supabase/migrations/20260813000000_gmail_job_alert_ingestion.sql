-- Gmail job-alert ingestion
--
-- Stores a per-user Gmail OAuth grant so the app can scan job-alert digests
-- (NaukriGulf, LinkedIn, Bayt, GulfTalent) and import the jobs they list.
--
-- Token safety: refresh_token / access_token are readable ONLY by service_role.
-- RLS lets a user see their own connection row so the UI can show status, but
-- column-level grants keep the credentials themselves server-side. A leaked
-- refresh token would grant ongoing read access to the user's mailbox.

CREATE TABLE IF NOT EXISTS public.gmail_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address text NOT NULL DEFAULT '',
  refresh_token text NOT NULL,
  access_token text DEFAULT '',
  access_token_expires_at timestamptz,
  scope text DEFAULT '',
  -- Gmail historyId of the last scan, so later scans only read new mail.
  last_history_id text DEFAULT '',
  last_scanned_at timestamptz,
  last_scan_status text DEFAULT 'pending'
    CHECK (last_scan_status IN ('pending', 'ok', 'error')),
  last_scan_message text DEFAULT '',
  jobs_imported integer NOT NULL DEFAULT 0,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS gmail_connections_user_idx
  ON public.gmail_connections (user_id);

ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own gmail connection" ON public.gmail_connections;
CREATE POLICY "Users read own gmail connection"
  ON public.gmail_connections FOR SELECT
  USING (auth.uid() = user_id);

-- Disconnecting is the one write a user performs directly.
DROP POLICY IF EXISTS "Users delete own gmail connection" ON public.gmail_connections;
CREATE POLICY "Users delete own gmail connection"
  ON public.gmail_connections FOR DELETE
  USING (auth.uid() = user_id);

-- Connections are created and refreshed by edge functions using service_role,
-- never by the browser, so no INSERT/UPDATE policy is granted to authenticated.

REVOKE ALL ON public.gmail_connections FROM anon, authenticated;
GRANT SELECT (
  id, user_id, email_address, access_token_expires_at, scope,
  last_scanned_at, last_scan_status, last_scan_message, jobs_imported,
  connected_at, updated_at
) ON public.gmail_connections TO authenticated;
GRANT DELETE ON public.gmail_connections TO authenticated;

-- ── Imported-email audit ────────────────────────────────────────────────────
-- Records which Gmail messages were already processed, so a rescan does not
-- re-import the same digest.

CREATE TABLE IF NOT EXISTS public.gmail_scanned_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  sender text DEFAULT '',
  subject text DEFAULT '',
  parser text DEFAULT '',
  jobs_found integer NOT NULL DEFAULT 0,
  jobs_imported integer NOT NULL DEFAULT 0,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS gmail_scanned_messages_user_idx
  ON public.gmail_scanned_messages (user_id, scanned_at DESC);

ALTER TABLE public.gmail_scanned_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own scanned messages" ON public.gmail_scanned_messages;
CREATE POLICY "Users read own scanned messages"
  ON public.gmail_scanned_messages FOR SELECT
  USING (auth.uid() = user_id);

-- ── Allow 'email' as a job source type ──────────────────────────────────────

DO $$
BEGIN
  ALTER TABLE public.job_sources DROP CONSTRAINT IF EXISTS job_sources_source_type_check;
  ALTER TABLE public.job_sources ADD CONSTRAINT job_sources_source_type_check
    CHECK (source_type IN ('manual', 'api', 'rss', 'scraper', 'email'));
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'job_sources table not present; skipping source_type constraint update.';
END $$;

-- ── Flag non-local roles imported from digests ──────────────────────────────
-- Digests are region-wide (UAE, Saudi, Egypt...), so record the country and
-- whether the role is in Qatar. The UI ranks Qatar roles up without discarding
-- the rest.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS country text DEFAULT '';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS is_local boolean DEFAULT true;

COMMENT ON COLUMN public.jobs.country IS
  'Country parsed from the listing location; set by email digest imports.';
COMMENT ON COLUMN public.jobs.is_local IS
  'False when the role is outside the user''s target country (e.g. a UAE role in a regional digest).';
