-- Recreate scheduled Edge Function jobs without committed auth tokens.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  vault_enabled boolean;
  project_url text;
  function_key text;
  existing_job_id bigint;
BEGIN
  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'auto-search-jobs-hourly'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'check-subscriptions-6h'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname IN ('supabase_vault', 'vault')
  ) INTO vault_enabled;

  IF NOT vault_enabled THEN
    RAISE NOTICE 'Cron jobs were unscheduled. Enable Vault and add project_url plus anon_key/publishable_key secrets before re-running this migration logic.';
    RETURN;
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
    RAISE NOTICE 'Cron jobs were unscheduled. Add Vault secrets named project_url and anon_key or publishable_key before recreating them.';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'auto-search-jobs-hourly',
    '0 * * * *',
    $cron$
    SELECT
      net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1) || '/functions/v1/auto-search-jobs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'publishable_key' LIMIT 1)
          )
        ),
        body := concat('{"time": "', now(), '"}')::jsonb
      ) AS request_id;
    $cron$
  );

  PERFORM cron.schedule(
    'check-subscriptions-6h',
    '30 */6 * * *',
    $cron$
    SELECT
      net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1) || '/functions/v1/check-subscriptions',
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
