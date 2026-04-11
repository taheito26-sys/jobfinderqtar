import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {
  GitCompare, CheckCircle2, AlertTriangle, Eye, ThumbsUp, ThumbsDown, X,
  FileText, Mail, Download, Loader2, MoreVertical, Copy, Trash2, RefreshCw,
  Pencil, CheckCheck, ExternalLink
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const TailoringReview = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [retailoring, setRetailoring] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'cv' | 'cover_letter'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'needs_revision'>('all');
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('tailored_documents').select('*, jobs(id, title, company)').eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setDocuments(data ?? []); setLoading(false); });
  }, [user]);

  const filtered = documents
    .filter(d => filter === 'all' || d.document_type === filter)
    .filter(d => statusFilter === 'all' || d.approval_status === statusFilter);

  const updateApproval = async (id: string, status: string) => {
    const updates: any = { approval_status: status };
    if (status === 'approved') updates.approved_at = new Date().toISOString();

    const { error } = await supabase.from('tailored_documents').update(updates).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setDocuments(documents.map(d => d.id === id ? { ...d, ...updates } : d));
      if (selected?.id === id) setSelected({ ...selected, ...updates });
      toast({ title: status === 'approved' ? 'Document approved ✓' : status === 'rejected' ? 'Document rejected' : 'Status updated' });

      if (user) {
        await supabase.from('activity_log').insert({
          user_id: user.id, action: `${status}_document`, entity_type: 'tailored_document', entity_id: id,
        });
      }
    }
  };

  const bulkApprove = async () => {
    const pendingDocs = filtered.filter(d => d.approval_status === 'pending' && !(d.unsupported_claims as any[])?.length);
    if (!pendingDocs.length) {
      toast({ title: 'Nothing to approve', description: 'No pending documents without flags.' });
      return;
    }
    for (const doc of pendingDocs) {
      await updateApproval(doc.id, 'approved');
    }
    toast({ title: `${pendingDocs.length} documents approved` });
  };

  const downloadDocument = async (docId: string, format: 'pdf' | 'docx') => {
    setDownloading(`${docId}-${format}`);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const session = (await supabase.auth.getSession()).data.session;

      const response = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ document_id: docId, format }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await response.json();
        if (json.error) throw new Error(json.error);
      } else {
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
        const fileName = filenameMatch?.[1] || `document.${format}`;

        const url = URL.createObjectURL(blob);
        const a = window.document.createElement('a');
        a.href = url;
        a.download = fileName;
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      toast({ title: `${format.toUpperCase()} downloaded` });
    } catch (err: any) {
      toast({ title: 'Download failed', description: err.message, variant: 'destructive' });
    }
    setDownloading(null);
  };

  const reTailor = async (doc: any) => {
    if (!doc.jobs?.id) {
      toast({ title: 'Cannot re-tailor', description: 'Job reference missing.', variant: 'destructive' });
      return;
    }
    setRetailoring(doc.id);
    try {
      const { data, error } = await supabase.functions.invoke('tailor-cv', {
        body: { job_id: doc.jobs.id, document_type: doc.document_type },
      });
      if (error) throw error;
      if (data?.error || data?.fallback) {
        toast({ title: 'AI busy', description: data.error || 'Rate limited, try again shortly.', variant: 'destructive' });
        return;
      }
      toast({ title: 'New version created!', description: 'A fresh tailored document has been generated.' });
      // Refresh list
      const { data: refreshed } = await supabase.from('tailored_documents').select('*, jobs(id, title, company)').eq('user_id', user!.id).order('created_at', { ascending: false });
      setDocuments(refreshed ?? []);
    } catch (err: any) {
      toast({ title: 'Re-tailor failed', description: err.message, variant: 'destructive' });
    }
    setRetailoring(null);
  };

  const copyToClipboard = async (doc: any) => {
    let text = '';
    const content = doc.content;
    if (doc.document_type === 'cover_letter') {
      text = typeof content === 'string' ? content : content.letter_text || content.content || JSON.stringify(content, null, 2);
    } else {
      const parts: string[] = [];
      if (content.summary) parts.push(`SUMMARY\n${content.summary}`);
      if (content.experience?.length) {
        parts.push('EXPERIENCE');
        content.experience.forEach((exp: any) => {
          parts.push(`${exp.title} at ${exp.company} (${exp.start_date} — ${exp.is_current ? 'Present' : exp.end_date || 'N/A'})`);
          exp.highlights?.forEach((h: string) => parts.push(`  • ${h}`));
        });
      }
      if (content.skills?.length) parts.push(`\nSKILLS\n${content.skills.join(', ')}`);
      text = parts.join('\n');
    }
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const deleteDocument = async (id: string) => {
    const { error } = await supabase.from('tailored_documents').delete().eq('id', id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    } else {
      setDocuments(documents.filter(d => d.id !== id));
      if (selected?.id === id) setSelected(null);
      toast({ title: 'Document deleted' });
    }
    setDeleteConfirm(null);
  };

  const saveEditedContent = async () => {
    if (!editingContent) return;
    try {
      const parsed = JSON.parse(editText);
      const { error } = await supabase.from('tailored_documents').update({ content: parsed }).eq('id', editingContent);
      if (error) throw error;
      setDocuments(documents.map(d => d.id === editingContent ? { ...d, content: parsed } : d));
      if (selected?.id === editingContent) setSelected({ ...selected, content: parsed });
      toast({ title: 'Content updated' });
      setEditingContent(null);
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message?.includes('JSON') ? 'Invalid JSON format' : err.message, variant: 'destructive' });
    }
  };

  const openEditDialog = (doc: any) => {
    setEditingContent(doc.id);
    setEditText(JSON.stringify(doc.content, null, 2));
  };

  const goToJob = (doc: any) => {
    if (doc.jobs?.id) navigate(`/jobs/${doc.jobs.id}`);
  };

  const statusVariant = (s: string) => {
    switch (s) {
      case 'approved': return 'default' as const;
      case 'pending': return 'secondary' as const;
      case 'rejected': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  const cvCount = documents.filter(d => d.document_type === 'cv').length;
  const clCount = documents.filter(d => d.document_type === 'cover_letter').length;
  const pendingCount = filtered.filter(d => d.approval_status === 'pending' && !(d.unsupported_claims as any[])?.length).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Tailoring Review"
        description="Review side-by-side diffs, resolve unsupported claims, and approve documents"
      />

      {!loading && documents.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
              <TabsList>
                <TabsTrigger value="all">All ({documents.length})</TabsTrigger>
                <TabsTrigger value="cv" className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />CVs ({cvCount})
                </TabsTrigger>
                <TabsTrigger value="cover_letter" className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />Letters ({clCount})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <TabsList>
                <TabsTrigger value="all">Any Status</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="approved">Approved</TabsTrigger>
                <TabsTrigger value="needs_revision">Flagged</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {pendingCount > 0 && (
            <Button size="sm" variant="outline" onClick={bulkApprove} className="flex items-center gap-1.5">
              <CheckCheck className="w-4 h-4" />Approve All Clean ({pendingCount})
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={GitCompare}
          title="No tailored documents"
          description="Select a job from the Job Feed and click 'Tailor CV' or 'Generate Cover Letter' to create job-specific versions."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(doc => (
            <Card key={doc.id} className="hover:border-primary/20 transition-colors">
              <CardContent className="py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  {doc.document_type === 'cover_letter'
                    ? <Mail className="w-5 h-5 text-muted-foreground" />
                    : <FileText className="w-5 h-5 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground truncate">
                    {doc.document_type === 'cv' ? 'Tailored CV' : 'Cover Letter'} — {doc.jobs?.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{doc.jobs?.company || 'Unknown Company'} • v{doc.version}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(doc.unsupported_claims as any[])?.length > 0 && (
                    <Badge variant="destructive" className="text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />{(doc.unsupported_claims as any[]).length} flags
                    </Badge>
                  )}
                  <Badge variant={statusVariant(doc.approval_status)} className="capitalize text-xs">
                    {doc.approval_status?.replace('_', ' ') || 'pending'}
                  </Badge>

                  {/* Quick actions */}
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(doc)} title="Copy to clipboard">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => downloadDocument(doc.id, 'pdf')} disabled={downloading === `${doc.id}-pdf`} title="Download PDF">
                    {downloading === `${doc.id}-pdf` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(doc)} title="Preview">
                    <Eye className="w-4 h-4" />
                  </Button>

                  {/* More actions dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm"><MoreVertical className="w-4 h-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => goToJob(doc)}>
                        <ExternalLink className="w-4 h-4 mr-2" />View Job
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => reTailor(doc)} disabled={retailoring === doc.id}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${retailoring === doc.id ? 'animate-spin' : ''}`} />
                        {retailoring === doc.id ? 'Re-tailoring...' : 'Re-tailor (New Version)'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEditDialog(doc)}>
                        <Pencil className="w-4 h-4 mr-2" />Edit Content
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => downloadDocument(doc.id, 'docx')} disabled={downloading === `${doc.id}-docx`}>
                        <Download className="w-4 h-4 mr-2" />Download DOCX
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {doc.approval_status !== 'approved' && !(doc.unsupported_claims as any[])?.length && (
                        <DropdownMenuItem onClick={() => updateApproval(doc.id, 'approved')}>
                          <ThumbsUp className="w-4 h-4 mr-2" />Approve
                        </DropdownMenuItem>
                      )}
                      {doc.approval_status !== 'rejected' && (
                        <DropdownMenuItem onClick={() => updateApproval(doc.id, 'rejected')}>
                          <ThumbsDown className="w-4 h-4 mr-2" />Reject
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setDeleteConfirm(doc.id)} className="text-destructive focus:text-destructive">
                        <Trash2 className="w-4 h-4 mr-2" />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
              {selected?.document_type === 'cover_letter'
                ? <Mail className="w-5 h-5" />
                : <FileText className="w-5 h-5" />}
              {selected?.document_type === 'cv' ? 'Tailored CV' : 'Cover Letter'} — {selected?.jobs?.title}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-6">
              {/* Status & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(selected.approval_status)} className="capitalize">
                    {selected.approval_status?.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    v{selected.version} • {new Date(selected.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => copyToClipboard(selected)}>
                    <Copy className="w-4 h-4 mr-1" />Copy
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEditDialog(selected)}>
                    <Pencil className="w-4 h-4 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => reTailor(selected)} disabled={retailoring === selected.id}>
                    {retailoring === selected.id
                      ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      : <RefreshCw className="w-4 h-4 mr-1" />}
                    Re-tailor
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadDocument(selected.id, 'pdf')} disabled={downloading === `${selected.id}-pdf`}>
                    {downloading === `${selected.id}-pdf` ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadDocument(selected.id, 'docx')} disabled={downloading === `${selected.id}-docx`}>
                    {downloading === `${selected.id}-docx` ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}DOCX
                  </Button>
                  {selected.approval_status !== 'approved' && (
                    <Button size="sm" onClick={() => updateApproval(selected.id, 'approved')} disabled={(selected.unsupported_claims as any[])?.length > 0}>
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

              {/* Content Display */}
              {selected.document_type === 'cover_letter' ? (
                <CoverLetterView content={selected.content} />
              ) : (
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
                      <TailoredCVView content={selected.content} />
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Content Dialog */}
      <Dialog open={!!editingContent} onOpenChange={() => setEditingContent(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="w-5 h-5" />Edit Document Content</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="min-h-[400px] font-mono text-xs"
            placeholder="JSON content..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingContent(null)}>Cancel</Button>
            <Button onClick={saveEditedContent}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="w-5 h-5" />Delete Document</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This action cannot be undone. The tailored document will be permanently removed.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteDocument(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const CoverLetterView = ({ content }: { content: any }) => {
  if (!content) return null;
  const text = typeof content === 'string' ? content : content.letter_text || content.content || JSON.stringify(content, null, 2);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Mail className="w-4 h-4" />Cover Letter</CardTitle></CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap leading-relaxed">{text}</div>
      </CardContent>
    </Card>
  );
};

const TailoredCVView = ({ content }: { content: any }) => {
  if (!content) return null;

  if (content.summary || content.experience || content.skills) {
    return (
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {content.summary && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Summary</h4>
            <p className="text-sm text-foreground">{content.summary}</p>
          </div>
        )}
        {content.experience?.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Experience</h4>
            <div className="space-y-3">
              {content.experience.map((exp: any, i: number) => (
                <div key={i} className="border-l-2 border-primary/20 pl-3">
                  <p className="text-sm font-medium text-foreground">{exp.title} at {exp.company}</p>
                  <p className="text-xs text-muted-foreground">{exp.start_date} — {exp.is_current ? 'Present' : exp.end_date || 'N/A'}</p>
                  {exp.highlights?.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {exp.highlights.map((h: string, j: number) => (
                        <li key={j} className="text-xs text-foreground">• {h}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {content.skills?.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Skills</h4>
            <div className="flex flex-wrap gap-1">
              {content.skills.map((skill: string, i: number) => (
                <Badge key={i} variant="outline" className="text-xs">{skill}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <pre className="text-xs text-foreground whitespace-pre-wrap font-mono bg-muted p-3 rounded-md max-h-96 overflow-y-auto">
      {JSON.stringify(content, null, 2)}
    </pre>
  );
};

export default TailoringReview;
