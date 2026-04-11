import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, FileText, Send, TrendingUp, Target, Clock } from 'lucide-react';

interface Stats {
  totalJobs: number;
  matchedJobs: number;
  applications: number;
  documents: number;
}

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalJobs: 0, matchedJobs: 0, applications: 0, documents: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchStats = async () => {
      const [jobs, matches, apps, docs] = await Promise.all([
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('job_matches').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('overall_score', 60),
        supabase.from('application_submissions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('master_documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ]);
      setStats({
        totalJobs: jobs.count ?? 0,
        matchedJobs: matches.count ?? 0,
        applications: apps.count ?? 0,
        documents: docs.count ?? 0,
      });
      setLoading(false);
    };
    fetchStats();
  }, [user]);

  const cards = [
    { title: 'Jobs Tracked', value: stats.totalJobs, icon: Briefcase, color: 'text-primary' },
    { title: 'High Matches', value: stats.matchedJobs, icon: Target, color: 'text-score-excellent' },
    { title: 'Applications', value: stats.applications, icon: Send, color: 'text-info' },
    { title: 'Documents', value: stats.documents, icon: FileText, color: 'text-warning' },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Your job search at a glance"
      />

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
            {stats.matchedJobs === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No matches yet. Add jobs to your feed to get started.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                View your matched jobs in the Job Feed.
              </p>
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
            <p className="text-sm text-muted-foreground py-8 text-center">
              Your activity will appear here as you use the system.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
