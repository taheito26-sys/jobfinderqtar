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
import { useToast } from '@/hooks/use-toast';
import { Rss, Plus, MapPin, Building2, ExternalLink, Search, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';

const JobFeed = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [matches, setMatches] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newJob, setNewJob] = useState({ title: '', company: '', location: '', remote_type: 'unknown', description: '', apply_url: '' });

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: jobsData } = await supabase.from('jobs').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(50);
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
      ...newJob,
    }).select().single();

    if (data) {
      setJobs([data, ...jobs]);
      setAddOpen(false);
      setNewJob({ title: '', company: '', location: '', remote_type: 'unknown', description: '', apply_url: '' });
      toast({ title: 'Job added' });
    }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
  };

  const filtered = jobs.filter(j =>
    j.title.toLowerCase().includes(search.toLowerCase()) ||
    j.company.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Job Feed"
        description="Track and score job opportunities"
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Add Job</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Job Manually</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Title *</Label>
                    <Input value={newJob.title} onChange={e => setNewJob({ ...newJob, title: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Company *</Label>
                    <Input value={newJob.company} onChange={e => setNewJob({ ...newJob, company: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input value={newJob.location} onChange={e => setNewJob({ ...newJob, location: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Remote Type</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={newJob.remote_type} onChange={e => setNewJob({ ...newJob, remote_type: e.target.value })}>
                      <option value="remote">Remote</option>
                      <option value="hybrid">Hybrid</option>
                      <option value="onsite">On-site</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Apply URL</Label>
                  <Input value={newJob.apply_url} onChange={e => setNewJob({ ...newJob, apply_url: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea value={newJob.description} onChange={e => setNewJob({ ...newJob, description: e.target.value })} rows={6} />
                </div>
                <Button onClick={addJob} className="w-full">Add Job</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search jobs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading jobs...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Rss}
          title={search ? 'No matching jobs' : 'No jobs tracked yet'}
          description={search ? 'Try a different search term.' : 'Add jobs manually or configure sources in Settings to auto-ingest listings.'}
          actionLabel={search ? undefined : 'Add Job'}
          onAction={search ? undefined : () => setAddOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(job => {
            const match = matches[job.id];
            return (
              <Link key={job.id} to={`/jobs/${job.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="py-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">{job.title}</h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        {job.company}
                        {job.location && (
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{job.location}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.remote_type !== 'unknown' && (
                        <Badge variant="outline" className="text-xs capitalize">{job.remote_type}</Badge>
                      )}
                      {match && <ScoreBadge score={match.overall_score} />}
                      {match?.recommendation && (
                        <Badge variant={match.recommendation === 'apply' ? 'default' : match.recommendation === 'skip' ? 'destructive' : 'secondary'} className="text-xs capitalize">
                          {match.recommendation}
                        </Badge>
                      )}
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
