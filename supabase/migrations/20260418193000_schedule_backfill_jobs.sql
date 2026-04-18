-- Schedule backend job hydration and scoring.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  vault_enabled boolean;
  project_url text;
  function_key text;
  existing_job_id bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname IN ('supabase_vault', 'vault')
  ) INTO vault_enabled;

  IF NOT vault_enabled THEN
    RAISE NOTICE 'Skipping backfill-jobs cron schedule because Vault is not enabled.';
    RETURN;
  END IF;

  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'backfill-jobs-hourly'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  EXECUTE $sql$
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1
  $sql$ INTO project_url;

  EXECUTE $sql$
    SELECT COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key' LIMIT 1)
    )
  $sql$ INTO function_key;

  IF project_url IS NULL OR function_key IS NULL THEN
    RAISE NOTICE 'Skipping backfill-jobs cron schedule because project_url and anon_key/publishable_key are missing from Vault.';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'backfill-jobs-hourly',
    '0 * * * *',
    $cron$
    SELECT
      net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1) || '/functions/v1/backfill-jobs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key' LIMIT 1)
          )
        ),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$
  );
END $$;
