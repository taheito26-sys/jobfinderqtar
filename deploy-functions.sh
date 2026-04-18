#!/bin/bash
# Deploy all updated Supabase Edge Functions
# Run this after: supabase login
# Project: moebuhqkwvpfcpsxmvuc

set -e

PROJECT="moebuhqkwvpfcpsxmvuc"

echo "==> Deploying search-jobs (multi-source: LinkedIn + Indeed + Bayt + GulfTalent)"
supabase functions deploy search-jobs --no-verify-jwt --project-ref $PROJECT

echo "==> Deploying linkedin-discover-jobs (fixed import bug)"
supabase functions deploy linkedin-discover-jobs --no-verify-jwt --project-ref $PROJECT

echo "==> Deploying auto-search-jobs (multi-source profile discovery)"
supabase functions deploy auto-search-jobs --no-verify-jwt --project-ref $PROJECT

echo ""
echo "✅ All functions deployed successfully!"
echo "   Functions updated:"
echo "   - search-jobs       : now returns LinkedIn + Indeed + Bayt.com + GulfTalent"
echo "   - linkedin-discover-jobs : fixed broken import that caused zero results"
echo "   - auto-search-jobs  : profile-driven discovery now uses all 4 sources"
