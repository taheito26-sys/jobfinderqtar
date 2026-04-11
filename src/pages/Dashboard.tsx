import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import ScoreBadge from '@/components/ScoreBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Briefcase, FileText, Send, TrendingUp, Target, Clock, Zap, Plus,
  Search, Upload, ArrowRight, BarChart3, Activity
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

interface Stats {
  totalJobs: number;
  matchedJobs: number;
  applications: number;
  documents: number;
  avgScore: number;
  topScore: number;
  thisWeekJobs: number;
}

const SCORE_BUCKETS = [
  { range: '0-20', label: '0–20', color: 'hsl(var(--score-poor))' },
  { range: '21-40', label: '21–40', color: 'hsl(var(--score-poor))' },
  { range: '41-60', label: '41–60', color: 'hsl(var(--score-fair))' },
  { range: '61-80', label: '61–80', color: 'hsl(var(--score-good))' },
  { range: '81-100', label: '81–100', color: 'hsl(var(--score-excellent))' },
];

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalJobs: 0, matchedJobs: 0, applications: 0, documents: 0, avgScore: 0, topScore: 0, thisWeekJobs: 0 });
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [allMatches, setAllMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [jobs, matchesCount, apps, docs, recentMatchRes, activityRes, allMatchRes, weekJobs] = await Promise.all([
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('job_matches').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('overall_score', 60),
        supabase.from('application_submissions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('master_documents').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('job_matches').select('*, jobs(title, company)').eq('user_id', user.id)
          .order('scored_at', { ascending: false }).limit(5),
        supabase.from('activity_log').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(10),
        supabase.from('job_matches').select('overall_score').eq('user_id', user.id),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', weekAgo),
      ]);

      const scores = (allMatchRes.data ?? []).map((m: any) => m.overall_score);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
      const topScore = scores.length > 0 ? Math.max(...scores) : 0;

      setStats({
        totalJobs: jobs.count ?? 0,
        matchedJobs: matchesCount.count ?? 0,
        applications: apps.count ?? 0,
        documents: docs.count ?? 0,
        avgScore,
        topScore,
        thisWeekJobs: weekJobs.count ?? 0,
      });
      setRecentMatches(recentMatchRes.data ?? []);
      setRecentActivity(activityRes.data ?? []);
      setAllMatches(allMatchRes.data ?? []);
      setLoading(false);
    };
    fetchAll();
  }, [user]);

  // Score distribution for chart
  const scoreDistribution = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0];
    allMatches.forEach((m: any) => {
      const s = m.overall_score;
      if (s <= 20) buckets[0]++;
      else if (s <= 40) buckets[1]++;
      else if (s <= 60) buckets[2]++;
      else if (s <= 80) buckets[3]++;
      else buckets[4]++;
    });
    return SCORE_BUCKETS.map((b, i) => ({ ...b, count: buckets[i] }));
  }, [allMatches]);

  const statCards = [
    { title: 'Jobs Tracked', value: stats.totalJobs, icon: Briefcase, color: 'text-primary', sub: `+${stats.thisWeekJobs} this week` },
    { title: 'High Matches (60+)', value: stats.matchedJobs, icon: Target, color: 'text-score-excellent', sub: `avg ${stats.avgScore}, top ${stats.topScore}` },
    { title: 'Applications', value: stats.applications, icon: Send, color: 'text-info', sub: null },
    { title: 'Documents', value: stats.documents, icon: FileText, color: 'text-warning', sub: null },
  ];

  const quickActions = [
    { label: 'Add Job', icon: Plus, to: '/jobs', desc: 'Manually add a new job' },
    { label: 'Search Jobs', icon: Search, to: '/jobs', desc: 'Run bulk job search' },
    { label: 'Upload CV', icon: Upload, to: '/cv-library', desc: 'Upload a new document' },
    { label: 'View Profile', icon: Activity, to: '/profile', desc: 'Check profile completeness' },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" description="Your job search at a glance" />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map(({ title, value, icon: Icon, color, sub }) => (
          <Card key={title}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{title}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">
                    {loading ? '—' : value}
                  </p>
                  {sub && !loading && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
                </div>
                <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {quickActions.map(({ label, icon: Icon, to, desc }) => (
          <Link key={label} to={to}>
            <Card className="hover:border-primary/30 transition-colors cursor-pointer group">
              <CardContent className="py-4 px-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Score Distribution Chart */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              Score Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {allMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Score jobs to see distribution.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={scoreDistribution} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                    formatter={(value: number) => [`${value} jobs`, 'Count']}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {scoreDistribution.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent Matches */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              Recent Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No matches yet. Score your jobs.
              </p>
            ) : (
              <div className="space-y-2.5">
                {recentMatches.map(m => (
                  <Link key={m.id} to={`/jobs/${m.job_id}`} className="flex items-center gap-2.5 p-2 rounded-md hover:bg-muted transition-colors">
                    <ScoreBadge score={m.overall_score} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{m.jobs?.title}</p>
                      <p className="text-xs text-muted-foreground">{m.jobs?.company}</p>
                    </div>
                    {m.recommendation && (
                      <Badge variant={m.recommendation === 'apply' ? 'default' : m.recommendation === 'skip' ? 'destructive' : 'secondary'} className="text-[10px] capitalize">
                        {m.recommendation}
                      </Badge>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Timeline */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Activity Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Activity will appear here.
              </p>
            ) : (
              <div className="space-y-1">
                {recentActivity.map((log, i) => (
                  <div key={log.id} className="flex items-start gap-2.5 py-1.5">
                    <div className="mt-1.5 w-2 h-2 rounded-full bg-primary/40 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground leading-tight">
                        <span className="font-medium capitalize">{log.action.replace(/_/g, ' ')}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {log.entity_type.replace(/_/g, ' ')} · {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Summary */}
      {!loading && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">Weekly Summary</p>
                  <p className="text-xs text-muted-foreground">
                    {stats.thisWeekJobs} new jobs · {stats.matchedJobs} high matches · {stats.applications} applications sent
                  </p>
                </div>
              </div>
              <Link to="/jobs">
                <Button variant="outline" size="sm" className="gap-1">
                  View Feed <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;