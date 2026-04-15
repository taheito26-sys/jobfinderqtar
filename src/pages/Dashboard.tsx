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
  Search, Upload, ArrowRight, BarChart3, Inbox, CheckCircle2, XCircle,
  MessageSquare, Timer, Award, Database, AlertTriangle
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, subDays, format, startOfWeek, eachWeekOfInterval } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, LineChart, Line, CartesianGrid, Legend,
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

interface SubmissionData {
  id: string;
  submission_status: string | null;
  submitted_at: string;
  response_received_at: string | null;
  follow_up_date: string | null;
  jobs?: { title?: string; company?: string } | null;
}

interface SourceLedgerRow {
  id: string;
  source_name: string;
  source_type: string;
  config: Record<string, unknown> | null;
  enabled?: boolean | null;
  last_synced_at?: string | null;
  created_at: string;
}

interface SourceSyncRunRow {
  id: string;
  source_id: string;
  run_mode: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  jobs_seen_count: number;
  jobs_inserted_count: number;
  jobs_updated_count: number;
  jobs_invalid_count: number;
}

interface RawJobRow {
  id: string;
  source_id: string;
  fetched_at: string;
}

const SCORE_BUCKETS = [
  { range: '0-20', label: '0–20', color: 'hsl(var(--score-poor))' },
  { range: '21-40', label: '21–40', color: 'hsl(var(--score-poor))' },
  { range: '41-60', label: '41–60', color: 'hsl(var(--score-fair))' },
  { range: '61-80', label: '61–80', color: 'hsl(var(--score-good))' },
  { range: '81-100', label: '81–100', color: 'hsl(var(--score-excellent))' },
];

