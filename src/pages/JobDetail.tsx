import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import ScoreBadge from '@/components/ScoreBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ExternalLink, MapPin, Building2, Clock, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

const JobDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [job, setJob] = useState<any>(null);
  const [match, setMatch] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !id) return;
    const load = async () => {
      const [jobRes, matchRes] = await Promise.all([
        supabase.from('jobs').select('*').eq('id', id).eq('user_id', user.id).single(),
        supabase.from('job_matches').select('*').eq('job_id', id).eq('user_id', user.id).maybeSingle(),
      ]);
      setJob(jobRes.data);
      setMatch(matchRes.data);
      setLoading(false);
    };
    load();
  }, [id, user]);

  if (loading) return <div className="animate-fade-in p-8 text-center text-muted-foreground">Loading...</div>;
  if (!job) return <div className="p-8 text-center text-muted-foreground">Job not found.</div>;

  const scoreBreakdown = match ? [
    { label: 'Hard Requirements', score: match.hard_requirements_score, weight: 25 },
    { label: 'Skill Overlap', score: match.skill_overlap_score, weight: 20 },
    { label: 'Title Relevance', score: match.title_relevance_score, weight: 10 },
    { label: 'Seniority Fit', score: match.seniority_fit_score, weight: 10 },
    { label: 'Industry Fit', score: match.industry_fit_score, weight: 8 },
    { label: 'Location Fit', score: match.location_fit_score, weight: 10 },
    { label: 'Compensation Fit', score: match.compensation_fit_score, weight: 7 },
    { label: 'Language Fit', score: match.language_fit_score, weight: 5 },
    { label: 'Work Auth Fit', score: match.work_auth_fit_score, weight: 5 },
  ] : [];

  return (
    <div className="animate-fade-in">
      <Button variant="ghost" size="sm" onClick={() => navigate('/jobs')} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />Back to Jobs
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <h1 className="text-xl font-bold text-foreground">{job.title}</h1>
                  <p className="text-muted-foreground">{job.company}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {job.location && (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="w-3 h-3" />{job.location}
                      </span>
                    )}
                    {job.remote_type !== 'unknown' && (
                      <Badge variant="outline" className="capitalize">{job.remote_type}</Badge>
                    )}
                    {job.employment_type && <Badge variant="outline">{job.employment_type}</Badge>}
                    <Badge variant="secondary" className="capitalize">{job.status}</Badge>
                  </div>
                </div>
                {match && <ScoreBadge score={match.overall_score} size="lg" showLabel />}
              </div>

              {job.apply_url && (
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <a href={job.apply_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" />View Listing
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
            <CardContent>
              {job.description ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{job.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No description available.</p>
              )}
            </CardContent>
          </Card>

          {(job.requirements as any[])?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Requirements</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {(job.requirements as string[]).map((req, i) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-2">
                      <span className="text-muted-foreground mt-0.5">•</span>{req}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Score Sidebar */}
        <div className="space-y-4">
          {match ? (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Score Breakdown</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {scoreBreakdown.map(({ label, score, weight }) => (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono text-foreground">{score}</span>
                      </div>
                      <Progress value={score} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {(match.match_reasons as any[])?.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-score-excellent" />Match Reasons
                  </CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {(match.match_reasons as string[]).map((r, i) => (
                        <li key={i} className="text-sm text-foreground">✓ {r}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {(match.missing_requirements as any[])?.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-score-fair" />Missing
                  </CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {(match.missing_requirements as string[]).map((r, i) => (
                        <li key={i} className="text-sm text-muted-foreground">— {r}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {(match.blockers as any[])?.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader><CardTitle className="text-base flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-destructive" />Blockers
                  </CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {(match.blockers as string[]).map((r, i) => (
                        <li key={i} className="text-sm text-destructive">⚠ {r}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">This job hasn't been scored yet.</p>
                <Button size="sm" disabled>Score Job</Button>
                <p className="text-xs text-muted-foreground mt-2">Connect AI in Settings to enable scoring.</p>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Button className="w-full" onClick={() => navigate(`/tailoring?job=${id}`)}>
              Tailor CV for This Job
            </Button>
            <Button variant="outline" className="w-full" onClick={() => navigate(`/applications?job=${id}`)}>
              Create Application Draft
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobDetail;
