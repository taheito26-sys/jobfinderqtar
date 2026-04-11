-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule hourly auto-search
SELECT cron.schedule(
  'auto-search-jobs-hourly',
  '0 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://moebuhqkwvpfcpsxmvuc.supabase.co/functions/v1/auto-search-jobs',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZWJ1aHFrd3ZwZmNwc3htdnVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTg3NTIsImV4cCI6MjA4ODM5NDc1Mn0.p7QJkDE6TxKhpnjo7gl5ylfrQuMDLCR0sEHcIfyga0c"}'::jsonb,
      body := concat('{"time": "', now(), '"}')::jsonb
    ) AS request_id;
  $$
);