const FUNNEL_COLORS: Record<string, string> = {
  submitted: 'hsl(var(--primary))',
  acknowledged: 'hsl(var(--info, 210 100% 50%))',
  interview: 'hsl(var(--score-good))',
  offer: 'hsl(var(--score-excellent))',
  rejected: 'hsl(var(--destructive))',
  withdrawn: 'hsl(var(--muted-foreground))',
  no_response: 'hsl(var(--score-fair))',
};

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalJobs: 0, matchedJobs: 0, applications: 0, documents: 0, avgScore: 0, topScore: 0, thisWeekJobs: 0 });
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [allMatches, setAllMatches] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionData[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [weeklyJobs, setWeeklyJobs] = useState<any[]>([]);
  const [sources, setSources] = useState<SourceLedgerRow[]>([]);
  const [sourceRuns, setSourceRuns] = useState<SourceSyncRunRow[]>([]);
  const [rawJobs, setRawJobs] = useState<RawJobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      const [jobs, matchesCount, apps, docs, recentMatchRes, activityRes, allMatchRes, weekJobs, subsRes, draftsRes, recentJobsRes, sourcesRes, runsRes, rawJobsRes] = await Promise.all([
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
        supabase.from('application_submissions').select('id, submission_status, submitted_at, response_received_at, follow_up_date, jobs(title, company)').eq('user_id', user.id),
        supabase.from('application_drafts').select('id, status').eq('user_id', user.id),
        supabase.from('jobs').select('id, created_at').eq('user_id', user.id).gte('created_at', thirtyDaysAgo),
        (supabase as any).from('job_sources').select('id, source_name, source_type, config, enabled, last_synced_at, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
        (supabase as any).from('source_sync_runs').select('id, source_id, run_mode, started_at, completed_at, status, jobs_seen_count, jobs_inserted_count, jobs_updated_count, jobs_invalid_count').eq('user_id', user.id).order('started_at', { ascending: false }).limit(50),
        (supabase as any).from('raw_jobs').select('id, source_id, fetched_at').eq('user_id', user.id),
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
      setSubmissions((subsRes.data as SubmissionData[]) ?? []);
      setDrafts(draftsRes.data ?? []);
      setSources((sourcesRes.data as SourceLedgerRow[]) ?? []);
      setSourceRuns((runsRes.data as SourceSyncRunRow[]) ?? []);
      setRawJobs((rawJobsRes.data as RawJobRow[]) ?? []);

      // Build weekly job ingestion data
      const recentJobs = recentJobsRes.data ?? [];
      const now = new Date();
      const weeks = eachWeekOfInterval({ start: subDays(now, 28), end: now }, { weekStartsOn: 1 });
      const weeklyData = weeks.map(weekStart => {
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        const count = recentJobs.filter((j: any) => {
          const d = new Date(j.created_at);
          return d >= weekStart && d < weekEnd;
        }).length;
        return { week: format(weekStart, 'MMM d'), count };
      });
      setWeeklyJobs(weeklyData);

      setLoading(false);
    };
    fetchAll();
  }, [user]);

  const sourceQuality = useMemo(() => {
    const rawCountMap = new Map<string, number>();
    rawJobs.forEach((raw) => {
      rawCountMap.set(raw.source_id, (rawCountMap.get(raw.source_id) ?? 0) + 1);
    });

    const runsBySource = new Map<string, SourceSyncRunRow[]>();
    sourceRuns.forEach((run) => {
      const existing = runsBySource.get(run.source_id) ?? [];
      existing.push(run);
      runsBySource.set(run.source_id, existing);
    });

    return sources.map((source) => {
      const runs = (runsBySource.get(source.id) ?? []).sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      const latestRun = runs[0] ?? null;
      const rawCount = rawCountMap.get(source.id) ?? 0;
      const invalidCount = runs.reduce((sum, run) => sum + Number(run.jobs_invalid_count ?? 0), 0);
      const seenCount = runs.reduce((sum, run) => sum + Number(run.jobs_seen_count ?? 0), 0);
      const insertedCount = runs.reduce((sum, run) => sum + Number(run.jobs_inserted_count ?? 0), 0);
      return {
        source,
        runCount: runs.length,
        latestRun,
        rawCount,
        invalidCount,
        seenCount,
        insertedCount,
        noiseRate: rawCount > 0 ? Math.round((invalidCount / rawCount) * 100) : 0,
      };
    }).sort((a, b) => b.rawCount - a.rawCount || b.runCount - a.runCount);
  }, [sources, sourceRuns, rawJobs]);

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

  // Application funnel data
  const funnelData = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    submissions.forEach(s => {
      const status = s.submission_status || 'submitted';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    const draftCount = drafts.filter(d => d.status !== 'submitted').length;

    return [
      { stage: 'Drafts', count: draftCount, fill: 'hsl(var(--muted-foreground))' },
      { stage: 'Submitted', count: statusCounts['submitted'] || 0, fill: FUNNEL_COLORS.submitted },
      { stage: 'Acknowledged', count: statusCounts['acknowledged'] || 0, fill: FUNNEL_COLORS.acknowledged },
      { stage: 'Interview', count: statusCounts['interview'] || 0, fill: FUNNEL_COLORS.interview },
      { stage: 'Offer', count: statusCounts['offer'] || 0, fill: FUNNEL_COLORS.offer },
      { stage: 'Rejected', count: statusCounts['rejected'] || 0, fill: FUNNEL_COLORS.rejected },
      { stage: 'No Response', count: statusCounts['no_response'] || 0, fill: FUNNEL_COLORS.no_response },
    ].filter(d => d.count > 0);
  }, [submissions, drafts]);

  // Response rate metrics
  const responseMetrics = useMemo(() => {
    const total = submissions.length;
    if (total === 0) return { responseRate: 0, interviewRate: 0, offerRate: 0, avgResponseDays: 0 };

    const responded = submissions.filter(s => s.response_received_at).length;
    const interviews = submissions.filter(s => s.submission_status === 'interview' || s.submission_status === 'offer').length;
    const offers = submissions.filter(s => s.submission_status === 'offer').length;

    const responseDays = submissions
      .filter(s => s.response_received_at)
      .map(s => (new Date(s.response_received_at!).getTime() - new Date(s.submitted_at).getTime()) / (1000 * 60 * 60 * 24))
      .filter(d => d > 0 && d < 365);
    const avgResponseDays = responseDays.length > 0
      ? Math.round(responseDays.reduce((a, b) => a + b, 0) / responseDays.length)
      : 0;

    return {
      responseRate: Math.round((responded / total) * 100),
      interviewRate: Math.round((interviews / total) * 100),
      offerRate: Math.round((offers / total) * 100),
      avgResponseDays,
    };
  }, [submissions]);

  const statCards = [
    { title: 'Jobs Tracked', value: stats.totalJobs, icon: Briefcase, color: 'text-primary', sub: `+${stats.thisWeekJobs} this week` },
    { title: 'High Matches (60+)', value: stats.matchedJobs, icon: Target, color: 'text-score-excellent', sub: `avg ${stats.avgScore}, top ${stats.topScore}` },
    { title: 'Applications', value: stats.applications, icon: Send, color: 'text-primary', sub: null },
    { title: 'Documents', value: stats.documents, icon: FileText, color: 'text-primary', sub: null },
  ];

  const quickActions = [
    { label: 'Add Job', icon: Plus, to: '/jobs', desc: 'Manually add a new job' },
    { label: 'Search Jobs', icon: Search, to: '/jobs', desc: 'Run bulk job search' },
    { label: 'Upload CV', icon: Upload, to: '/cv-library', desc: 'Upload a new document' },
    { label: 'Follow-up', icon: Inbox, to: '/follow-up', desc: 'Review next actions' },
  ];

  const responseMetricCards = [
    { label: 'Response Rate', value: `${responseMetrics.responseRate}%`, icon: MessageSquare, desc: 'Companies that replied' },
    { label: 'Interview Rate', value: `${responseMetrics.interviewRate}%`, icon: CheckCircle2, desc: 'Led to interview' },
    { label: 'Offer Rate', value: `${responseMetrics.offerRate}%`, icon: Award, desc: 'Resulted in offer' },
    { label: 'Avg Response', value: responseMetrics.avgResponseDays > 0 ? `${responseMetrics.avgResponseDays}d` : '—', icon: Timer, desc: 'Days to hear back' },
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

      {/* Response Rate Metrics */}
      {submissions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {responseMetricCards.map(({ label, value, icon: Icon, desc }) => (
            <Card key={label}>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-foreground">{loading ? '—' : value}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Source Quality Report */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            Source Quality Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading source ledger...</p>
          ) : sourceQuality.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-4">
              <AlertTriangle className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No source ledger yet</p>
                <p className="text-xs text-muted-foreground">
                  Run a search or scrape import to start tracking source runs, raw jobs, and invalid counts.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Sources</p>
                  <p className="text-2xl font-bold text-foreground">{sources.length}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Raw jobs</p>
                  <p className="text-2xl font-bold text-foreground">{rawJobs.length}</p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Invalid runs</p>
                  <p className="text-2xl font-bold text-foreground">
                    {sourceRuns.reduce((sum, run) => sum + Number(run.jobs_invalid_count ?? 0), 0)}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Tracked runs</p>
                  <p className="text-2xl font-bold text-foreground">{sourceRuns.length}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1.2fr] gap-3 border-b bg-muted/30 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Source</span>
                  <span>Runs</span>
                  <span>Raw</span>
                  <span>Invalid</span>
                  <span>Noise</span>
                  <span>Latest Run</span>
                </div>
                <div className="divide-y">
                  {sourceQuality.map(({ source, runCount, rawCount, invalidCount, noiseRate, latestRun }) => (
                    <div key={source.id} className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1.2fr] gap-3 px-4 py-3 items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link to={`/sources/${source.id}`} className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors">
                            {source.source_name}
                          </Link>
                          {source.enabled === false && (
                            <Badge variant="secondary" className="text-[10px]">Disabled</Badge>
                          )}
                        </div>
          <p className="text-xs text-muted-foreground truncate">{source.source_type}{(() => {
            const baseUrl = source.config?.base_url;
            return baseUrl ? ` · ${String(baseUrl)}` : '';
          })()}</p>
                      </div>
                      <span className="text-sm text-foreground">{runCount}</span>
                      <span className="text-sm text-foreground">{rawCount}</span>
                      <span className="text-sm text-foreground">{invalidCount}</span>
                      <span className={`text-sm font-medium ${noiseRate >= 50 ? 'text-destructive' : noiseRate >= 20 ? 'text-warning' : 'text-score-excellent'}`}>
                        {rawCount > 0 ? `${noiseRate}%` : '—'}
                      </span>
                      <div className="min-w-0">
                        {latestRun ? (
                          <>
                            <p className="text-sm text-foreground capitalize">{latestRun.status}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })}
                              {' · '}
                              seen {latestRun.jobs_seen_count}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">No runs yet</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Application Funnel */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              Application Funnel
            </CardTitle>
          </CardHeader>
          <CardContent>
            {funnelData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No applications yet.</p>
            ) : (
              <div className="space-y-3">
                {funnelData.map(({ stage, count, fill }) => {
                  const maxCount = Math.max(...funnelData.map(d => d.count), 1);
                  return (
                    <div key={stage} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-foreground font-medium">{stage}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: fill }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

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

        {/* Weekly Job Ingestion Trend */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              Weekly Job Ingestion
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weeklyJobs.length === 0 || weeklyJobs.every(w => w.count === 0) ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Add jobs to see weekly trends.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={weeklyJobs} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                    formatter={(value: number) => [`${value} jobs`, 'Added']}
                  />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Recent Matches */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              Top Recent Matches
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
        <Card>
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
                {recentActivity.map((log) => (
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
                    {stats.thisWeekJobs} new jobs · {stats.matchedJobs} high matches · {stats.applications} applications tracked
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
