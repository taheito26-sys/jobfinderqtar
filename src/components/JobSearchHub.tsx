import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { buildHardlineJobInsert } from '@/lib/hardline-import';
import { hydrateImportedJobs, scoreImportedJobs } from '@/lib/job-hydration';
import {
  Search, Globe, Linkedin, Loader2, MapPin, Building2,
  Sparkles, CheckCircle2, ClipboardPaste, Link2, ArrowRight,
} from 'lucide-react';

interface JobSearchHubProps {
  onJobsAdded: (jobs: any[]) => void;
  onOpenBulkSearch: () => void;
  onOpenImport: () => void;
}

interface FoundJob {
  title: string;
  company: string;
  location: string;
  remote_type: string;
  description: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  employment_type: string;
  seniority_level: string;
  requirements: string[];
  apply_url: string;
  source_url: string;
}

const GCC_COUNTRIES = [
  { code: 'Qatar', flag: '🇶🇦' },
  { code: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'UAE', flag: '🇦🇪' },
  { code: 'Kuwait', flag: '🇰🇼' },
  { code: 'Bahrain', flag: '🇧🇭' },
  { code: 'Oman', flag: '🇴🇲' },
  { code: 'Egypt', flag: '🇪🇬' },
];

const QUICK_TITLES = [
  'Software Engineer',
  'Project Manager',
  'Data Analyst',
  'Solution Architect',
  'Business Analyst',
  'DevOps Engineer',
];

