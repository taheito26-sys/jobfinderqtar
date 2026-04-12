import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import {
  Send, FileText, Clock, CheckCircle2, AlertTriangle, ArrowRight,
  ExternalLink, Linkedin, ClipboardCheck, Info
} from 'lucide-react';

const statusIcons: Record<string, any> = {
  draft: Clock,
  ready_to_apply: FileText,
  approved: CheckCircle2,
  blocked: AlertTriangle,
  submitted: Send,
};

const submissionStatusLabels: Record<string, string> = {
  submitted: '📨 Submitted — Waiting for response',
  acknowledged: '✅ Acknowledged — Company received it',
  interview: '🎤 Interview — Scheduled or completed',
  offer: '🎉 Offer — Congratulations!',
  rejected: '❌ Rejected',
  withdrawn: '🔙 Withdrawn — You pulled out',
  no_response: '😶 No Response — Consider following up',
};

const Applications = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitModal, setSubmitModal] = useState<any>(null);
  const [submitForm, setSubmitForm] = useState({ method: 'manual', notes: '', follow_up_date: '' });
  const [submitting, setSubmitting] = useState(false);
  const [statusModal, setStatusModal] = useState<any>(null);
  const [newStatus, setNewStatus] = useState('');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [checklist, setChecklist] = useState({ cv: false, coverLetter: false, applied: false });

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [draftRes, subRes] = await Promise.all([
        supabase.from('application_drafts').select('*, jobs(title, company, apply_url, source_url)').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('application_submissions').select('*, jobs(title, company, apply_url, source_url)').eq('user_id', user.id).order('submitted_at', { ascending: false }),
      ]);
      setDrafts(draftRes.data ?? []);
      setSubmissions(subRes.data ?? []);
      setLoading(false);
    };
    load();
  }, [user]);

  const getApplyUrl = (item: any) => {
    return item?.jobs?.apply_url || item?.jobs?.source_url || '';
  };

  const isLinkedInUrl = (url: string) => {
    return url.includes('linkedin.com');
  };

  const openApplyUrl = (url: string) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const markSubmitted = async () => {
    if (!user || !submitModal) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.from('application_submissions').insert({
        user_id: user.id,
        job_id: submitModal.job_id,
        draft_id: submitModal.id,
        submission_method: submitForm.method,
        outcome_notes: submitForm.notes,
        follow_up_date: submitForm.follow_up_date || null,
      }).select('*, jobs(title, company, apply_url, source_url)').single();
      if (error) throw error;

      await supabase.from('application_drafts').update({ status: 'submitted' }).eq('id', submitModal.id);

      await supabase.from('activity_log').insert({
        user_id: user.id,
        action: 'submitted_application',
        entity_type: 'application_submission',
        entity_id: data.id,
        details: { job_title: submitModal.jobs?.title, company: submitModal.jobs?.company },
      });

      setDrafts(drafts.map(d => d.id === submitModal.id ? { ...d, status: 'submitted' } : d));
      setSubmissions([data, ...submissions]);
      setSubmitModal(null);
      setSubmitForm({ method: 'manual', notes: '', follow_up_date: '' });
      setChecklist({ cv: false, coverLetter: false, applied: false });
      toast({ title: 'Application tracked as submitted!' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSubmitting(false);
  };

  const updateSubmissionStatus = async () => {
    if (!statusModal || !newStatus) return;
    const updates: any = { submission_status: newStatus, outcome_notes: outcomeNotes };
    if (newStatus === 'interview' || newStatus === 'offer' || newStatus === 'rejected') {
      updates.response_received_at = new Date().toISOString();
    }
    const { error } = await supabase.from('application_submissions').update(updates).eq('id', statusModal.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setSubmissions(submissions.map(s => s.id === statusModal.id ? { ...s, ...updates } : s));
      setStatusModal(null);
      toast({ title: 'Status updated' });
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'interview': case 'offer': return 'default' as const;
      case 'rejected': case 'withdrawn': return 'destructive' as const;
      default: return 'secondary' as const;
    }
  };

  const applyModeLabel = (mode: string) => {
    switch (mode) {
      case 'manual': return 'Manual Apply';
      case 'assisted': return 'Assisted';
      case 'auto_submit': return 'Auto Submit';
      default: return mode;
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Applications" description="Track your job applications — this is your personal CRM, not an auto-submitter" />

      {/* Info banner */}
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">How this works:</strong> This page tracks your applications. 
          "Mark as Submitted" records that you've applied — it does <strong>not</strong> submit on your behalf. 
          Use the <strong>Apply</strong> links to visit company portals or LinkedIn directly.
        </p>
      </div>

      <Tabs defaultValue="drafts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
          <TabsTrigger value="submitted">Submitted ({submissions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts">
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : drafts.length === 0 ? (
            <EmptyState icon={FileText} title="No drafts" description="Create application drafts from the Job Detail page." />
          ) : (
            <div className="space-y-3">
              {drafts.map(draft => {
                const Icon = statusIcons[draft.status] || Clock;
                const applyUrl = getApplyUrl(draft);
                const isLinkedin = isLinkedInUrl(applyUrl);
                return (
                  <Card key={draft.id}>
                    <CardContent className="py-4 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <Icon className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground">{draft.jobs?.title}</h3>
                        <p className="text-sm text-muted-foreground">{draft.jobs?.company}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Badge variant="outline" className="text-xs">{applyModeLabel(draft.apply_mode)}</Badge>
                        <Badge variant="secondary" className="text-xs capitalize">{(draft.status || '').replace('_', ' ')}</Badge>

                        {/* Apply URL buttons */}
                        {applyUrl && isLinkedin && (
                          <Button size="sm" variant="outline" className="text-blue-600 border-blue-200 hover:bg-blue-50" onClick={() => openApplyUrl(applyUrl)}>
                            <Linkedin className="w-3.5 h-3.5 mr-1" />LinkedIn Apply
                          </Button>
                        )}
                        {applyUrl && !isLinkedin && (
                          <Button size="sm" variant="outline" onClick={() => openApplyUrl(applyUrl)}>
                            <ExternalLink className="w-3.5 h-3.5 mr-1" />Apply on Portal
                          </Button>
                        )}

                        {draft.status !== 'submitted' && (
                          <Button size="sm" variant="default" onClick={() => {
                            setSubmitModal(draft);
                            setChecklist({ cv: false, coverLetter: false, applied: false });
                          }}>
                            <ClipboardCheck className="w-3.5 h-3.5 mr-1" />Track Submission
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="submitted">
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : submissions.length === 0 ? (
            <EmptyState icon={Send} title="No submissions tracked" description="After applying on a company portal, come back here to track the outcome." />
          ) : (
            <div className="space-y-3">
              {submissions.map(sub => {
                const applyUrl = getApplyUrl(sub);
                return (
                  <Card key={sub.id} className="cursor-pointer hover:border-primary/20 transition-colors" onClick={() => {
                    setStatusModal(sub);
                    setNewStatus(sub.submission_status);
                    setOutcomeNotes(sub.outcome_notes || '');
                  }}>
                    <CardContent className="py-4 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <Send className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground">{sub.jobs?.title}</h3>
                        <p className="text-sm text-muted-foreground">{sub.jobs?.company}</p>
                        {sub.submitted_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Applied {new Date(sub.submitted_at).toLocaleDateString()}
                            {sub.submission_method && ` via ${applyModeLabel(sub.submission_method)}`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {sub.follow_up_date && (
                          <Badge variant="outline" className="text-xs">
                            Follow up: {new Date(sub.follow_up_date).toLocaleDateString()}
                          </Badge>
                        )}
                        {applyUrl && (
                          <Button size="sm" variant="ghost" className="text-xs" onClick={(e) => { e.stopPropagation(); openApplyUrl(applyUrl); }}>
                            <ExternalLink className="w-3 h-3 mr-1" />Portal
                          </Button>
                        )}
                        <Badge variant={statusColor(sub.submission_status)} className="text-xs capitalize">
                          {(sub.submission_status || 'submitted').replace('_', ' ')}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Track Submission Modal */}
      <Dialog open={!!submitModal} onOpenChange={() => setSubmitModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Track Your Submission</DialogTitle>
            <DialogDescription>
              Record that you've applied to <strong>{submitModal?.jobs?.company}</strong> for <strong>{submitModal?.jobs?.title}</strong>. 
              This does not submit on your behalf — it's for your personal tracking.
            </DialogDescription>
          </DialogHeader>

          {/* Apply link shortcut */}
          {getApplyUrl(submitModal) && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
              {isLinkedInUrl(getApplyUrl(submitModal)) ? (
                <Linkedin className="w-4 h-4 text-blue-600 shrink-0" />
              ) : (
                <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm text-muted-foreground flex-1 truncate">
                {isLinkedInUrl(getApplyUrl(submitModal)) ? 'Apply via LinkedIn' : 'Apply on company portal'}
              </span>
              <Button size="sm" variant="outline" onClick={() => openApplyUrl(getApplyUrl(submitModal))}>
                Open Link
              </Button>
            </div>
          )}

          {/* Checklist */}
          <div className="space-y-3 p-3 rounded-lg bg-muted/30 border">
            <p className="text-sm font-medium text-foreground">Pre-submission checklist</p>
            <div className="flex items-center gap-2">
              <Checkbox id="cv-check" checked={checklist.cv} onCheckedChange={(v) => setChecklist({ ...checklist, cv: !!v })} />
              <label htmlFor="cv-check" className="text-sm text-muted-foreground cursor-pointer">Tailored CV is ready</label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="cl-check" checked={checklist.coverLetter} onCheckedChange={(v) => setChecklist({ ...checklist, coverLetter: !!v })} />
              <label htmlFor="cl-check" className="text-sm text-muted-foreground cursor-pointer">Cover letter is ready</label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="applied-check" checked={checklist.applied} onCheckedChange={(v) => setChecklist({ ...checklist, applied: !!v })} />
              <label htmlFor="applied-check" className="text-sm font-medium text-foreground cursor-pointer">I have applied on the portal / LinkedIn</label>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>How did you apply?</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={submitForm.method} onChange={e => setSubmitForm({ ...submitForm, method: e.target.value })}>
                <option value="manual">Manual — Applied on company portal</option>
                <option value="assisted">Assisted — System helped prepare materials</option>
                <option value="auto_submit">Auto Submit — System submitted for me</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Follow-up Reminder Date</Label>
              <Input type="date" value={submitForm.follow_up_date}
                onChange={e => setSubmitForm({ ...submitForm, follow_up_date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={submitForm.notes} rows={3}
                onChange={e => setSubmitForm({ ...submitForm, notes: e.target.value })}
                placeholder="Any notes — e.g. applied via email, contacted recruiter..." />
            </div>
            <Button onClick={markSubmitted} className="w-full" disabled={submitting || !checklist.applied}>
              {submitting ? 'Recording...' : !checklist.applied ? 'Check "I have applied" first' : 'Record Submission'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Status Update Modal */}
      <Dialog open={!!statusModal} onOpenChange={() => setStatusModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Status — {statusModal?.jobs?.title}</DialogTitle>
            <DialogDescription>Track the outcome of your application to {statusModal?.jobs?.company}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Current Status</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {Object.entries(submissionStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Outcome Notes</Label>
              <Textarea value={outcomeNotes} rows={3} onChange={e => setOutcomeNotes(e.target.value)}
                placeholder="Interview details, offer info, rejection reason..." />
            </div>
            {getApplyUrl(statusModal) && (
              <Button variant="outline" className="w-full" onClick={() => openApplyUrl(getApplyUrl(statusModal))}>
                <ExternalLink className="w-4 h-4 mr-2" />Open Job Portal
              </Button>
            )}
            <Button onClick={updateSubmissionStatus} className="w-full">Update Status</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Applications;
