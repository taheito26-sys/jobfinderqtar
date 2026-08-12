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

echo ""
echo "✅ All functions deployed successfully!"
echo "   Functions updated:"
echo "   - search-jobs       : now returns LinkedIn + Naukrigulf + GulfTalent"
echo "   - linkedin-discover-jobs : fixed broken import that caused zero results"
echo "   - auto-search-jobs  : profile-driven discovery uses the same source set"
echo ""
echo "   Note: Indeed and Bayt.com are disabled by default — both block"
echo "   datacenter traffic (403 / Cloudflare) and return zero results."
