import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { buildHardlineJobInsert } from '@/lib/hardline-import';
import { Loader2, Search, MapPin, Building2, Plus, CheckCircle2, User, Briefcase, Sparkles } from 'lucide-react';

interface SearchResult {
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

interface BulkSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobsAdded: (jobs: any[]) => void;
}

const QUICK_SEARCHES = [
  'Software Engineer',
  'Project Manager',
  'Data Analyst',
  'Marketing Manager',
  'Mechanical Engineer',
  'Finance Analyst',
];

const COUNTRIES = [
  '', 'Qatar', 'UAE', 'Saudi Arabia', 'Bahrain', 'Kuwait', 'Oman', 'Egypt',
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Netherlands', 'Singapore', 'India', 'Remote',
];

type SearchMode = 'free' | 'profile' | 'company';

const BulkSearchDialog = ({ open, onOpenChange, onJobsAdded }: BulkSearchDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchMode, setSearchMode] = useState<SearchMode>('free');
  const [query, setQuery] = useState('');
  const [companyQuery, setCompanyQuery] = useState('');
  const [country, setCountry] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Profile data
  const [profileTitles, setProfileTitles] = useState<string[]>([]);
  const [profileIndustries, setProfileIndustries] = useState<string[]>([]);
  const [profileCountry, setProfileCountry] = useState('');
  const [profileSeniority, setProfileSeniority] = useState('');
  const [selectedProfileTitle, setSelectedProfileTitle] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (open && user && !profileLoaded) {
      loadProfile();
    }
  }, [open, user]);

  const loadProfile = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles_v2')
      .select('desired_titles, desired_industries, country, desired_seniority')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      const titles = Array.isArray(data.desired_titles) ? (data.desired_titles as string[]) : [];
      const industries = Array.isArray(data.desired_industries) ? (data.desired_industries as string[]) : [];
      setProfileTitles(titles);
      setProfileIndustries(industries);
      setProfileCountry(data.country || '');
      setProfileSeniority(data.desired_seniority || '');
    }
    setProfileLoaded(true);
  };

  const buildSearchQuery = (): string => {
    if (searchMode === 'free') return query.trim();
    if (searchMode === 'company') {
      const title = query.trim();
      const company = companyQuery.trim();
      if (!company) return '';
      return title ? `${title} at ${company}` : `jobs at ${company}`;
    }
    // profile mode
    const title = selectedProfileTitle || (profileTitles.length > 0 ? profileTitles[0] : '');
    if (!title) return '';
    const parts = [title];
    if (profileSeniority) parts.unshift(profileSeniority);
    return parts.join(' ');
  };

  const getEffectiveCountry = (): string => {
    if (country && country !== 'all') return country;
    if (searchMode === 'profile' && profileCountry) return profileCountry;
    return '';
  };

  const handleSearch = async () => {
    const searchQuery = buildSearchQuery();
    if (!searchQuery) {
      toast({ title: 'Missing query', description: 'Please enter a search term.', variant: 'destructive' });
      return;
    }
    setSearching(true);
    setResults([]);
    setSelected(new Set());
    setImported(new Set());

    try {
      const effectiveCountry = getEffectiveCountry();
      const { data, error } = await supabase.functions.invoke('search-jobs', {
        body: { query: searchQuery, limit: 15, country: effectiveCountry || undefined },
      });

      if (error) {
        toast({ title: 'Search failed', description: error.message, variant: 'destructive' });
      } else if (data?.jobs?.length > 0) {
        setResults(data.jobs);
        setSelected(new Set(data.jobs.map((_: any, i: number) => i)));
        toast({ title: `Found ${data.jobs.length} jobs` });
      } else {
        toast({ title: 'No results', description: 'Try a different search query.' });
      }
    } catch {
      toast({ title: 'Error', description: 'Search failed', variant: 'destructive' });
    }

    setSearching(false);
  };

  const handleProfileSearchAll = async () => {
    if (profileTitles.length === 0) {
      toast({ title: 'No profile titles', description: 'Add desired job titles in your Profile first.', variant: 'destructive' });
      return;
    }
    setSearching(true);
    setResults([]);
    setSelected(new Set());
    setImported(new Set());

    const allJobs: SearchResult[] = [];
    const effectiveCountry = getEffectiveCountry();

    for (const title of profileTitles.slice(0, 3)) {
      const searchQ = profileSeniority ? `${profileSeniority} ${title}` : title;
      try {
        const { data } = await supabase.functions.invoke('search-jobs', {
          body: { query: searchQ, limit: 10, country: effectiveCountry || undefined },
        });
        if (data?.jobs) allJobs.push(...data.jobs);
      } catch { /* skip */ }
    }

    // Dedupe by apply_url
    const seen = new Set<string>();
    const deduped = allJobs.filter(j => {
      const key = j.apply_url || `${j.title}|${j.company}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (deduped.length > 0) {
      setResults(deduped);
      setSelected(new Set(deduped.map((_, i) => i)));
      toast({ title: `Found ${deduped.length} jobs across ${Math.min(profileTitles.length, 3)} titles` });
    } else {
      toast({ title: 'No results', description: 'Try adjusting your profile preferences.' });
    }
    setSearching(false);
  };

  const toggleSelect = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((_, i) => i)));
    }
  };

  const handleImport = async () => {
    if (!user || selected.size === 0) return;
    setImporting(true);

    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('title, company, apply_url')
      .eq('user_id', user.id);

    const existingUrls = new Set((existingJobs || []).map(j => j.apply_url).filter(Boolean));
    const existingKeys = new Set((existingJobs || []).map(j => `${j.title?.toLowerCase()}|${j.company?.toLowerCase()}`));

    const toImport = results.filter((_, i) => selected.has(i) && !imported.has(i));
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
      return;
    }

    const insertData = deduped.map(job => buildHardlineJobInsert(user.id, job, {
      sourceLabel: 'search',
      sourceData: {
        search_mode: searchMode,
        country: getEffectiveCountry() || null,
        query: buildSearchQuery(),
      },
    }));

    const { data, error } = await (supabase as any).from('jobs').insert(insertData).select();

    if (data) {
      const newImported = new Set(imported);
      results.forEach((_, i) => { if (selected.has(i)) newImported.add(i); });
      setImported(newImported);
      onJobsAdded(data);
      const msg = skipped > 0
        ? `Imported ${data.length} jobs! (${skipped} duplicates skipped)`
        : `Imported ${data.length} jobs!`;
      toast({ title: msg });
    }
    if (error) {
      toast({ title: 'Import error', description: error.message, variant: 'destructive' });
    }

    setImporting(false);
  };

  const resetState = () => {
    setQuery('');
    setCompanyQuery('');
    setCountry('');
    setResults([]);
    setSelected(new Set());
    setImported(new Set());
    setSelectedProfileTitle('');
  };

  const unimportedSelected = [...selected].filter(i => !imported.has(i)).length;
  const canSearch = searchMode === 'free' ? !!query.trim() :
    searchMode === 'company' ? !!companyQuery.trim() :
    !!selectedProfileTitle || profileTitles.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Bulk Job Search
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search mode tabs */}
          <Tabs value={searchMode} onValueChange={(v) => setSearchMode(v as SearchMode)}>
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="free" className="text-xs gap-1.5">
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Free Search</span>
                <span className="sm:hidden">Search</span>
              </TabsTrigger>
              <TabsTrigger value="profile" className="text-xs gap-1.5">
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">From Profile</span>
                <span className="sm:hidden">Profile</span>
              </TabsTrigger>
              <TabsTrigger value="company" className="text-xs gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">By Company</span>
                <span className="sm:hidden">Company</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* FREE SEARCH MODE */}
          {searchMode === 'free' && (
            <>
              <div>
                <p className="text-xs text-muted-foreground mb-2">Quick searches:</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_SEARCHES.map(q => (
                    <Badge key={q} variant="outline" className="text-xs cursor-pointer hover:bg-accent"
                      onClick={() => setQuery(q)}>
                      {q}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder='e.g. "Software Engineer"'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  disabled={searching}
                  className="flex-1"
                />
                <div className="flex gap-2">
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger className="w-[140px] sm:w-[160px]">
                      <SelectValue placeholder="Any Country" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any Country</SelectItem>
                      {COUNTRIES.filter(Boolean).map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleSearch} disabled={searching || !query.trim()}>
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* PROFILE SEARCH MODE */}
          {searchMode === 'profile' && (
            <div className="space-y-3">
              {profileTitles.length === 0 && profileLoaded ? (
                <div className="text-center py-4 text-muted-foreground">
                  <User className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-medium">No desired titles in your profile</p>
                  <p className="text-xs">Go to Profile → Preferences to add desired job titles.</p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Your desired titles:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {profileTitles.map(t => (
                        <Badge
                          key={t}
                          variant={selectedProfileTitle === t ? 'default' : 'outline'}
                          className="text-xs cursor-pointer hover:bg-accent"
                          onClick={() => setSelectedProfileTitle(selectedProfileTitle === t ? '' : t)}
                        >
                          <Briefcase className="w-3 h-3 mr-1" />
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {profileIndustries.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Industries: <span className="text-foreground">{profileIndustries.join(', ')}</span></p>
                    </div>
                  )}
                  {(profileCountry || profileSeniority) && (
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {profileCountry && <span>📍 {profileCountry}</span>}
                      {profileSeniority && <span>📊 {profileSeniority}</span>}
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Select value={country} onValueChange={setCountry}>
                      <SelectTrigger className="w-full sm:w-[160px]">
                        <SelectValue placeholder={profileCountry || 'Any Country'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any Country</SelectItem>
                        {COUNTRIES.filter(Boolean).map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2 flex-1">
                      <Button
                        onClick={handleSearch}
                        disabled={searching || !selectedProfileTitle}
                        variant="outline"
                        className="flex-1"
                      >
                        {searching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                        Search Selected
                      </Button>
                      <Button
                        onClick={handleProfileSearchAll}
                        disabled={searching || profileTitles.length === 0}
                        className="flex-1"
                      >
                        {searching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        Search All Titles
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* COMPANY SEARCH MODE */}
          {searchMode === 'company' && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Find jobs at a specific company:</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Company name (e.g. Egis, AECOM)"
                  value={companyQuery}
                  onChange={e => setCompanyQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  disabled={searching}
                  className="flex-1"
                />
                <Input
                  placeholder="Job title (optional)"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  disabled={searching}
                  className="flex-1"
                />
              </div>
              <div className="flex gap-2">
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger className="w-[140px] sm:w-[160px]">
                    <SelectValue placeholder="Any Country" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any Country</SelectItem>
                    {COUNTRIES.filter(Boolean).map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleSearch} disabled={searching || !companyQuery.trim()} className="flex-1 sm:flex-initial">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </Button>
              </div>
            </div>
          )}

          {/* Results */}
          {searching && (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">Searching job boards{getEffectiveCountry() ? ` in ${getEffectiveCountry()}` : ''}...</p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.size === results.length}
                    onCheckedChange={toggleAll}
                  />
                  <span className="text-sm text-muted-foreground">
                    {selected.size} of {results.length} selected
                  </span>
                </div>
                <Button onClick={() => setConfirmOpen(true)} disabled={importing || unimportedSelected === 0} size="sm">
                  {importing ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                  ) : (
                    <><Plus className="w-4 h-4 mr-2" />Import {unimportedSelected} Jobs</>
                  )}
                </Button>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {results.map((job, idx) => {
                  const isImported = imported.has(idx);
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        isImported ? 'bg-muted/50 border-muted opacity-60' :
                        selected.has(idx) ? 'border-primary/30 bg-primary/5' : 'border-border'
                      }`}
                    >
                      {isImported ? (
                        <CheckCircle2 className="w-5 h-5 text-score-excellent mt-0.5 flex-shrink-0" />
                      ) : (
                        <Checkbox
                          checked={selected.has(idx)}
                          onCheckedChange={() => toggleSelect(idx)}
                          className="mt-0.5"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-foreground truncate">{job.title}</h4>
                        <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{job.company}</span>
                          {job.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {job.remote_type !== 'unknown' && (
                            <Badge variant="outline" className="text-[10px] capitalize">{job.remote_type}</Badge>
                          )}
                          {job.employment_type && (
                            <Badge variant="secondary" className="text-[10px] capitalize">{job.employment_type}</Badge>
                          )}
                          {job.seniority_level && (
                            <Badge variant="secondary" className="text-[10px]">{job.seniority_level}</Badge>
                          )}
                          {job.salary_min && (
                            <Badge variant="secondary" className="text-[10px]">
                              {job.salary_currency || ''} {job.salary_min?.toLocaleString()}{job.salary_max ? ` - ${job.salary_max.toLocaleString()}` : ''}
                            </Badge>
                          )}
                        </div>
                        {Array.isArray(job.requirements) && job.requirements.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {job.requirements.slice(0, 3).map((r, i) => (
                              <span key={i} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{r}</span>
                            ))}
                          </div>
                        )}
                        {isImported && <span className="text-[10px] text-score-excellent font-medium">Imported ✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Import</AlertDialogTitle>
              <AlertDialogDescription>
                You are about to import <strong>{unimportedSelected}</strong> job{unimportedSelected !== 1 ? 's' : ''} to your feed. You can review and remove them later from your Job Feed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="max-h-[200px] overflow-y-auto space-y-1 my-2">
              {results.filter((_, i) => selected.has(i) && !imported.has(i)).map((job, i) => (
                <div key={i} className="text-xs flex items-center gap-2 py-1 px-2 rounded bg-muted/50">
                  <span className="font-medium truncate">{job.title}</span>
                  <span className="text-muted-foreground">@ {job.company}</span>
                </div>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmOpen(false); handleImport(); }}>
                Confirm Import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};

export default BulkSearchDialog;