const JobSearchHub = ({ onJobsAdded, onOpenBulkSearch, onOpenImport }: JobSearchHubProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('search');

  // Search state
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [searching, setSearching] = useState(false);

  // Results state
  const [results, setResults] = useState<FoundJob[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // URL import state
  const [importUrl, setImportUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [urlResults, setUrlResults] = useState<FoundJob[]>([]);
  const [urlSelected, setUrlSelected] = useState<Set<number>>(new Set());

  const isLinkedIn = (url: string) => {
    try { return new URL(url).hostname.includes('linkedin.com'); } catch { return false; }
  };

  const isProbablyUrl = (value: string) => {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const normalizeLinkedInJobUrl = (value: string) => {
    try {
      const parsed = new URL(value.trim());
      if (parsed.hostname.includes('linkedin.com') && parsed.pathname.includes('/safety/go')) {
        const target = parsed.searchParams.get('url');
        if (target) {
          const decoded = decodeURIComponent(target);
          return decoded.startsWith('http://') || decoded.startsWith('https://')
            ? decoded
            : `https://${decoded}`;
        }
      }
      return value.trim();
    } catch {
      return value.trim();
    }
  };

  const scrapeImportUrl = async (urlToScrape: string) => {
    const normalizedUrl = normalizeLinkedInJobUrl(urlToScrape);
    setActiveTab('url');
    setImportUrl(normalizedUrl);
    setScraping(true);
    setUrlResults([]);
    setUrlSelected(new Set());

    try {
      const { data, error } = await supabase.functions.invoke('scrape-job-url', {
        body: { url: normalizedUrl },
      });

      if (error) {
        toast({ title: 'Scrape failed', description: error.message, variant: 'destructive' });
      } else if (data?.multiple && Array.isArray(data.jobs)) {
        setUrlResults(data.jobs);
        setUrlSelected(new Set(data.jobs.map((_: any, i: number) => i)));
        const failedMsg = data.failed_count ? ` (${data.failed_count} could not be extracted)` : '';
        toast({ title: `Found ${data.jobs.length} jobs!`, description: `Review and select which to import${failedMsg}` });
      } else if (data?.job) {
        setUrlResults([data.job]);
        setUrlSelected(new Set([0]));
        toast({ title: 'Job extracted!', description: `${data.job.title} at ${data.job.company}` });
      } else if (data?.error === 'LINKEDIN_LOGIN_REQUIRED') {
        toast({ title: 'LinkedIn login required', description: data.message || 'Try a direct job URL or use Bulk Search.', variant: 'destructive' });
      } else {
        toast({ title: 'Extraction failed', description: 'Could not extract job data from this URL.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Scrape failed', variant: 'destructive' });
    }

    setScraping(false);
  };

  const handleSearch = async () => {
    if (!query.trim() || !user) return;
    if (isProbablyUrl(query.trim())) {
      await scrapeImportUrl(query.trim());
      return;
    }
    setSearching(true);
    setResults([]);
    setSelected(new Set());

    try {
      const searchQuery = country ? `${query.trim()} ${country}` : query.trim();
      const { data, error } = await supabase.functions.invoke('search-jobs', {
        body: { query: searchQuery, limit: 15, country: country || undefined },
      });

      if (error) {
        toast({ title: 'Search failed', description: error.message, variant: 'destructive' });
      } else if (data?.jobs?.length > 0) {
        // Filter out garbage entries (search result pages, not actual jobs)
        const validJobs = data.jobs.filter((j: FoundJob) => {
          const title = j.title.toLowerCase();
          const company = j.company.toLowerCase();
          // Reject entries that are clearly search result pages
          if (title.match(/^\d+[\+,]?\s*(jobs?|results?|vacancies)/i)) return false;
          if (title.includes('job search') || title.includes('jobs in ')) return false;
          if (company === 'linkedin' || company === 'unknown company' || company === 'glassdoor' || company === 'indeed') return false;
          if (company.includes('vacancies')) return false;
          if (j.apply_url?.includes('/jobs/search') || j.apply_url?.includes('/jobs/collections')) return false;
          return true;
        });

        if (validJobs.length > 0) {
          setResults(validJobs);
          setSelected(new Set(validJobs.map((_: any, i: number) => i)));
          toast({ title: `Found ${validJobs.length} jobs`, description: 'Review and select which to import.' });
        } else {
          toast({ title: 'No valid jobs found', description: 'The search returned pages, not actual job listings. Try being more specific.' });
        }
      } else {
        toast({ title: 'No results', description: 'Try a different search query or country.' });
      }
    } catch {
      toast({ title: 'Error', description: 'Search failed', variant: 'destructive' });
    }
    setSearching(false);
  };

  const handleUrlScrape = async () => {
    if (!importUrl.trim() || !user) return;
    await scrapeImportUrl(importUrl.trim());
  };

  const importJobs = async (jobs: FoundJob[], selectedSet: Set<number>, source: string) => {
    if (!user || selectedSet.size === 0) return;
    setImporting(true);

    // Dedup against existing jobs
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('title, company, apply_url')
      .eq('user_id', user.id);

    const existingUrls = new Set((existingJobs || []).map(j => j.apply_url).filter(Boolean));
    const existingKeys = new Set((existingJobs || []).map(j => `${j.title?.toLowerCase()}|${j.company?.toLowerCase()}`));

    const toImport = jobs.filter((_, i) => selectedSet.has(i));
    const deduped = toImport.filter(job => {
      if (job.apply_url && existingUrls.has(job.apply_url)) return false;
      const key = `${job.title.toLowerCase()}|${job.company.toLowerCase()}`;
      if (existingKeys.has(key)) return false;
      return true;
    });

    const skipped = toImport.length - deduped.length;

    if (deduped.length === 0) {
      toast({ title: 'All duplicates', description: `${skipped} job(s) already exist in your feed.` });
      setImporting(false);
      setConfirmOpen(false);
      return;
    }

    const insertData = deduped.map(job => ({
      ...buildHardlineJobInsert(user.id, job, {
        sourceLabel: source,
        sourceData: { query: query || importUrl },
      }),
    }));

    const { data, error } = await (supabase as any).from('jobs').insert(insertData).select();

    if (data) {
      await Promise.all([
        hydrateImportedJobs(data.map((job: any) => ({
          id: job.id,
          apply_url: job.apply_url,
          source_url: job.source_url,
        }))),
        scoreImportedJobs(data.map((job: any) => job.id)),
      ]);
      onJobsAdded(data);
      const msg = skipped > 0
        ? `Imported ${data.length} jobs (${skipped} duplicates skipped)`
        : `Imported ${data.length} jobs!`;
      toast({ title: msg });
      // Reset
      setResults([]);
      setUrlResults([]);
      setSelected(new Set());
      setUrlSelected(new Set());
      setQuery('');
      setImportUrl('');
    }
    if (error) {
      toast({ title: 'Import error', description: error.message, variant: 'destructive' });
    }

    setImporting(false);
    setConfirmOpen(false);
  };

  const toggleSelect = (set: Set<number>, setFn: (s: Set<number>) => void, idx: number) => {
    const next = new Set(set);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setFn(next);
  };

  const toggleAll = (jobs: FoundJob[], set: Set<number>, setFn: (s: Set<number>) => void) => {
    if (set.size === jobs.length) setFn(new Set());
    else setFn(new Set(jobs.map((_, i) => i)));
  };

  const currentResults = activeTab === 'url' ? urlResults : results;
  const currentSelected = activeTab === 'url' ? urlSelected : selected;
  const currentSetFn = activeTab === 'url' ? setUrlSelected : setSelected;

  return (
    <Card className="mb-4 overflow-hidden border-primary/20 bg-gradient-to-br from-background via-background to-primary/[0.03]">
      <CardContent className="p-0">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Search className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Find & Import Jobs</h3>
              <p className="text-[11px] text-muted-foreground">Search the web, paste a URL, or use advanced bulk search</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onOpenBulkSearch}>
              <Sparkles className="w-3.5 h-3.5" />
              Advanced Search
            </Button>
          </div>
        </div>

        <div className="px-5 pb-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 h-9">
              <TabsTrigger value="search" className="text-xs gap-1.5">
                <Search className="w-3.5 h-3.5" /> Quick Search
              </TabsTrigger>
              <TabsTrigger value="url" className="text-xs gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Import URL
              </TabsTrigger>
            </TabsList>

            {/* QUICK SEARCH TAB */}
            <TabsContent value="search" className="mt-3 space-y-3">
              {/* Quick title chips */}
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TITLES.map(t => (
                  <Badge
                    key={t}
                    variant={query === t ? 'default' : 'outline'}
                    className="text-xs cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => setQuery(t)}
                  >
                    {t}
                  </Badge>
                ))}
              </div>

              {/* Country chips */}
              <div className="flex flex-wrap gap-1.5">
                {GCC_COUNTRIES.map(c => (
                  <button
                    key={c.code}
                    onClick={() => setCountry(country === c.code ? '' : c.code)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 border ${
                      country === c.code
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
                    }`}
                  >
                    <span>{c.flag}</span>{c.code}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder='Job title e.g. "Solution Architect", "DevOps"...'
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    disabled={searching}
                  />
                </div>
                <Button onClick={handleSearch} disabled={searching || !query.trim()} className="gap-1.5">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4" /> Search</>}
                </Button>
              </div>

              {country && (
                <p className="text-xs text-muted-foreground">
                  Searching in <span className="font-medium text-foreground">{country}</span>
                  <button onClick={() => setCountry('')} className="ml-1.5 text-primary hover:underline">clear</button>
                </p>
              )}
            </TabsContent>

            {/* URL IMPORT TAB */}
            <TabsContent value="url" className="mt-3 space-y-3">
              {isLinkedIn(importUrl) && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30">
                  <Linkedin className="w-4 h-4 text-[#0A66C2] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">LinkedIn detected.</span> Search pages with multiple jobs will be extracted individually.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Paste job URL — LinkedIn, Indeed, Bayt, etc."
                    value={importUrl}
                    onChange={e => setImportUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUrlScrape()}
                    disabled={scraping}
                  />
                </div>
                <Button onClick={handleUrlScrape} disabled={scraping || !importUrl.trim()} className="gap-1.5">
                  {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ArrowRight className="w-4 h-4" /> Extract</>}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Or use <button onClick={onOpenImport} className="text-primary hover:underline font-medium">full import dialog</button> for paste-description mode
              </p>
            </TabsContent>
          </Tabs>

          {/* RESULTS */}
          {currentResults.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">{currentResults.length} Jobs Found</span>
                  <span className="text-xs text-muted-foreground">— select which to import</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => toggleAll(currentResults, currentSelected, currentSetFn)}
                >
                  {currentSelected.size === currentResults.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>

              <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                {currentResults.map((job, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      currentSelected.has(idx)
                        ? 'border-primary/40 bg-primary/5 shadow-sm'
                        : 'border-border hover:bg-muted/40'
                    }`}
                    onClick={() => toggleSelect(currentSelected, currentSetFn, idx)}
                  >
                    <Checkbox
                      checked={currentSelected.has(idx)}
                      onCheckedChange={() => toggleSelect(currentSelected, currentSetFn, idx)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-foreground truncate">{job.title}</h4>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-0.5">
                          <Building2 className="w-3 h-3" />{job.company}
                        </span>
                        {job.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="w-3 h-3" />{job.location}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-1.5">
                        {job.remote_type && job.remote_type !== 'unknown' && (
                          <Badge variant="outline" className="text-[10px] capitalize h-5">{job.remote_type}</Badge>
                        )}
                        {job.employment_type && (
                          <Badge variant="secondary" className="text-[10px] capitalize h-5">{job.employment_type}</Badge>
                        )}
                        {job.seniority_level && (
                          <Badge variant="secondary" className="text-[10px] capitalize h-5">{job.seniority_level}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={currentSelected.size === 0 || importing}
                className="w-full gap-1.5"
              >
                {importing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
                  : `Import ${currentSelected.size} Job${currentSelected.size !== 1 ? 's' : ''}`
                }
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Import</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">
                  Import <strong>{currentSelected.size}</strong> job{currentSelected.size !== 1 ? 's' : ''} to your feed:
                </p>
                <div className="max-h-[220px] overflow-y-auto space-y-1.5">
                  {currentResults.filter((_, i) => currentSelected.has(i)).map((job, idx) => (
                    <div key={idx} className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span className="truncate"><strong>{job.title}</strong> at {job.company}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Duplicates will be automatically skipped.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => importJobs(
                currentResults,
                currentSelected,
                activeTab === 'url' ? 'url_import' : 'quick_search',
              )}
              disabled={importing}
            >
              {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Importing...</> : 'Confirm Import'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default JobSearchHub;
