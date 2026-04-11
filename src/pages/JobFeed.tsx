import { useEffect, useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { Rss, Plus, MapPin, Building2, Search, Loader2, Zap, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

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
  const [newJob, setNewJob] = useState({ title: '', company: '', location: '', remote_type: 'unknown', description: '', apply_url: '', salary_min: '', salary_max: '' });

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
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'score') {
        return (matches[b.id]?.overall_score ?? -1) - (matches[a.id]?.overall_score ?? -1);
      }
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

      <div className="flex gap-2 mb-4 flex-wrap">
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
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading jobs...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Rss}
          title={search || statusFilter !== 'all' ? 'No matching jobs' : 'No jobs tracked yet'}
          description={search || statusFilter !== 'all' ? 'Try different filters.' : 'Add jobs manually or configure sources in Settings.'}
          actionLabel={search || statusFilter !== 'all' ? undefined : 'Add Job'}
          onAction={search || statusFilter !== 'all' ? undefined : () => setAddOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(job => {
            const match = matches[job.id];
            return (
              <Link key={job.id} to={`/jobs/${job.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
                  <CardContent className="py-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">{job.title}</h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        {job.company}
                        {job.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>}
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
    </div>
  );
};

export default JobFeed;
