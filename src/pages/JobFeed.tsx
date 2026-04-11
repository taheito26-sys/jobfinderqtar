import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import ScoreBadge from '@/components/ScoreBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { Rss, Plus, MapPin, Building2, Search, Loader2, Zap, Trash2, Globe, Linkedin, Filter, X, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import ImportJobDialog from '@/components/ImportJobDialog';
import BulkSearchDialog from '@/components/BulkSearchDialog';

const JobFeed = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [matches, setMatches] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [addOpen, setAddOpen] = useState(false);
  const [batchScoring, setBatchScoring] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkSearchOpen, setBulkSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newJob, setNewJob] = useState({ title: '', company: '', location: '', remote_type: 'unknown', description: '', apply_url: '', salary_min: '', salary_max: '' });

  // Advanced filters
  const [companyFilter, setCompanyFilter] = useState('all');
  const [remoteFilter, setRemoteFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]);
  const [recommendationFilter, setRecommendationFilter] = useState('all');
  const [seniorityFilter, setSeniorityFilter] = useState('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [hasSalary, setHasSalary] = useState('all');

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: jobsData } = await supabase.from('jobs').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(200);
      const { data: matchesData } = await supabase.from('job_matches').select('*').eq('user_id', user.id);
      setJobs(jobsData ?? []);
      const matchMap: Record<string, any> = {};
      (matchesData ?? []).forEach(m => { matchMap[m.job_id] = m; });
      setMatches(matchMap);
      setLoading(false);
    };
    load();
  }, [user]);

  // Extract unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const companies = [...new Set(jobs.map(j => j.company).filter(Boolean))].sort();
    const locations = [...new Set(jobs.map(j => j.location).filter(Boolean))].sort();
    const seniorities = [...new Set(jobs.map(j => j.seniority_level).filter(Boolean))].sort();
    const industries = [...new Set(jobs.map(j => j.industry).filter(Boolean))].sort();
    const recommendations = [...new Set(
      Object.values(matches).map((m: any) => m.recommendation).filter(Boolean)
    )].sort();
    return { companies, locations, seniorities, industries, recommendations };
  }, [jobs, matches]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (companyFilter !== 'all') count++;
    if (remoteFilter !== 'all') count++;
    if (locationFilter !== 'all') count++;
    if (scoreRange[0] > 0 || scoreRange[1] < 100) count++;
    if (recommendationFilter !== 'all') count++;
    if (seniorityFilter !== 'all') count++;
    if (industryFilter !== 'all') count++;
    if (sourceFilter !== 'all') count++;
    if (hasSalary !== 'all') count++;
    return count;
  }, [companyFilter, remoteFilter, locationFilter, scoreRange, recommendationFilter, seniorityFilter, industryFilter, sourceFilter, hasSalary]);

  const clearAllFilters = () => {
    setCompanyFilter('all');
    setRemoteFilter('all');
    setLocationFilter('all');
    setScoreRange([0, 100]);
    setRecommendationFilter('all');
    setSeniorityFilter('all');
    setIndustryFilter('all');
    setSourceFilter('all');
    setHasSalary('all');
    setStatusFilter('all');
    setSearch('');
  };

  const addJob = async () => {
    if (!user || !newJob.title.trim() || !newJob.company.trim()) return;
    const { data, error } = await supabase.from('jobs').insert({
      user_id: user.id,
      title: newJob.title, company: newJob.company, location: newJob.location,
      remote_type: newJob.remote_type, description: newJob.description, apply_url: newJob.apply_url,
      salary_min: newJob.salary_min ? Number(newJob.salary_min) : null,
      salary_max: newJob.salary_max ? Number(newJob.salary_max) : null,
    }).select().single();
    if (data) {
      setJobs([data, ...jobs]);
      setAddOpen(false);
      setNewJob({ title: '', company: '', location: '', remote_type: 'unknown', description: '', apply_url: '', salary_min: '', salary_max: '' });
      toast({ title: 'Job added' });
    }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
  };

  const deleteJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    await supabase.from('jobs').delete().eq('id', jobId);
    setJobs(jobs.filter(j => j.id !== jobId));
    const newMatches = { ...matches };
    delete newMatches[jobId];
    setMatches(newMatches);
    toast({ title: 'Job deleted' });
  };

  const batchScore = async () => {
    if (!user) return;
    const unscored = jobs.filter(j => !matches[j.id]);
    if (unscored.length === 0) {
      toast({ title: 'All jobs scored', description: 'No unscored jobs remaining.' });
      return;
    }
    setBatchScoring(true);
    let scored = 0;
    for (const job of unscored.slice(0, 10)) {
      try {
        const { data } = await supabase.functions.invoke('score-job', { body: { job_id: job.id } });
        if (data && !data.error) {
          setMatches(prev => ({ ...prev, [job.id]: data }));
          scored++;
        }
      } catch { /* continue */ }
    }
    toast({ title: `Scored ${scored} jobs`, description: unscored.length > 10 ? `${unscored.length - 10} remaining.` : 'All done!' });
    setBatchScoring(false);
  };

  const filtered = jobs
    .filter(j => {
      const matchesSearch = j.title.toLowerCase().includes(search.toLowerCase()) || j.company.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
      const matchesCompany = companyFilter === 'all' || j.company === companyFilter;
      const matchesRemote = remoteFilter === 'all' || j.remote_type === remoteFilter;
      const matchesLocation = locationFilter === 'all' || j.location === locationFilter;
      const matchesSeniority = seniorityFilter === 'all' || j.seniority_level === seniorityFilter;
      const matchesIndustry = industryFilter === 'all' || j.industry === industryFilter;

      const match = matches[j.id];
      const score = match?.overall_score ?? -1;
      const matchesScore = score === -1 || (score >= scoreRange[0] && score <= scoreRange[1]);
      const matchesRec = recommendationFilter === 'all' || match?.recommendation === recommendationFilter;

      const rawData = j.raw_data as any;
      const isLI = rawData?.source === 'linkedin' || (j.source_url || j.apply_url || '').includes('linkedin.com');
      const matchesSource = sourceFilter === 'all' ||
        (sourceFilter === 'linkedin' && isLI) ||
        (sourceFilter === 'manual' && !isLI);

      const matchesSalary = hasSalary === 'all' ||
        (hasSalary === 'yes' && (j.salary_min || j.salary_max)) ||
        (hasSalary === 'no' && !j.salary_min && !j.salary_max);

      return matchesSearch && matchesStatus && matchesCompany && matchesRemote &&
        matchesLocation && matchesScore && matchesRec && matchesSeniority &&
        matchesIndustry && matchesSource && matchesSalary;
    })
    .sort((a, b) => {
      if (sortBy === 'score') {
        return (matches[b.id]?.overall_score ?? -1) - (matches[a.id]?.overall_score ?? -1);
      }
      if (sortBy === 'company') return a.company.localeCompare(b.company);
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const unscoredCount = jobs.filter(j => !matches[j.id]).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Job Feed"
        description="Track and score job opportunities"
        actions={
          <div className="flex gap-2">
            {unscoredCount > 0 && (
              <Button variant="outline" onClick={batchScore} disabled={batchScoring}>
                {batchScoring ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scoring...</> : <><Zap className="w-4 h-4 mr-2" />Score All ({unscoredCount})</>}
              </Button>
            )}
            <Button variant="outline" onClick={() => setBulkSearchOpen(true)}>
              <Search className="w-4 h-4 mr-2" />Bulk Search
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Globe className="w-4 h-4 mr-2" />Import URL
            </Button>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />Add Job</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Job Manually</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Title *</Label><Input value={newJob.title} onChange={e => setNewJob({ ...newJob, title: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Company *</Label><Input value={newJob.company} onChange={e => setNewJob({ ...newJob, company: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Location</Label><Input value={newJob.location} onChange={e => setNewJob({ ...newJob, location: e.target.value })} /></div>
                    <div className="space-y-2">
                      <Label>Remote Type</Label>
                      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={newJob.remote_type} onChange={e => setNewJob({ ...newJob, remote_type: e.target.value })}>
                        <option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option><option value="unknown">Unknown</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Min Salary</Label><Input type="number" value={newJob.salary_min} onChange={e => setNewJob({ ...newJob, salary_min: e.target.value })} placeholder="e.g. 80000" /></div>
                    <div className="space-y-2"><Label>Max Salary</Label><Input type="number" value={newJob.salary_max} onChange={e => setNewJob({ ...newJob, salary_max: e.target.value })} placeholder="e.g. 120000" /></div>
                  </div>
                  <div className="space-y-2"><Label>Apply URL</Label><Input value={newJob.apply_url} onChange={e => setNewJob({ ...newJob, apply_url: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Description</Label><Textarea value={newJob.description} onChange={e => setNewJob({ ...newJob, description: e.target.value })} rows={6} /></div>
                  <Button onClick={addJob} className="w-full">Add Job</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Search + Quick Filters */}
      <div className="flex gap-2 mb-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="score">Score ↓</SelectItem>
            <SelectItem value="company">Company A-Z</SelectItem>
            <SelectItem value="title">Title A-Z</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={filtersOpen || activeFilterCount > 0 ? "default" : "outline"}
          size="default"
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="gap-2"
        >
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px] rounded-full">
              {activeFilterCount}
            </Badge>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {/* Advanced Filters Panel */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <CollapsibleContent>
          <Card className="mb-4">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-foreground">Advanced Filters</p>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-xs h-7 gap-1">
                    <X className="w-3 h-3" /> Clear all
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Company */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Company</Label>
                  <Select value={companyFilter} onValueChange={setCompanyFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Companies</SelectItem>
                      {filterOptions.companies.map(c => (
                        <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Remote Type */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Work Type</Label>
                  <Select value={remoteFilter} onValueChange={setRemoteFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="remote">Remote</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                      <SelectItem value="onsite">On-site</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Location */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Location</Label>
                  <Select value={locationFilter} onValueChange={setLocationFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {filterOptions.locations.map(l => (
                        <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Recommendation */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Recommendation</Label>
                  <Select value={recommendationFilter} onValueChange={setRecommendationFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {filterOptions.recommendations.map(r => (
                        <SelectItem key={r} value={r} className="text-xs capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Seniority */}
                {filterOptions.seniorities.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Seniority</Label>
                    <Select value={seniorityFilter} onValueChange={setSeniorityFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Levels</SelectItem>
                        {filterOptions.seniorities.map(s => (
                          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Industry */}
                {filterOptions.industries.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Industry</Label>
                    <Select value={industryFilter} onValueChange={setIndustryFilter}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Industries</SelectItem>
                        {filterOptions.industries.map(i => (
                          <SelectItem key={i} value={i} className="text-xs">{i}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Source */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Source</Label>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="manual">Manual / Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Salary */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Salary Info</Label>
                  <Select value={hasSalary} onValueChange={setHasSalary}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any</SelectItem>
                      <SelectItem value="yes">Has Salary</SelectItem>
                      <SelectItem value="no">No Salary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Score Range */}
              <div className="mt-3 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Match Score Range: {scoreRange[0]} – {scoreRange[1]}</Label>
                <Slider
                  min={0} max={100} step={5}
                  value={scoreRange}
                  onValueChange={(v) => setScoreRange(v as [number, number])}
                  className="py-1"
                />
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Results count */}
      {!loading && (
        <p className="text-xs text-muted-foreground mb-3">
          {filtered.length} of {jobs.length} jobs
          {activeFilterCount > 0 && ` (${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active)`}
        </p>
      )}

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading jobs...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Rss}
          title={search || statusFilter !== 'all' || activeFilterCount > 0 ? 'No matching jobs' : 'No jobs tracked yet'}
          description={search || statusFilter !== 'all' || activeFilterCount > 0 ? 'Try different filters.' : 'Add jobs manually or configure sources in Settings.'}
          actionLabel={search || statusFilter !== 'all' || activeFilterCount > 0 ? 'Clear Filters' : 'Add Job'}
          onAction={search || statusFilter !== 'all' || activeFilterCount > 0 ? clearAllFilters : () => setAddOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(job => {
            const match = matches[job.id];
            const rawData = job.raw_data as any;
            const isLI = rawData?.source === 'linkedin' ||
              (job.source_url || job.apply_url || '').includes('linkedin.com');
            return (
              <Link key={job.id} to={`/jobs/${job.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
                  <CardContent className="py-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      {isLI ? <Linkedin className="w-5 h-5 text-[#0A66C2]" /> : <Building2 className="w-5 h-5 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground truncate">{job.title}</h3>
                        {isLI && (
                          <Badge variant="outline" className="text-[10px] shrink-0 border-sky-200 text-sky-700 dark:border-sky-800 dark:text-sky-300">
                            LinkedIn
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        {job.company}
                        {job.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>}
                        {isLI && <span className="text-xs text-sky-600 dark:text-sky-400">Manual submit</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.remote_type !== 'unknown' && <Badge variant="outline" className="text-xs capitalize">{job.remote_type}</Badge>}
                      {match && <ScoreBadge score={match.overall_score} />}
                      {match?.recommendation && (
                        <Badge variant={match.recommendation === 'apply' ? 'default' : match.recommendation === 'skip' ? 'destructive' : 'secondary'} className="text-xs capitalize">
                          {match.recommendation}
                        </Badge>
                      )}
                      <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 text-destructive" onClick={(e) => deleteJob(e, job.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <ImportJobDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onJobAdded={(job) => setJobs([job, ...jobs])}
      />
      <BulkSearchDialog
        open={bulkSearchOpen}
        onOpenChange={setBulkSearchOpen}
        onJobsAdded={(newJobs) => setJobs([...newJobs, ...jobs])}
      />
    </div>
  );
};

export default JobFeed;
