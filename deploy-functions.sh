#!/bin/bash
# Deploy all updated Supabase Edge Functions
# Run this after: supabase login
# Project: moebuhqkwvpfcpsxmvuc

set -e

PROJECT="moebuhqkwvpfcpsxmvuc"

echo "==> Deploying search-jobs (multi-source: LinkedIn + Naukrigulf + GulfTalent)"
supabase functions deploy search-jobs --no-verify-jwt --project-ref $PROJECT

echo "==> Deploying linkedin-discover-jobs (fixed import bug)"
supabase functions deploy linkedin-discover-jobs --no-verify-jwt --project-ref $PROJECT

echo "==> Deploying auto-search-jobs (multi-source profile discovery)"
supabase functions deploy auto-search-jobs --no-verify-jwt --project-ref $PROJECT

echo "==> Deploying gmail-oauth (Gmail job-alert connection)"
supabase functions deploy gmail-oauth --no-verify-jwt --project-ref $PROJECT

echo "==> Deploying gmail-scan-jobs (import jobs from alert emails)"
supabase functions deploy gmail-scan-jobs --no-verify-jwt --project-ref $PROJECT

echo ""
echo "✅ All functions deployed successfully!"
echo "   Functions updated:"
echo "   - search-jobs       : now returns LinkedIn + Naukrigulf + GulfTalent"
echo "   - linkedin-discover-jobs : fixed broken import that caused zero results"
echo "   - auto-search-jobs  : profile-driven discovery uses the same source set"
echo "   - gmail-oauth       : connect/disconnect Gmail for job-alert scanning"
echo "   - gmail-scan-jobs   : parse job-alert digests and import the jobs"
echo ""
echo "   Note: Indeed and Bayt.com are disabled by default — both block"
echo "   datacenter traffic (403 / Cloudflare) and return zero results."
echo ""
echo "   Gmail requires these project secrets and the DB migration:"
echo "     supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... --project-ref $PROJECT"
echo "     supabase db push --project-ref $PROJECT"
