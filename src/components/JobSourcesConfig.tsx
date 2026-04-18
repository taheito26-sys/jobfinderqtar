import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { scrapeJobUrlWithReaderFallback } from '@/lib/api/firecrawl';
import {
  Plus, Trash2, Plug, Database, Pencil, Search, Globe, Rss, Bot, RefreshCw,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, Loader2, Zap,
  ExternalLink, Settings2, Play, LayoutGrid, List
} from 'lucide-react';

// ─── Preset job boards ───
const PRESET_SOURCES = [
  { name: 'Indeed Qatar', type: 'scraper', url: 'https://qa.indeed.com/jobs?l=Qatar', icon: '🔵', region: 'Qatar', description: 'Largest job board — Qatar edition' },
  { name: 'Bayt.com', type: 'scraper', url: 'https://www.bayt.com/en/qatar/jobs/search-jobs/', icon: '🟢', region: 'Gulf', description: 'Leading Middle East job platform' },
  { name: 'GulfTalent', type: 'scraper', url: 'https://www.gulftalent.com/qatar/jobs', icon: '🟠', region: 'Gulf', description: 'Premium Gulf recruitment site' },
  { name: 'Naukrigulf', type: 'scraper', url: 'https://www.naukrigulf.com/search-jobs-in-qatar', icon: '🔴', region: 'Gulf', description: 'Gulf job listings from Naukri' },
  { name: 'LinkedIn Jobs', type: 'scraper', url: 'https://www.linkedin.com/jobs/search/', icon: '🔷', region: 'Global', description: 'Professional network job listings' },
  { name: 'Tanqeeb', type: 'scraper', url: 'https://qatar.tanqeeb.com/en', icon: '🟣', region: 'Gulf', description: 'Gulf job aggregator' },
  { name: 'Qatar Living Jobs', type: 'scraper', url: 'https://www.qatarliving.com/jobs', icon: '🏠', region: 'Qatar', description: 'Qatar community job board' },
  { name: 'Akhtaboot', type: 'scraper', url: 'https://www.akhtaboot.com/en/qatar/jobs', icon: '🐙', region: 'MENA', description: 'MENA recruitment platform' },
  { name: 'Glassdoor', type: 'scraper', url: 'https://www.glassdoor.com/Job/qatar-jobs-SRCH_IL.0,5_IN199.htm', icon: '🚪', region: 'Global', description: 'Reviews + job listings' },
  { name: 'WeWorkRemotely', type: 'rss', url: 'https://weworkremotely.com/remote-jobs.rss', icon: '🌍', region: 'Remote', description: 'Remote-only job board' },
];

type SourceConfig = {
  base_url?: string;
  search_keywords?: string[];
  search_location?: string;
  scrape_frequency?: string;
  max_results_per_run?: number;
  auto_score?: boolean;
  last_error?: string;
  search_status?: 'idle' | 'queued' | 'searching' | 'success' | 'error';
  search_progress?: number;
  search_message?: string | null;
  search_error?: string | null;
  search_updated_at?: string;
  // LinkedIn Pipeline extras
  platform?: string;
  remote_preference?: string;
  posted_within?: string;
  page_limit?: number;
  results_per_page?: number;
  enable_continuous_discovery?: boolean;
  enable_auto_enrichment?: boolean;
  enable_auto_notify?: boolean;
};

type JobSource = {
  id: string;
  source_name: string;
  source_type: string;
  config: SourceConfig;
  jobs_brought_total?: number;
  enabled: boolean;
  supports_auto_submit: boolean;
  last_synced_at: string | null;
  created_at: string;
};

type ProfileContext = {
  desired_titles: string[];
  location: string | null;
  country: string | null;
};

