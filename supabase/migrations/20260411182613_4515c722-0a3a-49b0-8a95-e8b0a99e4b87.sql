SELECT cron.schedule(
  'check-subscriptions-6h',
  '30 */6 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://moebuhqkwvpfcpsxmvuc.supabase.co/functions/v1/check-subscriptions',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZWJ1aHFrd3ZwZmNwc3htdnVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTg3NTIsImV4cCI6MjA4ODM5NDc1Mn0.p7QJkDE6TxKhpnjo7gl5ylfrQuMDLCR0sEHcIfyga0c"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $$
);