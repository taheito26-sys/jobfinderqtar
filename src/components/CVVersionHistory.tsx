import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { History, Upload, Loader2, ArrowLeftRight, Clock, FileText, ChevronRight, Plus, Minus, Equal } from 'lucide-react';

interface CVVersionHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: any;
  userId: string;
  onVersionRestored: (updated: any) => void;
}

interface Version {
  id: string;
  version_number: number;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  parsed_content: any;
  change_notes: string;
  created_at: string;
}

const CVVersionHistory = ({ open, onOpenChange, document, userId, onVersionRestored }: CVVersionHistoryProps) => {
  const { toast } = useToast();
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && document) loadVersions();
  }, [open, document]);

  const loadVersions = async () => {
    if (!document) return;
    setLoading(true);
    const { data } = await supabase
      .from('document_versions')
      .select('*')
      .eq('document_id', document.id)
      .order('version_number', { ascending: false });
    setVersions((data as Version[]) || []);
    setLoading(false);
  };

  const handleUploadVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !document) return;
    setUploading(true);
    try {
      // Save current version as snapshot first
      const currentVersion = (versions[0]?.version_number || document.version || 0) + 1;
      
      // Snapshot current state
      await supabase.from('document_versions').insert({
        document_id: document.id,
        user_id: userId,
        version_number: document.version || 1,
        file_path: document.file_path,
        file_name: document.file_name,
        file_size: document.file_size || 0,
        mime_type: document.mime_type || '',
        parsed_content: document.parsed_content || {},
        change_notes: 'Snapshot before version ' + currentVersion,
      });

      // Upload new file
      const filePath = `${userId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, file);
      if (uploadError) throw uploadError;

      // Update master document
      const { error: updateError } = await supabase
        .from('master_documents')
        .update({
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          version: currentVersion,
          parsed_content: {}, // Reset parsed content for new version
        })
        .eq('id', document.id);
      if (updateError) throw updateError;

      onVersionRestored({
        ...document,
        file_path: filePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        version: currentVersion,
        parsed_content: {},
      });

      toast({ title: 'New version uploaded!', description: `Version ${currentVersion} saved. Parse it to extract content.` });
      await loadVersions();
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const restoreVersion = async (version: Version) => {
    if (!document) return;
    try {
      // Save current as snapshot
      const nextVersion = (document.version || 1) + 1;
      await supabase.from('document_versions').insert({
        document_id: document.id,
        user_id: userId,
        version_number: document.version || 1,
        file_path: document.file_path,
        file_name: document.file_name,
        file_size: document.file_size || 0,
        parsed_content: document.parsed_content || {},
        change_notes: `Snapshot before restoring v${version.version_number}`,
      });

      // Restore
      const { error } = await supabase
        .from('master_documents')
        .update({
          file_path: version.file_path,
          file_name: version.file_name,
          file_size: version.file_size,
          parsed_content: version.parsed_content,
          version: nextVersion,
        })
        .eq('id', document.id);
      if (error) throw error;

      onVersionRestored({
        ...document,
        file_path: version.file_path,
        file_name: version.file_name,
        file_size: version.file_size,
        parsed_content: version.parsed_content,
        version: nextVersion,
      });
      toast({ title: 'Version restored!', description: `Restored to v${version.version_number} as new v${nextVersion}.` });
      await loadVersions();
    } catch (err: any) {
      toast({ title: 'Restore failed', description: err.message, variant: 'destructive' });
    }
  };

  // Diff helper
  const getDiff = (a: any, b: any) => {
    const changes: { field: string; type: 'added' | 'removed' | 'changed' | 'same'; oldVal?: string; newVal?: string }[] = [];
    const fields = ['full_name', 'headline', 'summary', 'email', 'phone', 'location'];
    for (const f of fields) {
      const va = a?.[f] || '';
      const vb = b?.[f] || '';
      if (va !== vb) changes.push({ field: f, type: va ? (vb ? 'changed' : 'removed') : 'added', oldVal: va, newVal: vb });
      else if (va) changes.push({ field: f, type: 'same', oldVal: va, newVal: vb });
    }
    const arrFields = [
      { key: 'skills', label: 'Skills' },
      { key: 'employment', label: 'Experience' },
      { key: 'education', label: 'Education' },
      { key: 'certifications', label: 'Certifications' },
    ];
    for (const { key, label } of arrFields) {
      const ca = (a?.[key] || []).length;
      const cb = (b?.[key] || []).length;
      if (ca !== cb) changes.push({ field: label, type: 'changed', oldVal: `${ca} items`, newVal: `${cb} items` });
      else changes.push({ field: label, type: 'same', oldVal: `${ca} items`, newVal: `${cb} items` });
    }
    return changes;
  };

  const versionA = compareA !== null ? versions.find(v => v.version_number === compareA) : null;
  const versionB = compareB !== null ? versions.find(v => v.version_number === compareB) : null;

  // Include current version in selectable list
  const allVersionOptions = [
    { version_number: document?.version || 1, label: `v${document?.version || 1} (current)` },
    ...versions.map(v => ({ version_number: v.version_number, label: `v${v.version_number}` })),
  ];

  const getContentForVersion = (num: number) => {
    if (num === (document?.version || 1)) return document?.parsed_content;
    return versions.find(v => v.version_number === num)?.parsed_content;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Version History — {document?.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={handleUploadVersion} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload New Version
          </Button>
          <Button
            variant={compareMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setCompareMode(!compareMode); setCompareA(null); setCompareB(null); }}
            className="gap-2"
          >
            <ArrowLeftRight className="w-4 h-4" />
            {compareMode ? 'Exit Compare' : 'Compare'}
          </Button>
        </div>

        {/* Compare View */}
        {compareMode && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="flex items-center gap-3">
              <select
                className="flex-1 h-8 rounded-md border bg-background px-2 text-sm"
                value={compareA ?? ''}
                onChange={e => setCompareA(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select version A</option>
                {allVersionOptions.map(v => (
                  <option key={v.version_number} value={v.version_number}>{v.label}</option>
                ))}
              </select>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
              <select
                className="flex-1 h-8 rounded-md border bg-background px-2 text-sm"
                value={compareB ?? ''}
                onChange={e => setCompareB(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select version B</option>
                {allVersionOptions.map(v => (
                  <option key={v.version_number} value={v.version_number}>{v.label}</option>
                ))}
              </select>
            </div>
            {compareA !== null && compareB !== null && (
              <div className="space-y-2">
                {getDiff(getContentForVersion(compareA), getContentForVersion(compareB)).map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {d.type === 'added' && <Plus className="w-3 h-3 text-score-excellent" />}
                    {d.type === 'removed' && <Minus className="w-3 h-3 text-destructive" />}
                    {d.type === 'changed' && <ArrowLeftRight className="w-3 h-3 text-primary" />}
                    {d.type === 'same' && <Equal className="w-3 h-3 text-muted-foreground" />}
                    <span className="font-medium capitalize">{d.field}:</span>
                    {d.type === 'same' ? (
                      <span className="text-muted-foreground truncate">{d.oldVal}</span>
                    ) : (
                      <span className="truncate">
                        {d.oldVal && <span className="line-through text-muted-foreground mr-2">{d.oldVal}</span>}
                        {d.newVal && <span className="text-foreground">{d.newVal}</span>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Version Timeline */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {/* Current Version */}
          <div className="flex items-center gap-3 p-3 rounded-lg border-2 border-primary/30 bg-primary/5">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
              v{document?.version || 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{document?.file_name}</span>
                <Badge variant="default" className="text-[10px]">Current</Badge>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />{new Date(document?.updated_at || document?.created_at).toLocaleDateString()}
                {document?.file_size && <span>• {Math.round(document.file_size / 1024)} KB</span>}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">No previous versions. Upload a new version to start tracking history.</p>
          ) : (
            versions.map(v => (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs font-bold">
                  v{v.version_number}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{v.file_name}</span>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />{new Date(v.created_at).toLocaleDateString()}
                    {v.file_size > 0 && <span>• {Math.round(v.file_size / 1024)} KB</span>}
                    {v.change_notes && <span>• {v.change_notes}</span>}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => restoreVersion(v)} className="text-xs">
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CVVersionHistory;