const JobSourcesConfig = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sources, setSources] = useState<JobSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [editingSource, setEditingSource] = useState<JobSource | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(false);
  const [autoSearchFreq, setAutoSearchFreq] = useState('daily');
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [profileContext, setProfileContext] = useState<ProfileContext>({
    desired_titles: [],
    location: null,
    country: null,
  });
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  // New source form
  const [newSource, setNewSource] = useState({
    source_name: '',
    source_type: 'scraper',
    base_url: '',
    search_keywords: '',
    search_location: '',
    scrape_frequency: 'daily',
    max_results: '10',
    auto_score: true,
  });

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  useEffect(() => {
    if (syncing !== 'auto' || !user) return;

    const interval = window.setInterval(() => {
      void loadData();
    }, 2500);

    const timeout = window.setTimeout(() => {
      setSyncing(null);
    }, 120000);

    void loadData();

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [syncing, user]);

  const loadData = async () => {
    if (!user) return;
    const [srcRes, prefRes, jobsRes, profileRes] = await Promise.all([
      supabase.from('job_sources').select('*').eq('user_id', user.id).order('created_at'),
      supabase.from('user_preferences').select('*').eq('user_id', user.id),
      supabase.from('jobs').select('source_id').eq('user_id', user.id),
      supabase.from('profiles_v2').select('desired_titles, location, country').eq('user_id', user.id).maybeSingle(),
    ]);
    const jobsBySource = new Map<string, number>();
    (jobsRes.data ?? []).forEach((job: any) => {
      if (!job.source_id) return;
      jobsBySource.set(job.source_id, (jobsBySource.get(job.source_id) ?? 0) + 1);
    });

    setSources(((srcRes.data as JobSource[]) ?? []).map((source) => ({
      ...source,
      jobs_brought_total: jobsBySource.get(source.id) ?? 0,
    })));
    const prefMap: Record<string, string> = {};
    (prefRes.data ?? []).forEach((p: any) => { prefMap[p.key] = p.value; });
    setPrefs(prefMap);
    setAutoSearchEnabled(prefMap['auto_search_enabled'] === 'true');
    setAutoSearchFreq(prefMap['auto_search_frequency'] || 'daily');
    setProfileContext({
      desired_titles: (profileRes.data?.desired_titles as string[]) ?? [],
      location: profileRes.data?.location ?? null,
      country: profileRes.data?.country ?? null,
    });
    setLoading(false);
  };

  const setPref = async (key: string, value: string) => {
    if (!user) return;
    await supabase.from('user_preferences').upsert(
      { user_id: user.id, key, value },
      { onConflict: 'user_id,key' }
    );
    setPrefs(prev => ({ ...prev, [key]: value }));
  };

  const addSource = async () => {
    if (!user || !newSource.source_name.trim()) return;
    const config: SourceConfig = {
      base_url: newSource.base_url || undefined,
      search_keywords: newSource.search_keywords ? newSource.search_keywords.split(',').map(s => s.trim()).filter(Boolean) : [],
      search_location: newSource.search_location || undefined,
      scrape_frequency: newSource.scrape_frequency,
      max_results_per_run: parseInt(newSource.max_results) || 10,
      auto_score: newSource.auto_score,
    };

    const { data, error } = await supabase.from('job_sources').insert({
      user_id: user.id,
      source_name: newSource.source_name,
      source_type: newSource.source_type,
      config: config as any,
    }).select().single();

    if (data) {
      setSources([...sources, data as JobSource]);
      setAddModal(false);
      resetNewSource();
      toast({ title: 'Source added', description: `${newSource.source_name} is ready to use.` });
    }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
  };

  const addPreset = async (preset: typeof PRESET_SOURCES[0]) => {
    if (!user) return;
    const exists = sources.some(s => s.source_name.toLowerCase() === preset.name.toLowerCase());
    if (exists) {
      toast({ title: 'Already added', description: `${preset.name} is already in your sources.` });
      return;
    }

    const config: SourceConfig = {
      base_url: preset.url,
      search_keywords: [],
      scrape_frequency: 'daily',
      max_results_per_run: 10,
      auto_score: true,
    };

    const { data, error } = await supabase.from('job_sources').insert({
      user_id: user.id,
      source_name: preset.name,
      source_type: preset.type,
      config: config as any,
    }).select().single();

    if (data) {
      setSources([...sources, data as JobSource]);
      toast({ title: 'Source added', description: `${preset.name} is ready to configure.` });
    }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
  };

  const updateSource = async (source: JobSource) => {
    const { error } = await supabase.from('job_sources').update({
      source_name: source.source_name,
      source_type: source.source_type,
      config: source.config as any,
      enabled: source.enabled,
      supports_auto_submit: source.supports_auto_submit,
    }).eq('id', source.id);

    if (!error) {
      setSources(sources.map(s => s.id === source.id ? source : s));
      setEditingSource(null);
      toast({ title: 'Source updated' });
    } else {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const deleteSource = async (id: string) => {
    await supabase.from('job_sources').delete().eq('id', id);
    setSources(sources.filter(s => s.id !== id));
    toast({ title: 'Source removed' });
  };

  const toggleSource = async (id: string, enabled: boolean) => {
    await supabase.from('job_sources').update({ enabled }).eq('id', id);
    setSources(sources.map(s => s.id === id ? { ...s, enabled } : s));
  };

  const testSource = async (source: JobSource) => {
    setSyncing(source.id);
    try {
      const isLinkedIn = /linkedin/i.test(source.source_name) || /linkedin/i.test(source.config.base_url || '');
      const profileSeedTitles = (profileContext.desired_titles || []).map((title) => title.trim()).filter(Boolean);
      const fallbackSeed =
        (source.config.search_keywords ?? []).map((kw) => kw.trim()).filter(Boolean).join(' ')
        || source.source_name;
      const queryCountry = source.config.search_location || profileContext.country || profileContext.location || '';
      let data: any;
      let error: any;

      if (isLinkedIn) {
        const seeds = profileSeedTitles.length > 0 ? profileSeedTitles : [fallbackSeed];
        const allJobs: any[] = [];
        for (const seed of seeds) {
          const { data: seedData, error: seedError } = await supabase.functions.invoke('search-jobs', {
            body: {
              query: seed,
              country: queryCountry,
              limit: 3,
            },
          });
          if (seedError) {
            error = seedError;
            continue;
          }
          if (Array.isArray(seedData?.jobs)) {
            allJobs.push(...seedData.jobs);
          }
        }
        const seen = new Set<string>();
        const deduped = allJobs.filter((job) => {
          const key = `${String(job.apply_url || '').toLowerCase()}|${String(job.title || '').toLowerCase()}|${String(job.company || '').toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        data = { jobs: deduped };
        error = null;
      } else {
        const baseUrl = source.config.base_url || source.source_name;
        try {
          const result = await scrapeJobUrlWithReaderFallback(baseUrl);
          data = result;
          error = result.success ? null : new Error(result.message || result.error || 'Could not reach source');
        } catch (readerErr: any) {
          console.warn('Browser reader fallback failed:', readerErr);
          ({ data, error } = await supabase.functions.invoke('scrape-job-url', {
            body: {
              url: baseUrl,
            },
          }));
        }
      }

      if (error) throw error;

      const now = new Date().toISOString();
      const count = data?.results?.length ?? data?.jobs_found ?? data?.jobs?.length ?? (data?.job ? 1 : 0) ?? 0;
      const nextConfig = {
        ...(source.config || {}),
        last_error: null,
        search_status: 'success',
        search_progress: 100,
        search_message: `Found ${count} results from ${source.source_name}.`,
        search_error: null,
        search_updated_at: now,
      };
      await supabase
        .from('job_sources')
        .update({ last_synced_at: now, config: nextConfig as any })
        .eq('id', source.id);
      setSources(sources.map(s => s.id === source.id ? { ...s, last_synced_at: now, config: nextConfig } : s));

      toast({ title: 'Test successful', description: `Found ${count} results from ${source.source_name}.` });
    } catch (err: any) {
      const message = err?.message || 'Could not reach source';
      await supabase
        .from('job_sources')
        .update({
          config: {
            ...(source.config || {}),
            last_error: message,
            search_status: 'error',
            search_progress: 100,
            search_message: message,
            search_error: message,
            search_updated_at: new Date().toISOString(),
          } as any,
        })
        .eq('id', source.id);
      setSources(sources.map(s => s.id === source.id ? { ...s, config: { ...(s.config || {}), last_error: message, search_status: 'error', search_progress: 100, search_message: message, search_error: message, search_updated_at: new Date().toISOString() } } : s));
      toast({ title: 'Test failed', description: err.message || 'Could not reach source', variant: 'destructive' });
    }
    setSyncing(null);
  };

  const triggerAutoSearch = async () => {
    setSyncing('auto');
    try {
      void supabase.functions.invoke('auto-search-jobs', {
        body: { mode: 'manual', user_id: user.id },
      }).catch((err: any) => {
        console.error('Auto-search background request failed:', err);
      });
      toast({
        title: 'Auto-search queued',
        description: 'The scheduled sweep is active and this check is running in the background.',
      });
    } catch (err: any) {
      toast({ title: 'Auto-search failed', description: err.message, variant: 'destructive' });
    }
  };

  const resetNewSource = () => {
    setNewSource({
      source_name: '', source_type: 'scraper', base_url: '', search_keywords: '',
      search_location: '', scrape_frequency: 'daily', max_results: '10', auto_score: true,
    });
  };

  const enabledCount = sources.filter(s => s.enabled).length;
  const addedNames = new Set(sources.map(s => s.source_name.toLowerCase()));

  const getStatusIcon = (source: JobSource) => {
    if (!source.enabled) return <XCircle className="w-4 h-4 text-muted-foreground" />;
    if (source.last_synced_at) return <CheckCircle2 className="w-4 h-4 text-score-excellent" />;
    return <Clock className="w-4 h-4 text-warning" />;
  };

  const getFrequencyLabel = (freq?: string) => {
    switch (freq) {
      case 'hourly': return 'Every hour';
      case 'daily': return 'Once daily';
      case 'weekly': return 'Once weekly';
      case 'manual': return 'Manual only';
      default: return 'Daily';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'scraper': return <Globe className="w-4 h-4" />;
      case 'rss': return <Rss className="w-4 h-4" />;
      case 'api': return <Plug className="w-4 h-4" />;
      default: return <Database className="w-4 h-4" />;
    }
  };

  if (loading) return <div className="text-muted-foreground text-center py-8">Loading sources...</div>;

  return (
    <div className="space-y-6">
      {/* ─── Header Stats ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4" />
              Job Sources
            </CardTitle>
            <CardDescription>
              {sources.length} source{sources.length !== 1 ? 's' : ''} configured · {enabledCount} active
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
              {viewMode === 'grid' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </Button>
            <Button size="sm" onClick={() => setAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />Add Source
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* ─── Auto-Search Configuration ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Automated Job Discovery
          </CardTitle>
          <CardDescription>
            Automatically search for jobs matching your desired titles from your profile
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">Enable auto-search</p>
                <p className="text-xs text-muted-foreground">
                  Runs on a schedule using your profile's desired titles and location
                </p>
                <p className="text-xs text-amber-600">
                  Generic scraper sources need a real search or listing URL. A homepage alone often returns no jobs.
                </p>
              </div>
            <Switch
              checked={autoSearchEnabled}
              onCheckedChange={(v) => {
                setAutoSearchEnabled(v);
                setPref('auto_search_enabled', v.toString());
              }}
            />
          </div>

          {autoSearchEnabled && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Frequency</Label>
                  <Select value={autoSearchFreq} onValueChange={(v) => { setAutoSearchFreq(v); setPref('auto_search_frequency', v); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Every hour</SelectItem>
                      <SelectItem value="daily">Once daily</SelectItem>
                      <SelectItem value="weekly">Once weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max titles per run</Label>
                  <Select value={prefs['auto_search_max_titles'] || '3'} onValueChange={(v) => setPref('auto_search_max_titles', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 title</SelectItem>
                      <SelectItem value="3">3 titles</SelectItem>
                      <SelectItem value="5">5 titles</SelectItem>
                      <SelectItem value="10">All titles</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">Auto-score new jobs</p>
                  <p className="text-xs text-muted-foreground">Automatically run match scoring on discovered jobs</p>
                </div>
                <Switch
                  checked={prefs['auto_score_new'] === 'true'}
                  onCheckedChange={(v) => setPref('auto_score_new', v.toString())}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">Notify on new jobs</p>
                  <p className="text-xs text-muted-foreground">Send in-app notification when new jobs are found</p>
                </div>
                <Switch
                  checked={prefs['auto_notify_new'] !== 'false'}
                  onCheckedChange={(v) => setPref('auto_notify_new', v.toString())}
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={triggerAutoSearch}
                disabled={syncing === 'auto'}
                className="w-full"
              >
                {syncing === 'auto' ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running auto-search...</>
                ) : (
                  <><Play className="w-4 h-4 mr-2" />Run Auto-Search Now</>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Configured Sources ─── */}
      {sources.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Your Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sources.map(source => {
              const config = (source.config || {}) as SourceConfig;
              const isExpanded = expandedId === source.id;
              const runStatus = config.search_status || (source.last_synced_at ? 'success' : 'idle');
              const runProgress = typeof config.search_progress === 'number'
                ? config.search_progress
                : (runStatus === 'success' ? 100 : 0);
              const runMessage = config.search_message ||
                (runStatus === 'success'
                  ? `Last sync ${source.last_synced_at ? new Date(source.last_synced_at).toLocaleString() : 'completed'}`
                  : runStatus === 'searching'
                    ? 'Searching...'
                    : runStatus === 'error'
                      ? (config.search_error || config.last_error || 'Search failed')
                      : null);
              const runBadgeClass =
                runStatus === 'searching'
                  ? 'bg-blue-100 text-blue-700'
                  : runStatus === 'success'
                    ? 'bg-emerald-100 text-emerald-700'
                    : runStatus === 'error'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-muted text-muted-foreground';

              return (
                <Collapsible key={source.id} open={isExpanded} onOpenChange={() => setExpandedId(isExpanded ? null : source.id)}>
                  <div className={`rounded-lg border transition-colors ${source.enabled ? 'border-border' : 'border-border/50 opacity-60'}`}>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center gap-3 p-3">
                        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          {getTypeIcon(source.source_type)}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{source.source_name}</p>
                            {getStatusIcon(source)}
                            <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${runBadgeClass}`}>
                              {runStatus === 'searching' ? 'Searching' : runStatus === 'success' ? 'Done' : runStatus === 'error' ? 'Error' : 'Idle'}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                              Total jobs: {source.jobs_brought_total ?? 0}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-xs">{source.source_type}</Badge>
                            {config.scrape_frequency && (
                              <span className="text-xs text-muted-foreground">{getFrequencyLabel(config.scrape_frequency)}</span>
                            )}
                            {source.last_synced_at && (
                              <span className="text-xs text-muted-foreground">
                                Last sync: {new Date(source.last_synced_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <Switch
                            checked={source.enabled}
                            onCheckedChange={(v) => toggleSource(source.id, v)}
                          />
                        </div>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </div>
                      </CollapsibleTrigger>
  
                      <CollapsibleContent>
                        <div className="border-t border-border p-3 space-y-3 bg-muted/20">
                          {runStatus === 'searching' && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{runMessage}</span>
                                <span>{Math.max(0, Math.min(100, runProgress))}%</span>
                              </div>
                              <Progress value={Math.max(0, Math.min(100, runProgress))} className="h-2" />
                            </div>
                          )}

                          {runStatus !== 'searching' && runMessage && (
                            <p className="text-xs text-muted-foreground">{runMessage}</p>
                          )}

                          {/* Config details */}
                          <div className="grid grid-cols-2 gap-3">
                          {config.base_url && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Base URL</Label>
                              <div className="flex items-center gap-1">
                                <p className="text-sm text-foreground truncate">{config.base_url}</p>
                                <a href={config.base_url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                                </a>
                              </div>
                            </div>
                          )}
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Frequency</Label>
                            <p className="text-sm text-foreground">{getFrequencyLabel(config.scrape_frequency)}</p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Max results/run</Label>
                            <p className="text-sm text-foreground">{config.max_results_per_run ?? 10}</p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Auto-score</Label>
                            <p className="text-sm text-foreground">{config.auto_score !== false ? 'Yes' : 'No'}</p>
                          </div>
                        </div>

                        {(config.search_keywords ?? []).length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Keywords</Label>
                            <div className="flex flex-wrap gap-1">
                              {config.search_keywords!.map((kw, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {config.search_location && (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Location filter</Label>
                            <p className="text-sm text-foreground">{config.search_location}</p>
                          </div>
                        )}

                        {(config.last_error || config.search_error) && (
                          <div className="rounded bg-destructive/10 p-2">
                            <p className="text-xs text-destructive">{config.search_error || config.last_error}</p>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                          <Button variant="outline" size="sm" onClick={() => setEditingSource(source)}>
                            <Settings2 className="w-3 h-3 mr-1" />Configure
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testSource(source)}
                            disabled={syncing === source.id}
                          >
                            {syncing === source.id ? (
                              <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Testing...</>
                            ) : (
                              <><RefreshCw className="w-3 h-3 mr-1" />Test</>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive ml-auto"
                            onClick={() => deleteSource(source.id)}
                          >
                            <Trash2 className="w-3 h-3 mr-1" />Remove
                          </Button>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ─── Add Source Modal ─── */}
      <Dialog open={addModal} onOpenChange={setAddModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Job Source</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="presets">
            <TabsList className="w-full">
              <TabsTrigger value="presets" className="flex-1">Job Boards</TabsTrigger>
              <TabsTrigger value="custom" className="flex-1">Custom Source</TabsTrigger>
            </TabsList>

            <TabsContent value="presets" className="space-y-2 mt-4">
              <p className="text-xs text-muted-foreground mb-3">
                One-click add from popular job boards. You can configure keywords and frequency after adding.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {PRESET_SOURCES.map(preset => {
                  const alreadyAdded = addedNames.has(preset.name.toLowerCase());
                  return (
                    <div
                      key={preset.name}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        alreadyAdded ? 'border-border/50 opacity-50' : 'border-border hover:border-primary/30 cursor-pointer'
                      }`}
                      onClick={() => !alreadyAdded && addPreset(preset)}
                    >
                      <span className="text-xl">{preset.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{preset.name}</p>
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{preset.region}</Badge>
                        {alreadyAdded ? (
                          <Badge variant="secondary" className="text-xs">Added</Badge>
                        ) : (
                          <Plus className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="custom" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Source Name *</Label>
                <Input
                  value={newSource.source_name}
                  onChange={e => setNewSource({ ...newSource, source_name: e.target.value })}
                  placeholder="e.g. Company Careers RSS, Custom API"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Source Type</Label>
                  <Select value={newSource.source_type} onValueChange={v => setNewSource({ ...newSource, source_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scraper">Web Scraper</SelectItem>
                      <SelectItem value="rss">RSS Feed</SelectItem>
                      <SelectItem value="api">API</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select value={newSource.scrape_frequency} onValueChange={v => setNewSource({ ...newSource, scrape_frequency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="manual">Manual only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Base URL</Label>
                <Input
                  value={newSource.base_url}
                  onChange={e => setNewSource({ ...newSource, base_url: e.target.value })}
                  placeholder="https://example.com/jobs"
                />
              </div>

              <div className="space-y-2">
                <Label>Search Keywords</Label>
                <Input
                  value={newSource.search_keywords}
                  onChange={e => setNewSource({ ...newSource, search_keywords: e.target.value })}
                  placeholder="software engineer, project manager (comma-separated)"
                />
                <p className="text-xs text-muted-foreground">Used for automated searches on this source</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Location Filter</Label>
                  <Input
                    value={newSource.search_location}
                    onChange={e => setNewSource({ ...newSource, search_location: e.target.value })}
                    placeholder="e.g. Doha, Qatar"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max results/run</Label>
                  <Input
                    type="number"
                    value={newSource.max_results}
                    onChange={e => setNewSource({ ...newSource, max_results: e.target.value })}
                    placeholder="10"
                    min={1}
                    max={50}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Auto-score discovered jobs</p>
                  <p className="text-xs text-muted-foreground">Run match scoring on new jobs immediately</p>
                </div>
                <Switch
                  checked={newSource.auto_score}
                  onCheckedChange={v => setNewSource({ ...newSource, auto_score: v })}
                />
              </div>

              <Button onClick={addSource} className="w-full" disabled={!newSource.source_name.trim()}>
                <Plus className="w-4 h-4 mr-2" />Add Source
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Source Modal ─── */}
      <Dialog open={!!editingSource} onOpenChange={() => setEditingSource(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configure: {editingSource?.source_name}</DialogTitle>
          </DialogHeader>
          {editingSource && (
            <EditSourceForm
              source={editingSource}
              onSave={updateSource}
              onCancel={() => setEditingSource(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── Edit form sub-component ───
const EditSourceForm = ({
  source,
  onSave,
  onCancel,
}: {
  source: JobSource;
  onSave: (s: JobSource) => void;
  onCancel: () => void;
}) => {
  const config = (source.config || {}) as SourceConfig;
  const [name, setName] = useState(source.source_name);
  const [type, setType] = useState(source.source_type);
  const [baseUrl, setBaseUrl] = useState(config.base_url || '');
  const [keywords, setKeywords] = useState((config.search_keywords || []).join(', '));
  const [location, setLocation] = useState(config.search_location || '');
  const [frequency, setFrequency] = useState(config.scrape_frequency || 'daily');
  const [maxResults, setMaxResults] = useState(String(config.max_results_per_run || 10));
  const [autoScore, setAutoScore] = useState(config.auto_score !== false);
  const [autoSubmit, setAutoSubmit] = useState(source.supports_auto_submit);
  
  // LinkedIn specific
  const isLinkedIn = source.source_name.toLowerCase().includes('linkedin') || config.platform === 'linkedin';
  const [remotePref, setRemotePref] = useState(config.remote_preference || 'flexible');
  const [postedWithin, setPostedWithin] = useState(config.posted_within || 'any');
  const [pageLimit, setPageLimit] = useState(String(config.page_limit || 1));
  const [resultsPerPage, setResultsPerPage] = useState(String(config.results_per_page || 25));
  const [contDiscovery, setContDiscovery] = useState(config.enable_continuous_discovery !== false);
  const [autoEnrich, setAutoEnrich] = useState(config.enable_auto_enrichment !== false);
  const [autoNotify, setAutoNotify] = useState(config.enable_auto_notify !== false);

  const handleSave = () => {
    const updatedConfig: SourceConfig = {
      base_url: baseUrl || undefined,
      search_keywords: keywords ? keywords.split(',').map(s => s.trim()).filter(Boolean) : [],
      search_location: location || undefined,
      scrape_frequency: frequency,
      max_results_per_run: parseInt(maxResults) || 10,
      auto_score: autoScore,
      // LinkedIn specific
      ...(isLinkedIn ? {
        platform: 'linkedin',
        remote_preference: remotePref,
        posted_within: postedWithin,
        page_limit: parseInt(pageLimit) || 1,
        results_per_page: parseInt(resultsPerPage) || 25,
        enable_continuous_discovery: contDiscovery,
        enable_auto_enrichment: autoEnrich,
        enable_auto_notify: autoNotify,
      } : {})
    };

    onSave({
      ...source,
      source_name: name,
      source_type: type,
      config: updatedConfig,
      supports_auto_submit: autoSubmit,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Source Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="scraper">Web Scraper</SelectItem>
              <SelectItem value="rss">RSS Feed</SelectItem>
              <SelectItem value="api">API</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Base URL</Label>
        <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://..." />
      </div>

      <div className="space-y-2">
        <Label>Search Keywords</Label>
        <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Comma-separated keywords" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Location Filter</Label>
          <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Doha, Qatar" />
        </div>
        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="manual">Manual only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Max results per run</Label>
        <Input type="number" value={maxResults} onChange={e => setMaxResults(e.target.value)} min={1} max={50} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Auto-score</p>
          <p className="text-xs text-muted-foreground">Score discovered jobs automatically</p>
        </div>
        <Switch checked={autoScore} onCheckedChange={setAutoScore} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Supports auto-submit</p>
          <p className="text-xs text-muted-foreground">Enable controlled application submission for this source</p>
        </div>
        <Switch checked={autoSubmit} onCheckedChange={setAutoSubmit} />
      </div>

      {isLinkedIn && (
        <Collapsible className="border rounded-lg p-3 space-y-3 bg-primary/5">
          <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-medium">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Advanced LinkedIn Pipeline
            </div>
            <ChevronDown className="w-4 h-4" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3 border-t mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Remote Pref</Label>
                <Select value={remotePref} onValueChange={setRemotePref}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flexible">Flexible</SelectItem>
                    <SelectItem value="remote">Remote</SelectItem>
                    <SelectItem value="onsite">On-site</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Posted Within</Label>
                <Select value={postedWithin} onValueChange={setPostedWithin}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any time</SelectItem>
                    <SelectItem value="24h">Past 24h</SelectItem>
                    <SelectItem value="week">Past week</SelectItem>
                    <SelectItem value="month">Past month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Page Limit</Label>
                <Input type="number" value={pageLimit} onChange={e => setPageLimit(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Results per Page</Label>
                <Input type="number" value={resultsPerPage} onChange={e => setResultsPerPage(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Continuous Discovery</Label>
                <Switch checked={contDiscovery} onCheckedChange={setContDiscovery} className="scale-75" />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Auto Enrichment</Label>
                <Switch checked={autoEnrich} onCheckedChange={setAutoEnrich} className="scale-75" />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Auto Notify</Label>
                <Switch checked={autoNotify} onCheckedChange={setAutoNotify} className="scale-75" />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button onClick={handleSave} className="flex-1">Save Changes</Button>
      </div>
    </div>
  );
};

export default JobSourcesConfig;
