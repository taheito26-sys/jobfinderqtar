import { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { buildHardlineJobInsert } from '@/lib/hardline-import';
import { formatJobDate, parseJobDate } from '@/lib/job-date';

type JobInsert = Database['public']['Tables']['jobs']['Insert'];
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Search, Loader2, Plus, CheckCircle2, Building2,
  MapPin, Calendar, ListFilter, RefreshCw, Briefcase, Star, Linkedin
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ListingJob {
  title: string;
  company: string;
  location?: string;
  apply_url?: string;
  source_url?: string;
  employment_type?: string;
  remote_type?: string;
  seniority_level?: string;
  source_created_at?: string | null;
  description?: string;
  requirements?: string[];
  linkedin_job_id?: string;
  /** Which pipeline this job came from */
  _source?: 'linkedin' | 'listing' | 'unknown';
}

interface UserProfile {
  desiredTitle?: string;
  desiredSkills?: string[];
  preferredLocation?: string;
}

interface ListingJobsBrowserProps {
  /**
   * Keywords to search LinkedIn for — extracted from the saved job's title.
   * e.g. "Principal Architect Jobs in Doha, Qatar" → "Principal Architect"
   */
  keywords: string;
  /**
   * Location string to pass to LinkedIn search.
   * e.g. "Doha, Qatar"
   */
  location?: string;
  /** Total count shown on the original listing page (if known) */
  totalCount?: number | null;
  /** Source URL of the listing page, used as import reference */
  sourceUrl?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DATE_RANGES: Record<string, { label: string; days: number }> = {
  '7d':   { label: 'Last 7 days',    days: 7 },
  '30d':  { label: 'Last month',     days: 30 },
  '60d':  { label: 'Last 2 months',  days: 60 },
  '90d':  { label: 'Last 3 months',  days: 90 },
  '180d': { label: 'Last 6 months',  days: 180 },
  'all':  { label: 'Any time',       days: 0 },
};

/**
 * Extract clean search keywords from a listing page title.
 * "Principal Architect Jobs in Doha, Qatar" → "Principal Architect"
 * "487 Jobs" → use the keywords prop as-is
 */
function cleanKeywords(raw: string): string {
  return raw
    .replace(/\s+jobs?\s+in\b.*/i, '')   // remove "Jobs in ..." suffix
    .replace(/^\d[\d,]*\s+jobs?$/i, '')   // remove bare "487 Jobs"
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract location from a listing page title or the job's location field.
 * "Principal Architect Jobs in Doha, Qatar" → "Doha, Qatar"
 */
function extractLocationFromTitle(title: string): string | null {
  const m = title.match(/\bjobs?\s+in\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Score a job against a user profile using simple keyword matching.
 * Returns 0-100.
 */
function profileMatchScore(job: ListingJob, profile: UserProfile): number {
  if (!profile.desiredTitle && !profile.desiredSkills?.length) return 50;
  let score = 0;
  const jobText = `${job.title} ${job.description ?? ''} ${(job.requirements ?? []).join(' ')}`.toLowerCase();

  if (profile.desiredTitle) {
    const keywords = profile.desiredTitle.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    const titleWords = job.title.toLowerCase().split(/\s+/);
    const matched = keywords.filter(k => titleWords.some(w => w.includes(k)));
    score += (matched.length / Math.max(keywords.length, 1)) * 50;
  }

  if (profile.desiredSkills?.length) {
    const matched = profile.desiredSkills.filter(s => jobText.includes(s.toLowerCase()));
    score += (matched.length / Math.max(profile.desiredSkills.length, 1)) * 40;
  }

  if (profile.preferredLocation && job.location?.toLowerCase().includes(profile.preferredLocation.toLowerCase())) {
    score += 10;
  }

  return Math.min(100, Math.round(score));
}

// ─── Component ───────────────────────────────────────────────────────────────

const ListingJobsBrowser = ({ keywords, location, totalCount, sourceUrl }: ListingJobsBrowserProps) => {
  const { user } = useAuth();
  const { toast } = useToast();

  // Data state
  const [jobs, setJobs] = useState<ListingJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // User profile for matching
  const [userProfile, setUserProfile] = useState<UserProfile>({});

  // Import tracking
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());

  // Filters — default "last 2 months" as requested
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('60d');
  const [employmentType, setEmploymentType] = useState('all');
  const [remoteType, setRemoteType] = useState('all');
  const [seniority, setSeniority] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'linkedin' | 'listing'

  // Load user profile
  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from('candidate_profiles').select('desired_job_titles, skills').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_preferences').select('key, value').eq('user_id', user.id).in('key', ['preferred_location']),
    ]).then(([profileRes, prefRes]) => {
      const profile = profileRes.data;
      const prefs = prefRes.data || [];
      const prefLoc = prefs.find((p: any) => p.key === 'preferred_location')?.value;
      setUserProfile({
        desiredTitle: (profile?.desired_job_titles as string[] | null)?.[0] || '',
        desiredSkills: (profile?.skills as string[] | null) || [],
        preferredLocation: prefLoc || '',
      });
    });
  }, [user]);

  /**
   * Deduplicate a combined list of jobs by normalised URL and title+company key.
   * Jobs that appear in both sources are kept once (listing-page version preferred
   * as it may carry richer metadata like description).
   */
  function deduplicateJobs(allJobs: ListingJob[]): ListingJob[] {
    const seenUrls = new Set<string>();
    const seenTitleCompany = new Set<string>();
    return allJobs.filter(job => {
      const urlKey = job.apply_url ? job.apply_url.split('?')[0].toLowerCase() : null;
      const tcKey = `${job.title.trim().toLowerCase()}|${job.company.trim().toLowerCase()}`;
      if (urlKey && seenUrls.has(urlKey)) return false;
      if (seenTitleCompany.has(tcKey)) return false;
      if (urlKey) seenUrls.add(urlKey);
      seenTitleCompany.add(tcKey);
      return true;
    });
  }

  /**
   * Fetch from both sources in parallel:
   *   1. LinkedIn native search   → search-jobs edge function
   *   2. Original listing page    → scrape-job-url edge function (Firecrawl + AI)
   *
   * Results are merged and deduplicated. Either source may fail gracefully —
   * the other's results are still shown.
   */
  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);

    const cleanedKeywords = cleanKeywords(keywords);
    const searchLocation = location || extractLocationFromTitle(keywords) || '';

    if (!cleanedKeywords) {
      setError('Could not determine search keywords from this listing.');
      setLoading(false);
      return;
    }

    console.log(`[ListingJobsBrowser] Fetching dual-source: LinkedIn "${cleanedKeywords}" + listing "${sourceUrl}"`);

    // ── Source 1: LinkedIn native search ──────────────────────────────────────
    const linkedInFetch = supabase.functions.invoke('search-jobs', {
      body: { query: cleanedKeywords, country: searchLocation, limit: 25 },
    }).then(({ data, error: fnError }) => {
      if (fnError || data?.error) return [] as ListingJob[];
      return ((data?.jobs || []) as ListingJob[]).map(j => ({ ...j, _source: 'linkedin' as const }));
    }).catch(() => [] as ListingJob[]);

    // ── Source 2: Original listing page scrape (non-LinkedIn) ─────────────────
    const listingFetch: Promise<ListingJob[]> = sourceUrl
      ? supabase.functions.invoke('scrape-job-url', {
          body: { url: sourceUrl },
        }).then(({ data, error: fnError }) => {
          if (fnError || data?.error) return [] as ListingJob[];
          // Listing response may be { multiple: true, jobs: [...] } or { job: {...} }
          const raw: any[] = data?.jobs || (data?.job ? [data.job] : []);
          return raw.map(j => ({ ...j, _source: 'listing' as const }));
        }).catch(() => [] as ListingJob[])
      : Promise.resolve([] as ListingJob[]);

    // ── Merge ─────────────────────────────────────────────────────────────────
    const [linkedInJobs, listingJobs] = await Promise.all([linkedInFetch, listingFetch]);

    // Listing-page jobs first (richer data), LinkedIn jobs appended after
    const merged = deduplicateJobs([...listingJobs, ...linkedInJobs]);

    setJobs(merged);
    setLoaded(true);

    if (merged.length === 0) {
      setError(
        linkedInJobs.length === 0 && listingJobs.length === 0
          ? `No jobs found. LinkedIn may be rate-limiting — try again in a moment.`
          : `No jobs matched your filters.`
      );
    } else {
      console.log(`[ListingJobsBrowser] Total: ${merged.length} jobs (${linkedInJobs.length} LinkedIn + ${listingJobs.length} listing, after dedup)`);
    }

    setLoading(false);
  }, [keywords, location, sourceUrl]);

  // Auto-load on mount
  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Derived filter options from loaded data
  const employmentTypes = useMemo(
    () => [...new Set(jobs.map(j => j.employment_type).filter(Boolean))] as string[],
    [jobs]
  );
  const remoteTypes = useMemo(
    () => [...new Set(jobs.map(j => j.remote_type).filter(v => v && v !== 'unknown'))] as string[],
    [jobs]
  );
  const seniorityLevels = useMemo(
    () => [...new Set(jobs.map(j => j.seniority_level).filter(Boolean))] as string[],
    [jobs]
  );

  // Apply all filters + profile scoring
  const filteredJobs = useMemo(() => {
    const cutoffDays = DATE_RANGES[dateRange]?.days ?? 0;
    const cutoff = cutoffDays > 0 ? new Date(Date.now() - cutoffDays * 86400000) : null;

    return jobs
      .map(job => ({ job, matchScore: profileMatchScore(job, userProfile) }))
      .filter(({ job, matchScore }) => {
        if (search) {
          const q = search.toLowerCase();
          if (!`${job.title} ${job.company} ${job.location ?? ''}`.toLowerCase().includes(q)) return false;
        }
        const jobDate = parseJobDate(job);
        if (cutoff && jobDate && jobDate < cutoff) return false;
        if (employmentType !== 'all' && job.employment_type !== employmentType) return false;
        if (remoteType !== 'all' && job.remote_type !== remoteType) return false;
        if (seniority !== 'all' && job.seniority_level?.toLowerCase() !== seniority) return false;
        if (matchFilter === 'good' && matchScore < 40) return false;
        if (matchFilter === 'great' && matchScore < 70) return false;
        if (sourceFilter !== 'all' && (job._source ?? 'unknown') !== sourceFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const diff = b.matchScore - a.matchScore;
        if (Math.abs(diff) > 5) return diff;
        const aDate = parseJobDate(a.job)?.getTime() ?? 0;
        const bDate = parseJobDate(b.job)?.getTime() ?? 0;
        return bDate - aDate;
      });
  }, [jobs, search, dateRange, employmentType, remoteType, seniority, matchFilter, sourceFilter, userProfile]);

  // Strip tracking query params so the same job reached via different URLs
  // (e.g. ?refId=..., ?trackingId=...) doesn't generate a duplicate key.
  const jobKey = (job: ListingJob) =>
    (job.apply_url ? job.apply_url.split('?')[0] : null) ||
    job.linkedin_job_id ||
    `${job.title}|${job.company}`;

  const importJob = async (job: ListingJob) => {
    if (!user) return;
    const key = jobKey(job);
    setImportingKey(key);
    try {
      const insertPayload = buildHardlineJobInsert(user.id, job as any, {
        sourceLabel: 'linkedin',
        sourceData: { imported_from: sourceUrl || job.apply_url, listing_source: sourceUrl },
      }) as JobInsert;

      const { data, error: dbError } = await supabase
        .from('jobs')
        .insert(insertPayload)
        .select()
        .single();

      if (dbError) throw dbError;

      await supabase.from('application_events').insert({
        user_id: user.id,
        job_id: data.id,
        event_type: 'job_imported',
        metadata: { source: 'listing_browser', source_url: sourceUrl } as any,
      });

      setImportedKeys(prev => new Set(prev).add(key));
      toast({ title: `"${job.title}" added to your Job Feed!` });
    } catch (err: any) {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    }
    setImportingKey(null);
  };

  const clearFilters = () => {
    setSearch('');
    setDateRange('60d');
    setEmploymentType('all');
    setRemoteType('all');
    setSeniority('all');
    setMatchFilter('all');
    setSourceFilter('all');
  };

  const hasActiveFilters =
    search || dateRange !== '60d' || employmentType !== 'all' ||
    remoteType !== 'all' || seniority !== 'all' || matchFilter !== 'all' || sourceFilter !== 'all';

  const cleanedKeywordsDisplay = cleanKeywords(keywords);
  const locationDisplay = location || extractLocationFromTitle(keywords) || '';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Briefcase className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                Jobs in this Listing
                <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800 font-normal gap-1">
                  <Linkedin className="w-2.5 h-2.5" /> LinkedIn
                </Badge>
                <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800 font-normal">
                  + Web Sources
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                "{cleanedKeywordsDisplay}"{locationDisplay ? ` · ${locationDisplay}` : ''}
                {totalCount != null && ` · ~${totalCount.toLocaleString()} on source`}
              </p>
            </div>
          </div>
          {loaded && (
            <Button variant="ghost" size="sm" onClick={loadJobs} disabled={loading} className="h-7 text-xs gap-1 shrink-0">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">

        {/* ── Loading ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <p className="text-sm">Searching LinkedIn &amp; web sources for related jobs…</p>
            <p className="text-xs text-muted-foreground">"{cleanedKeywordsDisplay}"{locationDisplay ? ` in ${locationDisplay}` : ''}</p>
          </div>
        )}

        {/* ── Error ── */}
        {!loading && error && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={loadJobs}>Try Again</Button>
          </div>
        )}

        {/* ── Results ── */}
        {!loading && loaded && !error && (
          <>
            {/* Filter bar */}
            <div className="space-y-3 bg-muted/40 rounded-lg p-3 border">
              <div className="flex items-center gap-2">
                <ListFilter className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  <strong>{filteredJobs.length}</strong> of <strong>{jobs.length}</strong>
                </span>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" className="h-5 text-xs px-1.5 text-primary" onClick={clearFilters}>
                    Reset
                  </Button>
                )}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search title or company…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* Posted within */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5" /> Posted within
                  </p>
                  <Select value={dateRange} onValueChange={setDateRange}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(DATE_RANGES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Profile match */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide flex items-center gap-1">
                    <Star className="w-2.5 h-2.5" /> Profile match
                  </p>
                  <Select value={matchFilter} onValueChange={setMatchFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All jobs</SelectItem>
                      <SelectItem value="good">Good match (40%+)</SelectItem>
                      <SelectItem value="great">Great match (70%+)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Remote */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Remote</p>
                  <Select value={remoteType} onValueChange={setRemoteType}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any</SelectItem>
                      {remoteTypes.length > 0
                        ? remoteTypes.map(rt => <SelectItem key={rt} value={rt} className="capitalize">{rt}</SelectItem>)
                        : <>
                            <SelectItem value="remote">Remote</SelectItem>
                            <SelectItem value="hybrid">Hybrid</SelectItem>
                            <SelectItem value="onsite">On-site</SelectItem>
                          </>
                      }
                    </SelectContent>
                  </Select>
                </div>

                {/* Job type */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Job type</p>
                  <Select value={employmentType} onValueChange={setEmploymentType}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any</SelectItem>
                      {employmentTypes.length > 0
                        ? employmentTypes.map(et => <SelectItem key={et} value={et} className="capitalize">{et}</SelectItem>)
                        : <>
                            <SelectItem value="full-time">Full-time</SelectItem>
                            <SelectItem value="part-time">Part-time</SelectItem>
                            <SelectItem value="contract">Contract</SelectItem>
                          </>
                      }
                    </SelectContent>
                  </Select>
                </div>

                {/* Source */}
                <div className="col-span-2">
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Source</p>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      <SelectItem value="linkedin">
                        <span className="flex items-center gap-1.5">
                          <Linkedin className="w-3 h-3 text-sky-600" /> LinkedIn only
                        </span>
                      </SelectItem>
                      <SelectItem value="listing">Web sources only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Seniority */}
                {seniorityLevels.length > 0 && (
                  <div className="col-span-2">
                    <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Seniority</p>
                    <Select value={seniority} onValueChange={setSeniority}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any level</SelectItem>
                        {seniorityLevels.map(sl => (
                          <SelectItem key={sl} value={sl.toLowerCase()} className="capitalize">{sl}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* Job list */}
            {filteredJobs.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground space-y-2">
                <Search className="w-7 h-7 mx-auto opacity-30" />
                <p className="text-sm font-medium">No jobs match your filters</p>
                <p className="text-xs">Try expanding the date range or clearing the profile match filter.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
                  Clear All Filters
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
                {filteredJobs.map(({ job, matchScore }, idx) => {
                  const key = jobKey(job);
                  const isImported = importedKeys.has(key);
                  const isImporting = importingKey === key;
                  const dateLabel = formatJobDate(job);
                  const hasProfile = userProfile.desiredTitle || userProfile.desiredSkills?.length;

                  const matchColor =
                    matchScore >= 70
                      ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                      : matchScore >= 40
                        ? 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                        : 'text-muted-foreground bg-muted/50';

                  return (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border bg-background hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-sm text-foreground leading-snug line-clamp-2">{job.title}</h4>
                          {hasProfile && (
                            <Badge variant="outline" className={`text-[10px] shrink-0 h-5 px-1.5 ${matchColor}`}>
                              {matchScore}%
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                          {job.company && (
                            <span className="flex items-center gap-0.5">
                              <Building2 className="w-3 h-3 shrink-0" />{job.company}
                            </span>
                          )}
                          {job.location && (
                            <>
                              <span className="text-border">·</span>
                              <span className="flex items-center gap-0.5">
                                <MapPin className="w-3 h-3 shrink-0" />{job.location}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1 items-center">
                          {dateLabel && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Calendar className="w-2.5 h-2.5" /> {dateLabel}
                            </span>
                          )}
                          {job._source === 'linkedin' && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800 gap-0.5">
                              <Linkedin className="w-2 h-2" /> LinkedIn
                            </Badge>
                          )}
                          {job._source === 'listing' && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800">
                              Web
                            </Badge>
                          )}
                          {job.remote_type && job.remote_type !== 'unknown' && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{job.remote_type}</Badge>
                          )}
                          {job.employment_type && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 capitalize">{job.employment_type}</Badge>
                          )}
                          {job.seniority_level && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{job.seniority_level}</Badge>
                          )}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant={isImported ? 'secondary' : 'default'}
                        className="h-7 text-xs shrink-0 gap-1"
                        onClick={() => !isImported && !isImporting && importJob(job)}
                        disabled={isImporting || isImported}
                      >
                        {isImporting
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : isImported
                            ? <><CheckCircle2 className="w-3 h-3" /> Added</>
                            : <><Plus className="w-3 h-3" /> Add</>
                        }
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ListingJobsBrowser;
