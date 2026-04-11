import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, RefreshCw, Building2, Globe, Linkedin, Search, Loader2, Clock, Rss, ChevronDown, ChevronRight, ExternalLink, Briefcase, Archive, X } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { Link } from 'react-router-dom';

type SubscriptionType = 'company' | 'careers_url' | 'linkedin_company' | 'linkedin_profile' | 'keyword_alert';

interface Subscription {
  id: string;
  subscription_type: SubscriptionType;
  name: string;
  url: string;
  search_query: string;
  country: string;
  check_interval_hours: number;
  last_checked_at: string | null;
  jobs_found_total: number;
  enabled: boolean;
  created_at: string;
}

interface SubJob {
  id: string;
  title: string;
  company: string;
  location: string;
  remote_type: string;
  employment_type: string;
  status: string;
  apply_url: string;
  created_at: string;
}

const TYPE_CONFIG: Record<SubscriptionType, { label: string; icon: React.ReactNode; description: string; needsUrl: boolean; needsQuery: boolean }> = {
  company: { label: 'Company', icon: <Building2 className="w-4 h-4" />, description: 'Search for jobs by company name', needsUrl: false, needsQuery: false },
  careers_url: { label: 'Careers Page', icon: <Globe className="w-4 h-4" />, description: 'Monitor a website/careers page for new listings', needsUrl: true, needsQuery: false },
  linkedin_company: { label: 'LinkedIn Company', icon: <Linkedin className="w-4 h-4" />, description: 'Track a company\'s LinkedIn job postings', needsUrl: false, needsQuery: false },
  linkedin_profile: { label: 'LinkedIn Profile', icon: <Linkedin className="w-4 h-4" />, description: 'Track jobs posted by a recruiter/person', needsUrl: false, needsQuery: false },
  keyword_alert: { label: 'Keyword Alert', icon: <Search className="w-4 h-4" />, description: 'Get alerts when jobs match your keywords', needsUrl: false, needsQuery: true },
};

const COUNTRIES = [
  '', 'Qatar', 'UAE', 'Saudi Arabia', 'Bahrain', 'Kuwait', 'Oman', 'Egypt',
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Netherlands', 'Singapore', 'India', 'Remote',
];

