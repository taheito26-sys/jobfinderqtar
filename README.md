# Job Finder

## Scheduled Supabase jobs

The repository no longer stores a baked auth token inside cron migrations. Configure the two Vault secrets below before running the scheduled Edge Functions:

```sql
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_SUPABASE_PUBLISHABLE_KEY', 'anon_key');
```

If your project already had the old token committed, rotate that publishable/anon key in Supabase after applying the cleanup migration.
