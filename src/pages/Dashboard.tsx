import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import ScoreBadge from '@/components/ScoreBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Briefcase, FileText, Send, TrendingUp, Target, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

interface Stats {
  totalJobs: number;
  matchedJobs: number;
  applications: number;
  documents: number;
}

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalJobs: 0, matchedJobs: 0, applications: 0, documents: 0 });
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      const [jobs, matches, apps, docs, recentMatchRes, activityRes] = await Promise.all([
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('job_matches').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('overall_score', 60),
        supabase.from('application_submissions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('master_documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('job_matches').select('*, jobs(title, company)').eq('user_id', user.id)
          .order('scored_at', { ascending: false }).limit(5),
        supabase.from('activity_log').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(8),
      ]);
      setStats({
        totalJobs: jobs.count ?? 0,
        matchedJobs: matches.count ?? 0,
        applications: apps.count ?? 0,
        documents: docs.count ?? 0,
      });
      setRecentMatches(recentMatchRes.data ?? []);
      setRecentActivity(activityRes.data ?? []);
      setLoading(false);
    };
    fetchAll();
  }, [user]);

  const cards = [
    { title: 'Jobs Tracked', value: stats.totalJobs, icon: Briefcase, color: 'text-primary' },
    { title: 'High Matches', value: stats.matchedJobs, icon: Target, color: 'text-score-excellent' },
    { title: 'Applications', value: stats.applications, icon: Send, color: 'text-info' },
    { title: 'Documents', value: stats.documents, icon: FileText, color: 'text-warning' },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" description="Your job search at a glance" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(({ title, value, icon: Icon, color }) => (
          <Card key={title}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{title}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">
                    {loading ? '—' : value}
                  </p>
                </div>
                <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              Recent Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No matches yet. Add jobs to your feed and score them.
              </p>
            ) : (
              <div className="space-y-3">
                {recentMatches.map(m => (
                  <Link key={m.id} to={`/jobs/${m.job_id}`} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors">
                    <ScoreBadge score={m.overall_score} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{m.jobs?.title}</p>
                      <p className="text-xs text-muted-foreground">{m.jobs?.company}</p>
                    </div>
                    {m.recommendation && (
                      <Badge variant={m.recommendation === 'apply' ? 'default' : m.recommendation === 'skip' ? 'destructive' : 'secondary'} className="text-xs capitalize">
                        {m.recommendation}
                      </Badge>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Your activity will appear here as you use the system.
              </p>
            ) : (
              <div className="space-y-2">
                {recentActivity.map(log => (
                  <div key={log.id} className="flex items-center gap-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{log.action.replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-xs text-muted-foreground">{log.entity_type.replace(/_/g, ' ')}</span>
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
