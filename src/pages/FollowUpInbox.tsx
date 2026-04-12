import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import {
  AlarmClock,
  ArrowRight,
  BellRing,
  CalendarClock,
  Inbox,
  Sparkles,
} from 'lucide-react';

import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  getInterviewDeadlines,
  getStaleApplications,
  getTopSubscriptionSources,
  type InboxJob,
  type InboxMatch,
  type InboxSubmission,
  type InboxSubscription,
} from '@/lib/follow-up';

const FollowUpInbox = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<InboxSubmission[]>([]);
  const [subscriptions, setSubscriptions] = useState<InboxSubscription[]>([]);
  const [jobs, setJobs] = useState<InboxJob[]>([]);
  const [matches, setMatches] = useState<InboxMatch[]>([]);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      const [submissionsRes, subscriptionsRes, jobsRes, matchesRes] = await Promise.all([
        supabase.from('application_submissions')
          .select('id, submitted_at, follow_up_date, submission_status, response_received_at, outcome_notes, jobs(title, company)')
          .eq('user_id', user.id)
          .order('submitted_at', { ascending: false }),
        supabase.from('job_subscriptions')
          .select('id, name, jobs_found_total, enabled')
          .eq('user_id', user.id)
          .order('jobs_found_total', { ascending: false }),
        supabase.from('jobs')
          .select('id, raw_data')
          .eq('user_id', user.id),
        supabase.from('job_matches')
          .select('job_id, overall_score, recommendation')
          .eq('user_id', user.id),
      ]);

      setSubmissions((submissionsRes.data as InboxSubmission[]) ?? []);
      setSubscriptions((subscriptionsRes.data as InboxSubscription[]) ?? []);
      setJobs((jobsRes.data as InboxJob[]) ?? []);
      setMatches((matchesRes.data as InboxMatch[]) ?? []);
      setLoading(false);
    };

    load();
  }, [user]);

  const staleApplications = useMemo(() => getStaleApplications(submissions), [submissions]);
  const interviewDeadlines = useMemo(() => getInterviewDeadlines(submissions), [submissions]);
  const topSources = useMemo(() => getTopSubscriptionSources(subscriptions, jobs, matches).slice(0, 5), [subscriptions, jobs, matches]);

  const inboxCount = staleApplications.length + interviewDeadlines.length + topSources.length;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Follow-up Inbox"
        description={`${staleApplications.length} stale applications • ${interviewDeadlines.length} interview deadlines • ${topSources.length} top sources`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link to="/applications"><Button variant="outline" size="sm">Applications</Button></Link>
            <Link to="/subscriptions"><Button variant="outline" size="sm">Subscriptions</Button></Link>
            <Link to="/jobs"><Button size="sm">Open Feed</Button></Link>
          </div>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((item) => (
            <Card key={item}><CardContent className="py-10 text-center text-muted-foreground">Loading...</CardContent></Card>
          ))}
        </div>
      ) : inboxCount === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox is clear"
          description="Follow-ups, interview deadlines, and top-performing sources will collect here."
          actionLabel="View Applications"
          onAction={() => navigate('/applications')}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlarmClock className="w-4 h-4 text-muted-foreground" />
                Stale Applications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {staleApplications.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing stale right now.</p>
              ) : staleApplications.map((submission) => (
                <div key={submission.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">{submission.jobs?.title || 'Untitled role'}</p>
                  <p className="text-xs text-muted-foreground">{submission.jobs?.company || 'Unknown company'}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="capitalize text-[10px]">{submission.submission_status?.replace('_', ' ') || 'submitted'}</Badge>
                    <span>Submitted {formatDistanceToNow(new Date(submission.submitted_at), { addSuffix: true })}</span>
                    {submission.follow_up_date && <span>Follow up {format(new Date(submission.follow_up_date), 'MMM d')}</span>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-muted-foreground" />
                Interview Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {interviewDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No interview follow-ups scheduled.</p>
              ) : interviewDeadlines.map((submission) => (
                <div key={submission.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">{submission.jobs?.title || 'Interview follow-up'}</p>
                  <p className="text-xs text-muted-foreground">{submission.jobs?.company || 'Unknown company'}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <Badge className="text-[10px]">Interview</Badge>
                    {submission.follow_up_date && <span>{format(new Date(submission.follow_up_date), 'EEE, MMM d')}</span>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                Best Subscription Sources
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {topSources.length === 0 ? (
                <p className="text-sm text-muted-foreground">Create a few alerts and subscriptions to compare source quality.</p>
              ) : topSources.map((source) => (
                <div key={source.subscriptionId} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{source.name}</p>
                    <Badge variant="outline" className="text-[10px]">Avg {source.averageScore}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span>{source.importedJobs} imported</span>
                    <span>{source.recommendedJobs} recommended</span>
                    <span>{source.jobsFoundTotal} found total</span>
                  </div>
                </div>
              ))}
              <Link to="/subscriptions" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Tune subscriptions <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && inboxCount > 0 && (
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <BellRing className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Stay on top of the next move</p>
              <p className="text-xs text-muted-foreground">This inbox updates from your applications, follow-up dates, and subscription quality signals.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default FollowUpInbox;
