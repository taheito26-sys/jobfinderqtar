import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Send, FileText, Clock, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

const statusIcons: Record<string, any> = {
  draft: Clock,
  ready_to_apply: FileText,
  approved: CheckCircle2,
  blocked: AlertTriangle,
  submitted: Send,
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

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [draftRes, subRes] = await Promise.all([
        supabase.from('application_drafts').select('*, jobs(title, company)').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('application_submissions').select('*, jobs(title, company)').eq('user_id', user.id).order('submitted_at', { ascending: false }),
      ]);
      setDrafts(draftRes.data ?? []);
      setSubmissions(subRes.data ?? []);
      setLoading(false);
    };
    load();
  }, [user]);

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
      }).select().single();
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
      toast({ title: 'Application submitted!' });
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

  return (
    <div className="animate-fade-in">
      <PageHeader title="Applications" description="Track your application lifecycle from draft to outcome" />

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
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize">{draft.apply_mode.replace('_', ' ')}</Badge>
                        <Badge variant="secondary" className="text-xs capitalize">{draft.status.replace('_', ' ')}</Badge>
                        {draft.status !== 'submitted' && (
                          <Button size="sm" variant="outline" onClick={() => setSubmitModal(draft)}>
                            <ArrowRight className="w-3 h-3 mr-1" />Submit
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
            <EmptyState icon={Send} title="No submissions" description="Submit approved applications to track their outcomes." />
          ) : (
            <div className="space-y-3">
              {submissions.map(sub => (
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
                    </div>
                    <div className="flex items-center gap-2">
                      {sub.follow_up_date && (
                        <span className="text-xs text-muted-foreground">Follow up: {sub.follow_up_date}</span>
                      )}
                      <Badge variant={statusColor(sub.submission_status)} className="text-xs capitalize">
                        {sub.submission_status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Submit Modal */}
      <Dialog open={!!submitModal} onOpenChange={() => setSubmitModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark as Submitted</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Submission Method</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={submitForm.method} onChange={e => setSubmitForm({ ...submitForm, method: e.target.value })}>
                <option value="manual">Manual</option>
                <option value="assisted">Assisted</option>
                <option value="auto_submit">Auto Submit</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Follow-up Date</Label>
              <Input type="date" value={submitForm.follow_up_date}
                onChange={e => setSubmitForm({ ...submitForm, follow_up_date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={submitForm.notes} rows={3}
                onChange={e => setSubmitForm({ ...submitForm, notes: e.target.value })}
                placeholder="Any notes about this submission..." />
            </div>
            <Button onClick={markSubmitted} className="w-full" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Confirm Submission'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Status Update Modal */}
      <Dialog open={!!statusModal} onOpenChange={() => setStatusModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Status — {statusModal?.jobs?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                <option value="submitted">Submitted</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="interview">Interview</option>
                <option value="offer">Offer</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="no_response">No Response</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Outcome Notes</Label>
              <Textarea value={outcomeNotes} rows={3} onChange={e => setOutcomeNotes(e.target.value)}
                placeholder="Interview details, offer info, rejection reason..." />
            </div>
            <Button onClick={updateSubmissionStatus} className="w-full">Update Status</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Applications;