const SubscriptionJobs = ({ subscriptionId, userId }: { subscriptionId: string; userId: string }) => {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<SubJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    const fetchJobs = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('jobs')
        .select('id, title, company, location, remote_type, employment_type, status, apply_url, created_at')
        .eq('user_id', userId)
        .contains('raw_data', { subscription_id: subscriptionId } as any)
        .order('created_at', { ascending: false });
      setJobs((data as SubJob[]) || []);
      setLoading(false);
    };
    fetchJobs();
  }, [subscriptionId, userId]);

  const handleArchive = async (jobId: string) => {
    await supabase.from('jobs').update({ status: 'archived' } as any).eq('id', jobId);
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'archived' } : j));
    toast({ title: 'Job archived' });
  };

  const filteredJobs = jobs.filter(j => {
    if (statusFilter !== 'all' && j.status !== statusFilter) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      return j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || (j.location || '').toLowerCase().includes(q);
    }
    return true;
  });

  const activeCount = jobs.filter(j => j.status === 'active').length;
  const archivedCount = jobs.filter(j => j.status === 'archived').length;

  if (loading) {
    return (
      <div className="py-4 text-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
        Loading jobs...
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="py-4 text-center text-muted-foreground text-sm">
        No jobs imported yet from this subscription.
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-3 border-t border-border mt-3">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            placeholder="Filter by title, company, location..."
            className="h-8 text-xs pl-8"
          />
          {searchFilter && (
            <button onClick={() => setSearchFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setStatusFilter('all')}
          >
            All ({jobs.length})
          </Button>
          <Button
            variant={statusFilter === 'active' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setStatusFilter('active')}
          >
            Active ({activeCount})
          </Button>
          <Button
            variant={statusFilter === 'archived' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setStatusFilter('archived')}
          >
            Archived ({archivedCount})
          </Button>
        </div>
      </div>

      {/* Jobs list */}
      <ScrollArea className="h-[300px]">
        <div className="space-y-1 pr-3">
          {filteredJobs.length === 0 ? (
            <div className="py-4 text-center text-muted-foreground text-xs">
              No jobs match your filter.
            </div>
          ) : (
            filteredJobs.map(job => (
              <div
                key={job.id}
                className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors hover:bg-muted/50 ${
                  job.status === 'archived' ? 'opacity-50' : ''
                }`}
              >
                <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <Link to={`/jobs/${job.id}`} className="text-sm font-medium hover:underline truncate block">
                    {job.title}
                  </Link>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{job.company}</span>
                    {job.location && <span>• {job.location}</span>}
                    {job.remote_type && job.remote_type !== 'unknown' && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1">{job.remote_type}</Badge>
                    )}
                    <span>• {format(new Date(job.created_at), 'MMM d, yyyy')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {job.status === 'archived' ? (
                    <Badge variant="secondary" className="text-[9px] h-5">Archived</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Archive job"
                      onClick={() => handleArchive(job.id)}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {job.apply_url && (
                    <a href={job.apply_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Open job link">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

const JobSubscriptions = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  // Form state
  const [formType, setFormType] = useState<SubscriptionType>('company');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formQuery, setFormQuery] = useState('');
  const [formCountry, setFormCountry] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSubscriptions = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('job_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setSubscriptions((data as any as Subscription[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchSubscriptions(); }, [fetchSubscriptions]);

  const handleAdd = async () => {
    if (!user || !formName.trim()) return;
    setSaving(true);

    const { error } = await supabase.from('job_subscriptions').insert({
      user_id: user.id,
      subscription_type: formType,
      name: formName.trim(),
      url: formUrl.trim(),
      search_query: formQuery.trim(),
      country: formCountry,
    } as any);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Subscription added!' });
      setShowAdd(false);
      resetForm();
      fetchSubscriptions();
    }
    setSaving(false);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await supabase.from('job_subscriptions').update({ enabled } as any).eq('id', id);
    setSubscriptions(prev => prev.map(s => s.id === id ? { ...s, enabled } : s));
  };

  const handleDelete = async (id: string) => {
    await supabase.from('job_subscriptions').delete().eq('id', id);
    setSubscriptions(prev => prev.filter(s => s.id !== id));
    toast({ title: 'Subscription removed' });
  };

  const handleCheckNow = async (id?: string) => {
    if (id) setChecking(id); else setCheckingAll(true);

    const { data, error } = await supabase.functions.invoke('check-subscriptions', {
      body: id ? { subscription_id: id } : {},
    });

    if (error) {
      toast({ title: 'Check failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Found ${data?.new_jobs || 0} new jobs` });
      fetchSubscriptions();
    }

    setChecking(null);
    setCheckingAll(false);
  };

  const resetForm = () => {
    setFormType('company');
    setFormName('');
    setFormUrl('');
    setFormQuery('');
    setFormCountry('');
  };

  const typeConfig = TYPE_CONFIG[formType];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Rss className="w-5 h-5" />
            Job Subscriptions
          </h3>
          <p className="text-sm text-muted-foreground">
            Subscribe to companies, careers pages, and keyword alerts. Checked every 6 hours.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleCheckNow()} disabled={checkingAll || subscriptions.length === 0}>
            {checkingAll ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Check All Now
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading...
        </div>
      ) : subscriptions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Rss className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No subscriptions yet. Add a company, careers page, or keyword alert to start.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {subscriptions.map(sub => {
            const config = TYPE_CONFIG[sub.subscription_type];
            const isChecking = checking === sub.id;
            const isExpanded = expandedSub === sub.id;
            return (
              <Card key={sub.id} className={`transition-opacity ${!sub.enabled ? 'opacity-50' : ''}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => setExpandedSub(isExpanded ? null : sub.id)}
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm truncate">{sub.name}</h4>
                          <Badge variant="outline" className="text-[10px] shrink-0">{config.label}</Badge>
                          {sub.country && <Badge variant="secondary" className="text-[10px] shrink-0">{sub.country}</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          {sub.url && <span className="truncate max-w-[200px]">{sub.url}</span>}
                          {sub.search_query && <span>Keywords: {sub.search_query}</span>}
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {sub.last_checked_at
                              ? formatDistanceToNow(new Date(sub.last_checked_at), { addSuffix: true })
                              : 'Never checked'}
                          </span>
                          <button
                            onClick={() => setExpandedSub(isExpanded ? null : sub.id)}
                            className="font-medium text-primary hover:underline"
                          >
                            {sub.jobs_found_total} jobs found
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCheckNow(sub.id)} disabled={isChecking}>
                        {isChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </Button>
                      <Switch checked={sub.enabled} onCheckedChange={v => handleToggle(sub.id, v)} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove subscription?</AlertDialogTitle>
                            <AlertDialogDescription>This won't delete any jobs already imported.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(sub.id)}>Remove</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  {isExpanded && user && (
                    <SubscriptionJobs subscriptionId={sub.id} userId={user.id} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Subscription Dialog */}
      <Dialog open={showAdd} onOpenChange={v => { setShowAdd(v); if (!v) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Subscription</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Subscription Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(TYPE_CONFIG) as [SubscriptionType, typeof TYPE_CONFIG[SubscriptionType]][]).map(([key, cfg]) => (
                  <button key={key}
                    onClick={() => setFormType(key)}
                    className={`flex items-center gap-2 p-3 rounded-lg border text-left text-sm transition-colors ${
                      formType === key ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                    }`}>
                    {cfg.icon}
                    <div>
                      <p className="font-medium">{cfg.label}</p>
                      <p className="text-[10px] text-muted-foreground">{cfg.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{formType === 'keyword_alert' ? 'Alert Name' : 'Company / Source Name'}</Label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder={formType === 'keyword_alert' ? 'e.g. React Jobs Egypt' : 'e.g. Vistas Global'}
              />
            </div>

            {typeConfig.needsUrl && (
              <div className="space-y-2">
                <Label>URL</Label>
                <Input
                  value={formUrl}
                  onChange={e => setFormUrl(e.target.value)}
                  placeholder="https://vistasglobal.com/careers/"
                />
              </div>
            )}

            {(formType === 'linkedin_company' || formType === 'linkedin_profile') && (
              <div className="space-y-2">
                <Label>LinkedIn URL (optional)</Label>
                <Input
                  value={formUrl}
                  onChange={e => setFormUrl(e.target.value)}
                  placeholder="https://linkedin.com/company/..."
                />
              </div>
            )}

            {typeConfig.needsQuery && (
              <div className="space-y-2">
                <Label>Search Keywords</Label>
                <Input
                  value={formQuery}
                  onChange={e => setFormQuery(e.target.value)}
                  placeholder="e.g. React Developer, Senior Engineer"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Country Filter (optional)</Label>
              <Select value={formCountry} onValueChange={setFormCountry}>
                <SelectTrigger>
                  <SelectValue placeholder="Any country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Country</SelectItem>
                  {COUNTRIES.filter(Boolean).map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !formName.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Add Subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default JobSubscriptions;
