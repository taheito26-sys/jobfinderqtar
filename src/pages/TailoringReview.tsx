import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { GitCompare, CheckCircle2, AlertTriangle, Eye, ThumbsUp, ThumbsDown, X } from 'lucide-react';

const TailoringReview = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('tailored_documents').select('*, jobs(title, company)').eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setDocuments(data ?? []); setLoading(false); });
  }, [user]);

  const updateApproval = async (id: string, status: string) => {
    const updates: any = { approval_status: status };
    if (status === 'approved') updates.approved_at = new Date().toISOString();

    const { error } = await supabase.from('tailored_documents').update(updates).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setDocuments(documents.map(d => d.id === id ? { ...d, ...updates } : d));
      if (selected?.id === id) setSelected({ ...selected, ...updates });
      toast({ title: status === 'approved' ? 'Document approved' : 'Document rejected' });

      if (user) {
        await supabase.from('activity_log').insert({
          user_id: user.id,
          action: `${status}_document`,
          entity_type: 'tailored_document',
          entity_id: id,
        });
      }
    }
  };

  const statusVariant = (s: string) => {
    switch (s) {
      case 'approved': return 'default' as const;
      case 'pending': return 'secondary' as const;
      case 'rejected': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Tailoring Review"
        description="Review side-by-side diffs, resolve unsupported claims, and approve documents"
      />

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading...</p>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={GitCompare}
          title="No tailored documents"
          description="Select a job from the Job Feed and click 'Tailor CV' to generate job-specific versions."
        />
      ) : (
        <div className="space-y-3">
          {documents.map(doc => (
            <Card key={doc.id} className="hover:border-primary/20 transition-colors">
              <CardContent className="py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <GitCompare className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground">
                    {doc.document_type === 'cv' ? 'Tailored CV' : 'Cover Letter'} — {doc.jobs?.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{doc.jobs?.company} • v{doc.version}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(doc.unsupported_claims as any[])?.length > 0 && (
                    <Badge variant="destructive" className="text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />{(doc.unsupported_claims as any[]).length} flags
                    </Badge>
                  )}
                  <Badge variant={statusVariant(doc.approval_status)} className="capitalize text-xs">
                    {doc.approval_status.replace('_', ' ')}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(doc)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail / Diff Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="w-5 h-5" />
              {selected?.document_type === 'cv' ? 'Tailored CV' : 'Cover Letter'} — {selected?.jobs?.title}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-6">
              {/* Status & Actions */}
              <div className="flex items-center justify-between">
                <Badge variant={statusVariant(selected.approval_status)} className="capitalize">
                  {selected.approval_status.replace('_', ' ')}
                </Badge>
                <div className="flex gap-2">
                  {selected.approval_status !== 'approved' && (
                    <Button
                      size="sm"
                      onClick={() => updateApproval(selected.id, 'approved')}
                      disabled={(selected.unsupported_claims as any[])?.length > 0}
                    >
                      <ThumbsUp className="w-4 h-4 mr-1" />Approve
                    </Button>
                  )}
                  {selected.approval_status !== 'rejected' && (
                    <Button size="sm" variant="destructive" onClick={() => updateApproval(selected.id, 'rejected')}>
                      <ThumbsDown className="w-4 h-4 mr-1" />Reject
                    </Button>
                  )}
                </div>
              </div>

              {/* Unsupported Claims Warning */}
              {(selected.unsupported_claims as any[])?.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                      <AlertTriangle className="w-4 h-4" />Unsupported Claims — Must resolve before approval
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {(selected.unsupported_claims as string[]).map((claim, i) => (
                        <li key={i} className="text-sm text-destructive flex items-start gap-2">
                          <X className="w-3 h-3 mt-0.5 flex-shrink-0" />{claim}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Changes Summary */}
              {(selected.changes_summary as any[])?.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" />Changes Made</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {(selected.changes_summary as string[]).map((change, i) => (
                        <li key={i} className="text-sm text-foreground flex items-start gap-2">
                          <span className="text-score-excellent mt-0.5">→</span>{change}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Side-by-side Content */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm text-muted-foreground">Original</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted p-3 rounded-md max-h-96 overflow-y-auto">
                      {JSON.stringify(selected.original_content, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm text-primary">Tailored</CardTitle></CardHeader>
                  <CardContent>
                    <pre className="text-xs text-foreground whitespace-pre-wrap font-mono bg-muted p-3 rounded-md max-h-96 overflow-y-auto">
                      {JSON.stringify(selected.content, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TailoringReview;
