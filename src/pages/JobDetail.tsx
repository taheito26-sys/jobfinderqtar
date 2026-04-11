import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import ScoreBadge from '@/components/ScoreBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, ExternalLink, MapPin, Building2, AlertTriangle, CheckCircle2, XCircle,
  Zap, FileText, Send, Loader2, Mail, Linkedin, CheckSquare
} from 'lucide-react';

function isLinkedInSource(job: any): boolean {
  if (!job) return false;
  const raw = job.raw_data as any;
  if (raw?.source === 'linkedin') return true;
  const sourceUrl = job.source_url || job.apply_url || '';
  try {
    return new URL(sourceUrl).hostname.includes('linkedin.com');
  } catch {
    return sourceUrl.includes('linkedin.com');
  }
}

const JobDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [job, setJob] = useState<any>(null);
  const [match, setMatch] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [tailoringCL, setTailoringCL] = useState(false);
  const [draftModal, setDraftModal] = useState(false);
  const [draftMode, setDraftMode] = useState('manual');
  const [draftNotes, setDraftNotes] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [markedApplied, setMarkedApplied] = useState(false);

  const isLinkedin = isLinkedInSource(job);

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

  const logEvent = async (eventType: string, metadata: any = {}) => {
    if (!user || !id) return;
    await supabase.from('application_events').insert({
      user_id: user.id,
      job_id: id,
      event_type: eventType,
      metadata: metadata as any,
    });
  };

  const scoreJob = async () => {
    if (!user || !id) return;
    setScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('score-job', { body: { job_id: id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMatch(data);
      await logEvent('job_scored', { overall_score: data.overall_score });
      toast({ title: 'Job scored!', description: `Match score: ${data.overall_score}/100` });
    } catch (err: any) {
      toast({ title: 'Scoring failed', description: err.message, variant: 'destructive' });
    }
    setScoring(false);
  };

  const tailorDocument = async (docType: 'cv' | 'cover_letter') => {
    if (!user || !id) return;
    const setter = docType === 'cv' ? setTailoring : setTailoringCL;
    setter(true);
    try {
      const { data, error } = await supabase.functions.invoke('tailor-cv', {
        body: { job_id: id, document_type: docType },
      });
      if (error) throw error;
      if (data?.fallback || (data?.error && !data?.content)) {
        if (data?.error?.includes('Profile not found') || data?.error?.includes('profile')) {
          toast({
            title: 'Profile is empty',
            description: 'Please complete your profile first. Go to Profile → "Extract from CV" to auto-fill from your uploaded CV.',
            variant: 'destructive',
            duration: 8000,
          });
        } else {
          toast({
            title: 'Temporarily unavailable',
            description: data?.error || 'AI provider is busy. Please wait 30-60 seconds and try again.',
            variant: 'destructive',
            duration: 6000,
          });
        }
        setter(false);
        return;
      }
      await logEvent(docType === 'cv' ? 'cv_tailored' : 'cover_letter_generated', { job_id: id });
      toast({ title: docType === 'cv' ? 'CV tailored!' : 'Cover letter generated!', description: 'View it in Tailoring Review.' });
      navigate('/tailoring');
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('Profile not found') || msg.includes('profile')) {
        toast({
          title: 'Profile is empty',
          description: 'Please complete your profile first. Go to Profile → "Extract from CV" to auto-fill from your uploaded CV.',
          variant: 'destructive',
          duration: 8000,
        });
      } else {
        toast({ title: 'Tailoring failed', description: msg, variant: 'destructive' });
      }
    }
    setter(false);
  };

  const openApplyUrl = async () => {
    const applyUrl = job.apply_url || job.source_url;
    if (applyUrl) {
      await logEvent('opened_apply_url', { url: applyUrl, source: isLinkedin ? 'linkedin' : 'web' });
      window.open(applyUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const markApplied = async () => {
    if (!user || !id) return;
    await logEvent('marked_applied', { method: 'manual', source: isLinkedin ? 'linkedin' : 'web' });
    setMarkedApplied(true);
    toast({ title: 'Marked as applied', description: 'Application status recorded.' });
  };

  const createDraft = async () => {
    if (!user || !id) return;
    setCreatingDraft(true);
    try {
      // For LinkedIn jobs, force manual mode
      const mode = isLinkedin ? 'manual' : draftMode;
      const { data, error } = await supabase.from('application_drafts').insert({
        user_id: user.id, job_id: id, match_id: match?.id || null,
        apply_mode: mode, status: 'draft', notes: draftNotes,
      }).select().single();
      if (error) throw error;
      await logEvent('created_draft', { draft_id: data.id, mode });
      await supabase.from('activity_log').insert({
        user_id: user.id, action: 'created_draft', entity_type: 'application_draft',
        entity_id: data.id, details: { job_title: job.title, company: job.company, mode } as any,
      });
      toast({ title: 'Draft created' });
      setDraftModal(false);
      navigate('/applications');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setCreatingDraft(false);
  };

  if (loading) return <div className="animate-fade-in p-8 text-center text-muted-foreground">Loading...</div>;
  if (!job) return <div className="p-8 text-center text-muted-foreground">Job not found.</div>;

  const scoreBreakdown = match ? [
    { label: 'Hard Requirements', score: match.hard_requirements_score },
    { label: 'Skill Overlap', score: match.skill_overlap_score },
    { label: 'Title Relevance', score: match.title_relevance_score },
    { label: 'Seniority Fit', score: match.seniority_fit_score },
    { label: 'Industry Fit', score: match.industry_fit_score },
    { label: 'Location Fit', score: match.location_fit_score },
    { label: 'Compensation Fit', score: match.compensation_fit_score },
    { label: 'Language Fit', score: match.language_fit_score },
    { label: 'Work Auth Fit', score: match.work_auth_fit_score },
  ] : [];

  return (
    <div className="animate-fade-in">
      <Button variant="ghost" size="sm" onClick={() => navigate('/jobs')} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />Back to Jobs
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold text-foreground">{job.title}</h1>
                    {isLinkedin && (
                      <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800">
                        <Linkedin className="w-3 h-3 mr-1" /> Imported from LinkedIn
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">{job.company}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {job.location && <span className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="w-3 h-3" />{job.location}</span>}
                    {job.remote_type !== 'unknown' && <Badge variant="outline" className="capitalize">{job.remote_type}</Badge>}
                    {job.employment_type && <Badge variant="outline">{job.employment_type}</Badge>}
                    <Badge variant="secondary" className="capitalize">{job.status}</Badge>
                  </div>
                  {(job.salary_min || job.salary_max) && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {job.salary_currency} {job.salary_min?.toLocaleString()}{job.salary_max ? ` – ${job.salary_max.toLocaleString()}` : ''}
                    </p>
                  )}
                </div>
                {match && <ScoreBadge score={match.overall_score} size="lg" showLabel />}
              </div>

              {/* LinkedIn manual-submit notice */}
              {isLinkedin && (
                <div className="mt-4 flex items-start gap-2 p-3 rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30">
                  <Linkedin className="w-4 h-4 text-[#0A66C2] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Manual submit required.</span> This app helps you prepare tailored materials. You'll submit your application directly on LinkedIn.
                  </p>
                </div>
              )}

              {(job.apply_url || job.source_url) && (
                <Button variant="outline" size="sm" className="mt-4" onClick={openApplyUrl}>
                  <ExternalLink className="w-4 h-4 mr-2" />View Original Listing
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
            <CardContent>
              {job.description ? <p className="text-sm text-foreground whitespace-pre-wrap">{job.description}</p> : <p className="text-sm text-muted-foreground">No description available.</p>}
            </CardContent>
          </Card>

          {(job.requirements as any[])?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Requirements</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {(job.requirements as string[]).map((req, i) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-2"><span className="text-muted-foreground mt-0.5">•</span>{req}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {(job.nice_to_haves as any[])?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Nice to Have</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {(job.nice_to_haves as string[]).map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2"><span className="mt-0.5">○</span>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {/* Apply workflow CTA card */}
          <Card>
            <CardHeader><CardTitle className="text-base">Apply Workflow</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full" onClick={scoreJob} disabled={scoring}>
                {scoring ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scoring...</> : <><Zap className="w-4 h-4 mr-2" />{match ? 'Re-score Job' : '1. Score Job'}</>}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => tailorDocument('cv')} disabled={tailoring}>
                {tailoring ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Tailoring...</> : <><FileText className="w-4 h-4 mr-2" />2. Tailor CV</>}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => tailorDocument('cover_letter')} disabled={tailoringCL}>
                {tailoringCL ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</> : <><Mail className="w-4 h-4 mr-2" />3. Generate Cover Letter</>}
              </Button>
              {(job.apply_url || job.source_url) && (
                <Button variant="outline" className="w-full" onClick={openApplyUrl}>
                  <ExternalLink className="w-4 h-4 mr-2" />4. Open Application URL
                </Button>
              )}
              <Button
                variant={markedApplied ? 'secondary' : 'outline'}
                className="w-full"
                onClick={markApplied}
                disabled={markedApplied}
              >
                <CheckSquare className="w-4 h-4 mr-2" />{markedApplied ? 'Applied ✓' : '5. Mark Applied'}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setDraftModal(true)}>
                <Send className="w-4 h-4 mr-2" />Create Draft
              </Button>
            </CardContent>
          </Card>

          {match ? (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Score Breakdown</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {scoreBreakdown.map(({ label, score }) => (
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
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" />Match Reasons</CardTitle></CardHeader>
                  <CardContent><ul className="space-y-1">{(match.match_reasons as string[]).map((r, i) => <li key={i} className="text-sm text-foreground">✓ {r}</li>)}</ul></CardContent>
                </Card>
              )}

              {(match.missing_requirements as any[])?.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-score-fair" />Missing</CardTitle></CardHeader>
                  <CardContent><ul className="space-y-1">{(match.missing_requirements as string[]).map((r, i) => <li key={i} className="text-sm text-muted-foreground">— {r}</li>)}</ul></CardContent>
                </Card>
              )}

              {(match.blockers as any[])?.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><XCircle className="w-4 h-4 text-destructive" />Blockers</CardTitle></CardHeader>
                  <CardContent><ul className="space-y-1">{(match.blockers as string[]).map((r, i) => <li key={i} className="text-sm text-destructive">⚠ {r}</li>)}</ul></CardContent>
                </Card>
              )}

              {match.recommendation && (
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Recommendation</p>
                    <Badge variant={match.recommendation === 'apply' ? 'default' : match.recommendation === 'skip' ? 'destructive' : 'secondary'} className="text-sm capitalize px-4 py-1">
                      {match.recommendation}
                    </Badge>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-sm text-muted-foreground">Click "Score Job" to analyze this role against your profile.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={draftModal} onOpenChange={setDraftModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Application Draft</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Application Mode</Label>
              {isLinkedin ? (
                <div className="p-3 rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30">
                  <p className="text-sm text-foreground font-medium">Manual</p>
                  <p className="text-xs text-muted-foreground">LinkedIn jobs require manual submission. Prepare your materials here, then apply on LinkedIn directly.</p>
                </div>
              ) : (
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draftMode} onChange={e => setDraftMode(e.target.value)}>
                  <option value="manual">Manual — You apply using tailored docs</option>
                  <option value="assisted">Assisted — System pre-fills, you review</option>
                </select>
              )}
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)} rows={3} placeholder="Any notes for this application..." />
            </div>
            <Button onClick={createDraft} className="w-full" disabled={creatingDraft}>
              {creatingDraft ? 'Creating...' : 'Create Draft'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default JobDetail;
