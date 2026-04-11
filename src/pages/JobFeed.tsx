import { useEffect, useState, useMemo, useCallback } from 'react';
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
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Rss, Plus, MapPin, Building2, Search, Loader2, Zap, Trash2, Globe, Linkedin,
  Filter, X, ChevronDown, Clock, DollarSign, Briefcase, Star, LayoutGrid, List,
  ArrowUpDown, BookmarkPlus, Eye, TrendingUp, Calendar, Hash, BarChart3,
  Plane, Archive, RotateCcw
} from 'lucide-react';
import { Link } from 'react-router-dom';
import ImportJobDialog from '@/components/ImportJobDialog';
import BulkSearchDialog from '@/components/BulkSearchDialog';
import { formatDistanceToNow } from 'date-fns';
import QuickApplyButton from '@/components/QuickApplyButton';
import StealthApplyPanel from '@/components/StealthApplyPanel';
import AutoApplyQueue from '@/components/AutoApplyQueue';

type ViewMode = 'list' | 'grid';
type SubTab = 'all' | 'remote' | 'onsite' | string; // string for country names

const JobFeed = () => {
  const { user } = useAuth();
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
  const [gccSearchQuery, setGccSearchQuery] = useState('');
  const [gccSearchCountry, setGccSearchCountry] = useState('');
  const [gccSearchRemoteOnly, setGccSearchRemoteOnly] = useState(true);
  const [gccSearching, setGccSearching] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [subTab, setSubTab] = useState<SubTab>('all');
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const emptyJob = { title: '', company: '', location: '', remote_type: 'unknown', description: '', apply_url: '', salary_min: '', salary_max: '' };
  const [multiJobs, setMultiJobs] = useState([{ ...emptyJob }]);
  const [addingJobs, setAddingJobs] = useState(false);

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
  const [dateFilter, setDateFilter] = useState('all');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('all');

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
  const GCC_LOCATION_PRESETS = [
    '🇶🇦 Qatar', '🇸🇦 Saudi Arabia', '🇦🇪 UAE', '🇦🇪 Dubai', '🇦🇪 Abu Dhabi',
    '🇸🇦 Riyadh', '🇸🇦 Jeddah', '🇶🇦 Doha', '🇰🇼 Kuwait', '🇧🇭 Bahrain', '🇴🇲 Oman',
  ];

  const filterOptions = useMemo(() => {
    const companies = [...new Set(jobs.map(j => j.company).filter(Boolean))].sort();
    const rawLocations = [...new Set(jobs.map(j => j.location).filter(Boolean))].sort();
    // Merge GCC presets with actual job locations, deduplicate by plain name
    const gccPlain = GCC_LOCATION_PRESETS.map(l => l.replace(/^.\s/, ''));
    const allLocations = [...GCC_LOCATION_PRESETS];
    rawLocations.forEach(l => {
      if (!gccPlain.some(g => l.toLowerCase().includes(g.toLowerCase()))) {
        allLocations.push(l);
      }
    });
    const seniorities = [...new Set(jobs.map(j => j.seniority_level).filter(Boolean))].sort();
    const industries = [...new Set(jobs.map(j => j.industry).filter(Boolean))].sort();
    const employmentTypes = [...new Set(jobs.map(j => j.employment_type).filter(Boolean))].sort();
    const recommendations = [...new Set(
      Object.values(matches).map((m: any) => m.recommendation).filter(Boolean)
    )].sort();
    return { companies, locations: allLocations, rawLocations, seniorities, industries, employmentTypes, recommendations };
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
    if (dateFilter !== 'all') count++;
    if (employmentTypeFilter !== 'all') count++;
    return count;
  }, [companyFilter, remoteFilter, locationFilter, scoreRange, recommendationFilter, seniorityFilter, industryFilter, sourceFilter, hasSalary, dateFilter, employmentTypeFilter]);

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
    setDateFilter('all');
    setEmploymentTypeFilter('all');
    setStatusFilter('all');
    setSearch('');
  };

  const updateMultiJob = (index: number, field: string, value: string) => {
    setMultiJobs(prev => prev.map((j, i) => i === index ? { ...j, [field]: value } : j));
  };

  const addJobRow = () => {
    setMultiJobs(prev => [...prev, { ...emptyJob }]);
  };

  const removeJobRow = (index: number) => {
    if (multiJobs.length <= 1) return;
    setMultiJobs(prev => prev.filter((_, i) => i !== index));
  };

  const addJobs = async () => {
    if (!user) return;
    const valid = multiJobs.filter(j => j.title.trim() && j.company.trim());
    if (valid.length === 0) return;
    setAddingJobs(true);
    const inserted: any[] = [];
    for (const newJob of valid) {
      const { data, error } = await supabase.from('jobs').insert({
        user_id: user.id,
        title: newJob.title, company: newJob.company, location: newJob.location,
        remote_type: newJob.remote_type, description: newJob.description, apply_url: newJob.apply_url,
        salary_min: newJob.salary_min ? Number(newJob.salary_min) : null,
        salary_max: newJob.salary_max ? Number(newJob.salary_max) : null,
      }).select().single();
      if (data) inserted.push(data);
      if (error) toast.error(error.message);
    }
    if (inserted.length > 0) {
      setJobs([...inserted, ...jobs]);
      setAddOpen(false);
      setMultiJobs([{ ...emptyJob }]);
      toast.success(`${inserted.length} job${inserted.length > 1 ? 's' : ''} added`);
    }
    setAddingJobs(false);
  };

  const deleteJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    await supabase.from('jobs').delete().eq('id', jobId);
    setJobs(jobs.filter(j => j.id !== jobId));
    const newMatches = { ...matches };
    delete newMatches[jobId];
    setMatches(newMatches);
    toast.success('Job deleted');
  };

  const archiveJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    await supabase.from('jobs').update({ status: 'archived' }).eq('id', jobId);
    setJobs(jobs.map(j => j.id === jobId ? { ...j, status: 'archived' } : j));
    toast.success('Job archived');
  };

  const unarchiveJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    await supabase.from('jobs').update({ status: 'active' }).eq('id', jobId);
    setJobs(jobs.map(j => j.id === jobId ? { ...j, status: 'active' } : j));
    toast.success('Job restored');
  };

  const bulkDelete = async () => {
    if (selectedJobs.size === 0) return;
    for (const jobId of selectedJobs) {
      await supabase.from('jobs').delete().eq('id', jobId);
    }
    setJobs(jobs.filter(j => !selectedJobs.has(j.id)));
    const newMatches = { ...matches };
    selectedJobs.forEach(id => delete newMatches[id]);
    setMatches(newMatches);
    toast.success(`${selectedJobs.size} jobs deleted`);
    setSelectedJobs(new Set());
  };

  const batchScore = async () => {
    if (!user) return;
    const unscored = jobs.filter(j => !matches[j.id]);
    if (unscored.length === 0) {
      toast('All jobs already scored');
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
    toast.success(`Scored ${scored} jobs`, { description: unscored.length > 10 ? `${unscored.length - 10} remaining.` : 'All done!' });
    setBatchScoring(false);
  };

  const GCC_COUNTRIES = [
    { code: 'Qatar', flag: '🇶🇦' },
    { code: 'Saudi Arabia', flag: '🇸🇦' },
    { code: 'UAE', flag: '🇦🇪' },
    { code: 'Kuwait', flag: '🇰🇼' },
    { code: 'Bahrain', flag: '🇧🇭' },
    { code: 'Oman', flag: '🇴🇲' },
  ];

  const searchGccJobs = async () => {
    if (!user || !gccSearchQuery.trim()) return;
    setGccSearching(true);
    try {
      const searchQuery = gccSearchRemoteOnly
        ? `${gccSearchQuery.trim()} remote`
        : gccSearchQuery.trim();
      const country = gccSearchCountry || undefined;
      const { data, error } = await supabase.functions.invoke('search-jobs', {
        body: { query: searchQuery, limit: 15, country },
      });
      if (error) {
        toast.error('Search failed: ' + error.message);
      } else if (data?.jobs?.length > 0) {
        const insertData = data.jobs.map((job: any) => ({
          user_id: user.id,
          title: job.title,
          company: job.company,
          location: job.location,
          remote_type: gccSearchRemoteOnly ? 'remote' : (job.remote_type || 'unknown'),
          description: job.description,
          salary_min: job.salary_min,
          salary_max: job.salary_max,
          salary_currency: job.salary_currency,
          employment_type: job.employment_type,
          seniority_level: job.seniority_level,
          requirements: job.requirements as any,
          apply_url: job.apply_url,
        }));
        const { data: inserted } = await supabase.from('jobs').insert(insertData).select();
        if (inserted) {
          setJobs(prev => [...inserted, ...prev]);
          toast.success(`Found & imported ${inserted.length} ${gccSearchRemoteOnly ? 'remote ' : ''}jobs${gccSearchCountry ? ` in ${gccSearchCountry}` : ' in GCC'}`);
        }
      } else {
        toast('No jobs found. Try a different query or country.');
      }
    } catch {
      toast.error('Search failed');
    }
    setGccSearching(false);
  };

  const toggleJobSelect = useCallback((e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const isWithinDateRange = (dateStr: string, range: string) => {
    if (range === 'all') return true;
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    switch (range) {
      case '24h': return days <= 1;
      case '7d': return days <= 7;
      case '30d': return days <= 30;
      default: return true;
    }
  };

  const filtered = useMemo(() => jobs
    .filter(j => {
      // Hide archived jobs unless explicitly viewing them
      if (statusFilter !== 'archived' && j.status === 'archived') return false;
      if (statusFilter === 'archived' && j.status !== 'archived') return false;
      const matchesSearch = !search || j.title.toLowerCase().includes(search.toLowerCase()) || j.company.toLowerCase().includes(search.toLowerCase()) || (j.location || '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || statusFilter === 'archived' || j.status === statusFilter;
      const matchesCompany = companyFilter === 'all' || j.company === companyFilter;
      const matchesRemote = remoteFilter === 'all' || j.remote_type === remoteFilter;
      const locPlain = locationFilter.replace(/^.\s/, '');
      const matchesLocation = locationFilter === 'all' || (j.location || '').toLowerCase().includes(locPlain.toLowerCase());
      const matchesSeniority = seniorityFilter === 'all' || j.seniority_level === seniorityFilter;
      const matchesIndustry = industryFilter === 'all' || j.industry === industryFilter;
      const matchesDate = isWithinDateRange(j.created_at, dateFilter);

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

      const matchesEmploymentType = employmentTypeFilter === 'all' || j.employment_type === employmentTypeFilter;

      return matchesSearch && matchesStatus && matchesCompany && matchesRemote &&
        matchesLocation && matchesScore && matchesRec && matchesSeniority &&
        matchesIndustry && matchesSource && matchesSalary && matchesDate && matchesEmploymentType;
    })
    .sort((a, b) => {
      if (sortBy === 'score') return (matches[b.id]?.overall_score ?? -1) - (matches[a.id]?.overall_score ?? -1);
      if (sortBy === 'company') return a.company.localeCompare(b.company);
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'salary') return (b.salary_max || b.salary_min || 0) - (a.salary_max || a.salary_min || 0);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }), [jobs, search, statusFilter, companyFilter, remoteFilter, locationFilter, scoreRange, recommendationFilter, seniorityFilter, industryFilter, sourceFilter, hasSalary, dateFilter, employmentTypeFilter, sortBy, matches]);

  // Stats
  const stats = useMemo(() => {
    const activeJobs = jobs.filter(j => j.status !== 'archived');
    const archivedCount = jobs.length - activeJobs.length;
    const scored = Object.keys(matches).length;
    const avgScore = scored > 0 ? Math.round(Object.values(matches).reduce((s: number, m: any) => s + (m.overall_score || 0), 0) / scored) : 0;
    const withSalary = activeJobs.filter(j => j.salary_min || j.salary_max).length;
    const applyRec = Object.values(matches).filter((m: any) => m.recommendation === 'apply').length;
    return { total: activeJobs.length, scored, avgScore, withSalary, applyRec, unscored: activeJobs.length - scored, archived: archivedCount };
  }, [jobs, matches]);

  // Sub-tab: extract countries from job locations
  const countryTabs = useMemo(() => {
    const countryMap = new Map<string, number>();
    let remoteCount = 0;
    let onsiteCount = 0;
    
    const knownCountries = ['Qatar', 'Saudi Arabia', 'UAE', 'Kuwait', 'Bahrain', 'Oman', 'United States', 'United Kingdom', 'India', 'Canada', 'Germany', 'Australia', 'Egypt', 'Jordan', 'Lebanon', 'Pakistan', 'Turkey', 'Singapore', 'Netherlands', 'France', 'Ireland'];
    
    for (const job of jobs) {
      if (job.remote_type === 'remote') remoteCount++;
      if (job.remote_type === 'onsite' || job.remote_type === 'hybrid') onsiteCount++;
      
      const loc = (job.location || '').toLowerCase();
      for (const country of knownCountries) {
        if (loc.includes(country.toLowerCase())) {
          countryMap.set(country, (countryMap.get(country) || 0) + 1);
          break;
        }
      }
      // Also check for common city→country mappings
      if (loc.includes('dubai') || loc.includes('abu dhabi')) countryMap.set('UAE', (countryMap.get('UAE') || 0) + 1);
      else if (loc.includes('doha')) countryMap.set('Qatar', (countryMap.get('Qatar') || 0) + 1);
      else if (loc.includes('riyadh') || loc.includes('jeddah')) countryMap.set('Saudi Arabia', (countryMap.get('Saudi Arabia') || 0) + 1);
    }
    
    const sorted = [...countryMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { countries: sorted, remoteCount, onsiteCount };
  }, [jobs]);

  // Apply sub-tab filter on top of existing filters
  const subTabFiltered = useMemo(() => {
    if (subTab === 'all') return filtered;
    if (subTab === 'remote') return filtered.filter(j => j.remote_type === 'remote');
    if (subTab === 'onsite') return filtered.filter(j => j.remote_type === 'onsite' || j.remote_type === 'hybrid');
    // Country sub-tab
    return filtered.filter(j => {
      const loc = (j.location || '').toLowerCase();
      const country = subTab.toLowerCase();
      if (loc.includes(country)) return true;
      if (subTab === 'UAE' && (loc.includes('dubai') || loc.includes('abu dhabi'))) return true;
      if (subTab === 'Qatar' && loc.includes('doha')) return true;
      if (subTab === 'Saudi Arabia' && (loc.includes('riyadh') || loc.includes('jeddah'))) return true;
      return false;
    });
  }, [filtered, subTab]);

  const formatSalary = (min?: number, max?: number, currency?: string) => {
    const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}K` : n.toString();
    const curr = currency || '';
    if (min && max) return `${curr}${fmt(min)}–${fmt(max)}`;
    if (min) return `${curr}${fmt(min)}+`;
    if (max) return `up to ${curr}${fmt(max)}`;
    return null;
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Job Feed"
        description={statusFilter === 'archived' ? `${stats.archived} archived jobs` : `${stats.total} jobs tracked • ${stats.scored} scored • ${stats.applyRec} recommended`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {stats.unscored > 0 && (
              <Button variant="outline" size="sm" onClick={batchScore} disabled={batchScoring}>
                {batchScoring ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Scoring...</> : <><Zap className="w-4 h-4 mr-1.5" />Score All ({stats.unscored})</>}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setBulkSearchOpen(true)}>
              <Search className="w-4 h-4 mr-1.5" />Search
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Globe className="w-4 h-4 mr-1.5" />Import
            </Button>
            {stats.archived > 0 && (
              <Button
                variant={statusFilter === 'archived' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(statusFilter === 'archived' ? 'all' : 'archived')}
              >
                <Archive className="w-4 h-4 mr-1.5" />Archive ({stats.archived})
              </Button>
            )}
            <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setMultiJobs([{ ...emptyJob }]); }}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 mr-1.5" />Add Job</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Add Jobs Manually</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  {multiJobs.map((job, idx) => (
                    <div key={idx} className="space-y-3 p-4 border border-border rounded-lg relative">
                      {multiJobs.length > 1 && (
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-muted-foreground">Job #{idx + 1}</span>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeJobRow(idx)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Title *</Label><Input value={job.title} onChange={e => updateMultiJob(idx, 'title', e.target.value)} placeholder="Software Engineer" /></div>
                        <div className="space-y-1"><Label className="text-xs">Company *</Label><Input value={job.company} onChange={e => updateMultiJob(idx, 'company', e.target.value)} placeholder="Acme Inc" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Location</Label><Input value={job.location} onChange={e => updateMultiJob(idx, 'location', e.target.value)} /></div>
                        <div className="space-y-1">
                          <Label className="text-xs">Remote Type</Label>
                          <Select value={job.remote_type} onValueChange={v => updateMultiJob(idx, 'remote_type', v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="remote">Remote</SelectItem>
                              <SelectItem value="hybrid">Hybrid</SelectItem>
                              <SelectItem value="onsite">On-site</SelectItem>
                              <SelectItem value="unknown">Unknown</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Min Salary</Label><Input type="number" value={job.salary_min} onChange={e => updateMultiJob(idx, 'salary_min', e.target.value)} placeholder="80000" /></div>
                        <div className="space-y-1"><Label className="text-xs">Max Salary</Label><Input type="number" value={job.salary_max} onChange={e => updateMultiJob(idx, 'salary_max', e.target.value)} placeholder="120000" /></div>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Apply URL</Label><Input value={job.apply_url} onChange={e => updateMultiJob(idx, 'apply_url', e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-xs">Description</Label><Textarea value={job.description} onChange={e => updateMultiJob(idx, 'description', e.target.value)} rows={3} /></div>
                    </div>
                  ))}
                  <Button variant="outline" onClick={addJobRow} className="w-full gap-1.5">
                    <Plus className="w-4 h-4" />Add Another Job
                  </Button>
                  <Separator />
                  <Button onClick={addJobs} className="w-full" disabled={addingJobs || multiJobs.every(j => !j.title.trim() || !j.company.trim())}>
                    {addingJobs ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Adding...</> : `Add ${multiJobs.filter(j => j.title.trim() && j.company.trim()).length} Job${multiJobs.filter(j => j.title.trim() && j.company.trim()).length !== 1 ? 's' : ''}`}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Stats Bar */}
      {!loading && jobs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <StatCard icon={Hash} label="Total Jobs" value={stats.total} />
          <StatCard icon={BarChart3} label="Scored" value={stats.scored} sub={stats.scored > 0 ? `avg ${stats.avgScore}` : undefined} />
          <StatCard icon={Star} label="Recommended" value={stats.applyRec} accent />
          <StatCard icon={DollarSign} label="With Salary" value={stats.withSalary} />
          <StatCard icon={Clock} label="Unscored" value={stats.unscored} />
        </div>
      )}

      {/* GCC Remote Jobs Search */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <Plane className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Search Remote Jobs in GCC Countries</h3>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {GCC_COUNTRIES.map(c => (
              <Button
                key={c.code}
                variant={gccSearchCountry === c.code ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-7 gap-1"
                onClick={() => setGccSearchCountry(gccSearchCountry === c.code ? '' : c.code)}
              >
                <span>{c.flag}</span>{c.code}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              placeholder='Job title e.g. "Software Engineer", "PM"...'
              value={gccSearchQuery}
              onChange={e => setGccSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchGccJobs()}
              className="flex-1 min-w-[200px]"
              disabled={gccSearching}
            />
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="gcc-remote"
                checked={gccSearchRemoteOnly}
                onCheckedChange={(v) => setGccSearchRemoteOnly(!!v)}
              />
              <label htmlFor="gcc-remote" className="text-xs text-muted-foreground cursor-pointer">Remote only</label>
            </div>
            <Button onClick={searchGccJobs} disabled={gccSearching || !gccSearchQuery.trim()} size="sm" className="gap-1.5">
              {gccSearching ? <><Loader2 className="w-4 h-4 animate-spin" />Searching...</> : <><Search className="w-4 h-4" />Search &amp; Import</>}
            </Button>
          </div>
          {gccSearchCountry && (
            <p className="text-xs text-muted-foreground mt-2">
              Searching {gccSearchRemoteOnly ? 'remote jobs' : 'all jobs'} in <span className="font-medium text-foreground">{gccSearchCountry}</span>
            </p>
          )}
          {!gccSearchCountry && (
            <p className="text-xs text-muted-foreground mt-2">Select a country above or search across all GCC regions</p>
          )}
        </CardContent>
      </Card>

      {/* Search + Controls */}
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by title, company, or location..." value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[150px]">
            <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" />
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="score">Score ↓</SelectItem>
            <SelectItem value="salary">Salary ↓</SelectItem>
            <SelectItem value="company">Company A-Z</SelectItem>
            <SelectItem value="title">Title A-Z</SelectItem>
          </SelectContent>
        </Select>

        {/* View toggle */}
        <div className="flex border rounded-md">
          <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" className="h-9 px-2.5 rounded-r-none" onClick={() => setViewMode('list')}>
            <List className="w-4 h-4" />
          </Button>
          <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="sm" className="h-9 px-2.5 rounded-l-none" onClick={() => setViewMode('grid')}>
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>

        <Button
          variant={filtersOpen || activeFilterCount > 0 ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="gap-1.5 h-9"
        >
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-5 w-5 p-0 flex items-center justify-center text-[10px] rounded-full">
              {activeFilterCount}
            </Badge>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {/* Quick filter chips */}
      {(activeFilterCount > 0 || statusFilter !== 'all') && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {statusFilter !== 'all' && <FilterChip label={`Status: ${statusFilter}`} onClear={() => setStatusFilter('all')} />}
          {companyFilter !== 'all' && <FilterChip label={`Company: ${companyFilter}`} onClear={() => setCompanyFilter('all')} />}
          {remoteFilter !== 'all' && <FilterChip label={`Type: ${remoteFilter}`} onClear={() => setRemoteFilter('all')} />}
          {locationFilter !== 'all' && <FilterChip label={`Location: ${locationFilter}`} onClear={() => setLocationFilter('all')} />}
          {recommendationFilter !== 'all' && <FilterChip label={`Rec: ${recommendationFilter}`} onClear={() => setRecommendationFilter('all')} />}
          {seniorityFilter !== 'all' && <FilterChip label={`Level: ${seniorityFilter}`} onClear={() => setSeniorityFilter('all')} />}
          {industryFilter !== 'all' && <FilterChip label={`Industry: ${industryFilter}`} onClear={() => setIndustryFilter('all')} />}
          {sourceFilter !== 'all' && <FilterChip label={`Source: ${sourceFilter}`} onClear={() => setSourceFilter('all')} />}
          {hasSalary !== 'all' && <FilterChip label={`Salary: ${hasSalary}`} onClear={() => setHasSalary('all')} />}
          {dateFilter !== 'all' && <FilterChip label={`Date: ${dateFilter}`} onClear={() => setDateFilter('all')} />}
          {employmentTypeFilter !== 'all' && <FilterChip label={`Employment: ${employmentTypeFilter}`} onClear={() => setEmploymentTypeFilter('all')} />}
          {(scoreRange[0] > 0 || scoreRange[1] < 100) && <FilterChip label={`Score: ${scoreRange[0]}–${scoreRange[1]}`} onClear={() => setScoreRange([0, 100])} />}
          {activeFilterCount > 1 && (
            <button onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-foreground underline ml-1">Clear all</button>
          )}
        </div>
      )}

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
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                  { value: 'expired', label: 'Expired' },
                ]} />
                <FilterSelect label="Company" value={companyFilter} onChange={setCompanyFilter} options={[
                  { value: 'all', label: 'All Companies' },
                  ...filterOptions.companies.map(c => ({ value: c, label: c })),
                ]} />
                <FilterSelect label="Work Type" value={remoteFilter} onChange={setRemoteFilter} options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'remote', label: 'Remote' },
                  { value: 'hybrid', label: 'Hybrid' },
                  { value: 'onsite', label: 'On-site' },
                ]} />
                <FilterSelect label="Location" value={locationFilter} onChange={setLocationFilter} options={[
                  { value: 'all', label: 'All Locations' },
                  ...filterOptions.locations.map(l => ({ value: l, label: l })),
                ]} />
                <FilterSelect label="Recommendation" value={recommendationFilter} onChange={setRecommendationFilter} options={[
                  { value: 'all', label: 'All' },
                  ...filterOptions.recommendations.map(r => ({ value: r, label: r })),
                ]} />
                {filterOptions.seniorities.length > 0 && (
                  <FilterSelect label="Seniority" value={seniorityFilter} onChange={setSeniorityFilter} options={[
                    { value: 'all', label: 'All Levels' },
                    ...filterOptions.seniorities.map(s => ({ value: s, label: s })),
                  ]} />
                )}
                {filterOptions.industries.length > 0 && (
                  <FilterSelect label="Industry" value={industryFilter} onChange={setIndustryFilter} options={[
                    { value: 'all', label: 'All Industries' },
                    ...filterOptions.industries.map(i => ({ value: i, label: i })),
                  ]} />
                )}
                <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={[
                  { value: 'all', label: 'All Sources' },
                  { value: 'linkedin', label: 'LinkedIn' },
                  { value: 'manual', label: 'Manual / Other' },
                ]} />
                <FilterSelect label="Salary Info" value={hasSalary} onChange={setHasSalary} options={[
                  { value: 'all', label: 'Any' },
                  { value: 'yes', label: 'Has Salary' },
                  { value: 'no', label: 'No Salary' },
                ]} />
                <FilterSelect label="Date Added" value={dateFilter} onChange={setDateFilter} options={[
                  { value: 'all', label: 'Any Time' },
                  { value: '24h', label: 'Last 24 Hours' },
                  { value: '7d', label: 'Last 7 Days' },
                  { value: '30d', label: 'Last 30 Days' },
                ]} />
                <FilterSelect label="Employment" value={employmentTypeFilter} onChange={setEmploymentTypeFilter} options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'full-time', label: 'Full-time' },
                  { value: 'part-time', label: 'Part-time' },
                  { value: 'contract', label: 'Contract' },
                  { value: 'freelance', label: 'Freelance' },
                  { value: 'internship', label: 'Internship' },
                  ...filterOptions.employmentTypes.filter(t => !['full-time','part-time','contract','freelance','internship'].includes(t)).map(t => ({ value: t, label: t })),
                ]} />
              </div>
              <div className="mt-3 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Match Score Range: {scoreRange[0]} – {scoreRange[1]}</Label>
                <Slider min={0} max={100} step={5} value={scoreRange} onValueChange={(v) => setScoreRange(v as [number, number])} className="py-1" />
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Sub-tabs: All / Remote / On-site / Countries */}
      {!loading && jobs.length > 0 && (
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSubTab('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              subTab === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({filtered.length})
          </button>
          {countryTabs.remoteCount > 0 && (
            <button
              onClick={() => setSubTab('remote')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1 ${
                subTab === 'remote' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe className="w-3 h-3" /> Remote ({countryTabs.remoteCount})
            </button>
          )}
          {countryTabs.onsiteCount > 0 && (
            <button
              onClick={() => setSubTab('onsite')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1 ${
                subTab === 'onsite' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <Building2 className="w-3 h-3" /> On-site ({countryTabs.onsiteCount})
            </button>
          )}
          {countryTabs.countries.length > 0 && (
            <Separator orientation="vertical" className="h-5 mx-1" />
          )}
          {countryTabs.countries.map(([country, count]) => {
            const flags: Record<string, string> = { 'Qatar': '🇶🇦', 'Saudi Arabia': '🇸🇦', 'UAE': '🇦🇪', 'Kuwait': '🇰🇼', 'Bahrain': '🇧🇭', 'Oman': '🇴🇲', 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'India': '🇮🇳', 'Canada': '🇨🇦', 'Germany': '🇩🇪', 'Australia': '🇦🇺', 'Egypt': '🇪🇬', 'Jordan': '🇯🇴', 'Lebanon': '🇱🇧', 'Pakistan': '🇵🇰', 'Turkey': '🇹🇷', 'Singapore': '🇸🇬', 'Netherlands': '🇳🇱', 'France': '🇫🇷', 'Ireland': '🇮🇪' };
            return (
              <button
                key={country}
                onClick={() => setSubTab(subTab === country ? 'all' : country)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1 ${
                  subTab === country ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{flags[country] || '🌍'}</span> {country} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Results bar */}
      {!loading && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">
            {subTabFiltered.length} of {jobs.length} jobs
            {subTab !== 'all' && ` • ${subTab === 'remote' ? 'Remote' : subTab === 'onsite' ? 'On-site/Hybrid' : subTab}`}
            {activeFilterCount > 0 && ` • ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active`}
          </p>
          {selectedJobs.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selectedJobs.size} selected</span>
              <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={bulkDelete}>
                <Trash2 className="w-3 h-3 mr-1" />Delete Selected
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedJobs(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Stealth Apply & Auto-Apply Queue */}
      {!loading && user && jobs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <StealthApplyPanel
            jobs={jobs}
            matches={matches}
            userId={user.id}
            onDraftsCreated={() => toast.success('Stealth drafts ready — check Applications')}
          />
          <AutoApplyQueue
            jobs={jobs}
            matches={matches}
            userId={user.id}
            selectedJobs={selectedJobs}
            onComplete={() => { setSelectedJobs(new Set()); }}
          />
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading jobs...</p>
        </div>
      ) : subTabFiltered.length === 0 ? (
        <EmptyState
          icon={Rss}
          title={search || activeFilterCount > 0 || subTab !== 'all' ? 'No matching jobs' : 'No jobs tracked yet'}
          description={search || activeFilterCount > 0 || subTab !== 'all' ? 'Try different filters, tabs, or search terms.' : 'Add jobs manually, import from URL, or run a bulk search.'}
          actionLabel={search || activeFilterCount > 0 || subTab !== 'all' ? 'Clear Filters' : 'Add Job'}
          onAction={search || activeFilterCount > 0 ? clearAllFilters : subTab !== 'all' ? () => setSubTab('all') : () => setAddOpen(true)}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {subTabFiltered.map(job => (
            <JobCardGrid
              key={job.id}
              job={job}
              match={matches[job.id]}
              selected={selectedJobs.has(job.id)}
              onSelect={toggleJobSelect}
              onDelete={deleteJob}
              onArchive={archiveJob}
              onUnarchive={unarchiveJob}
              isArchiveView={statusFilter === 'archived'}
              formatSalary={formatSalary}
              userId={user?.id}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {subTabFiltered.map(job => (
            <JobCardList
              key={job.id}
              job={job}
              match={matches[job.id]}
              selected={selectedJobs.has(job.id)}
              onSelect={toggleJobSelect}
              onDelete={deleteJob}
              onArchive={archiveJob}
              onUnarchive={unarchiveJob}
              isArchiveView={statusFilter === 'archived'}
              formatSalary={formatSalary}
              userId={user?.id}
            />
          ))}
        </div>
      )}

      <ImportJobDialog open={importOpen} onOpenChange={setImportOpen} onJobAdded={(job) => setJobs([job, ...jobs])} />
      <BulkSearchDialog open={bulkSearchOpen} onOpenChange={setBulkSearchOpen} onJobsAdded={(newJobs) => setJobs([...newJobs, ...jobs])} />
    </div>
  );
};

/* ── Subcomponents ── */

const StatCard = ({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: number; sub?: string; accent?: boolean }) => (
  <Card className="overflow-hidden">
    <CardContent className="py-3 px-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground leading-tight">{label}{sub && <span className="ml-1 text-foreground/60">({sub})</span>}</p>
      </div>
    </CardContent>
  </Card>
);

const FilterChip = ({ label, onClear }: { label: string; onClear: () => void }) => (
  <Badge variant="secondary" className="gap-1 text-xs pr-1 capitalize">
    {label}
    <button onClick={onClear} className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20">
      <X className="w-2.5 h-2.5" />
    </button>
  </Badge>
);

const FilterSelect = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
  <div className="space-y-1">
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value} className="text-xs capitalize">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

function getJobSource(job: any) {
  const rawData = job.raw_data as any;
  return rawData?.source === 'linkedin' || (job.source_url || job.apply_url || '').includes('linkedin.com');
}

const JobCardList = ({ job, match, selected, onSelect, onDelete, formatSalary, userId }: any) => {
  const isLI = getJobSource(job);
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  const timeAgo = formatDistanceToNow(new Date(job.created_at), { addSuffix: true });

  return (
    <Link to={`/jobs/${job.id}`}>
      <Card className={`hover:border-primary/30 transition-colors cursor-pointer group ${selected ? 'border-primary bg-primary/5' : ''}`}>
        <CardContent className="py-3.5 px-4 flex items-center gap-3">
          {/* Select checkbox */}
          <div className="flex-shrink-0" onClick={e => onSelect(e, job.id)}>
            <Checkbox checked={selected} className="pointer-events-none" />
          </div>

          {/* Icon */}
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            {isLI ? <Linkedin className="w-5 h-5 text-[#0A66C2]" /> : <Building2 className="w-5 h-5 text-muted-foreground" />}
          </div>

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-foreground truncate text-sm">{job.title}</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
              <span className="font-medium text-foreground/80">{job.company}</span>
              {job.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{job.location}</span>}
              {salary && <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><DollarSign className="w-3 h-3" />{salary}</span>}
              <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{timeAgo}</span>
            </div>
          </div>

          {/* Tags + Score */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {job.remote_type && job.remote_type !== 'unknown' && (
              <Badge variant="outline" className="text-[10px] capitalize h-5">{job.remote_type}</Badge>
            )}
            {job.seniority_level && (
              <Badge variant="outline" className="text-[10px] capitalize h-5">{job.seniority_level}</Badge>
            )}
            {isLI && (
              <Badge variant="outline" className="text-[10px] border-sky-200 text-sky-700 dark:border-sky-800 dark:text-sky-300 h-5">LI</Badge>
            )}
            {match && <ScoreBadge score={match.overall_score} />}
            {match?.recommendation && (
              <Badge variant={match.recommendation === 'apply' ? 'default' : match.recommendation === 'skip' ? 'destructive' : 'secondary'} className="text-[10px] capitalize h-5">
                {match.recommendation}
              </Badge>
            )}
            {userId && !isArchiveView && (
              <QuickApplyButton job={job} userId={userId} size="sm" className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0" />
            )}
            {isArchiveView ? (
              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0" onClick={(e) => onUnarchive(e, job.id)} title="Restore">
                <RotateCcw className="w-3 h-3" />
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 text-muted-foreground h-7 w-7 p-0" onClick={(e) => onArchive(e, job.id)} title="Archive">
                <Archive className="w-3 h-3" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 text-destructive h-7 w-7 p-0" onClick={(e) => onDelete(e, job.id)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

const JobCardGrid = ({ job, match, selected, onSelect, onDelete, formatSalary, userId }: any) => {
  const isLI = getJobSource(job);
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  const timeAgo = formatDistanceToNow(new Date(job.created_at), { addSuffix: true });

  return (
    <Link to={`/jobs/${job.id}`}>
      <Card className={`hover:border-primary/30 transition-colors cursor-pointer group h-full ${selected ? 'border-primary bg-primary/5' : ''}`}>
        <CardContent className="p-4 flex flex-col gap-3 h-full">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                {isLI ? <Linkedin className="w-4 h-4 text-[#0A66C2]" /> : <Building2 className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{job.company}</p>
                {job.location && <p className="text-[10px] text-muted-foreground/70 flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{job.location}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div onClick={e => onSelect(e, job.id)}><Checkbox checked={selected} className="pointer-events-none" /></div>
              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 text-destructive h-6 w-6 p-0" onClick={(e) => onDelete(e, job.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="flex-1">
            <h3 className="font-medium text-foreground text-sm leading-snug line-clamp-2">{job.title}</h3>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap gap-1">
            {job.remote_type && job.remote_type !== 'unknown' && (
              <Badge variant="outline" className="text-[10px] capitalize h-5">{job.remote_type}</Badge>
            )}
            {job.seniority_level && <Badge variant="outline" className="text-[10px] capitalize h-5">{job.seniority_level}</Badge>}
            {salary && <Badge variant="outline" className="text-[10px] h-5 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">{salary}</Badge>}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
            <div className="flex items-center gap-1.5">
              {userId && <QuickApplyButton job={job} userId={userId} size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100" />}
              {match && <ScoreBadge score={match.overall_score} />}
              {match?.recommendation && (
                <Badge variant={match.recommendation === 'apply' ? 'default' : match.recommendation === 'skip' ? 'destructive' : 'secondary'} className="text-[10px] capitalize h-5">
                  {match.recommendation}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

export default JobFeed;
