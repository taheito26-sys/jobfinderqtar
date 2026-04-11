import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { FileText, Upload, Trash2, Star, StarOff, Loader2, Sparkles } from 'lucide-react';

const CVLibrary = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('master_documents').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data }) => { setDocuments(data ?? []); setLoading(false); });
  }, [user]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    const filePath = `${user.id}/${Date.now()}_${file.name}`;

    const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, file);
    if (uploadError) {
      toast({ title: 'Upload failed', description: uploadError.message, variant: 'destructive' });
      setUploading(false);
      return;
    }

    const { data, error } = await supabase.from('master_documents').insert({
      user_id: user.id,
      document_type: 'cv',
      title: file.name.replace(/\.[^.]+$/, ''),
      file_path: filePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      is_primary: documents.length === 0,
    }).select().single();

    if (data) {
      setDocuments([data, ...documents]);
      toast({ title: 'Document uploaded' });
    }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const parseCV = async (docId: string) => {
    setParsing(docId);
    try {
      const { data, error } = await supabase.functions.invoke('parse-cv', {
        body: { document_id: docId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setDocuments(documents.map(d => d.id === docId ? { ...d, parsed_content: data.parsed } : d));
      toast({ title: 'CV parsed!', description: 'Profile data extracted. Review in Profile tab.' });
    } catch (err: any) {
      toast({ title: 'Parse failed', description: err.message, variant: 'destructive' });
    }
    setParsing(null);
  };

  const deleteDoc = async (id: string, filePath: string) => {
    await supabase.storage.from('documents').remove([filePath]);
    await supabase.from('master_documents').delete().eq('id', id);
    setDocuments(documents.filter(d => d.id !== id));
    toast({ title: 'Document deleted' });
  };

  const togglePrimary = async (id: string) => {
    if (!user) return;
    await supabase.from('master_documents').update({ is_primary: false }).eq('user_id', user.id);
    await supabase.from('master_documents').update({ is_primary: true }).eq('id', id);
    setDocuments(documents.map(d => ({ ...d, is_primary: d.id === id })));
  };

  const hasParsedContent = (doc: any) => doc.parsed_content && Object.keys(doc.parsed_content).length > 0;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="CV Library"
        description="Upload and manage your master documents"
        actions={
          <>
            <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={handleUpload} />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload className="w-4 h-4 mr-2" />{uploading ? 'Uploading...' : 'Upload CV'}
            </Button>
          </>
        }
      />

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading...</p>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents uploaded"
          description="Upload your master CV to get started. This will be used as the basis for all tailored versions."
          actionLabel="Upload CV"
          onAction={() => fileInputRef.current?.click()}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map(doc => (
            <Card key={doc.id}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{doc.title}</h3>
                    <p className="text-xs text-muted-foreground">{doc.file_name}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {doc.is_primary && <Badge variant="default" className="text-xs">Primary</Badge>}
                      <Badge variant="outline" className="text-xs">{doc.document_type}</Badge>
                      {hasParsedContent(doc) && <Badge variant="secondary" className="text-xs">Parsed</Badge>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="ghost" size="sm" onClick={() => togglePrimary(doc.id)} title={doc.is_primary ? 'Unset primary' : 'Set as primary'}>
                    {doc.is_primary ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => parseCV(doc.id)} disabled={parsing === doc.id}>
                    {parsing === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteDoc(doc.id, doc.file_path)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default CVLibrary;
