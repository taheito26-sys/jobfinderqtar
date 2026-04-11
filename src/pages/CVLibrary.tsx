import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { FileText, Upload, Trash2, Star, StarOff, Loader2, Sparkles, UserPlus, CheckCircle2, Eye, History, Palette, Download, Pencil } from 'lucide-react';
import CVTemplateSelector from '@/components/CVTemplateSelector';
import CVContentEditor from '@/components/CVContentEditor';
import CVVersionHistory from '@/components/CVVersionHistory';

const CVLibrary = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState<string | null>(null);
  const [importDoc, setImportDoc] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState('classic');
  const [templateDoc, setTemplateDoc] = useState<any>(null);
  const [editorDoc, setEditorDoc] = useState<any>(null);
  const [versionDoc, setVersionDoc] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('master_documents').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data }) => { setDocuments(data ?? []); setLoading(false); });
  }, [user]);

  const autoParseAndImport = async (doc: any) => {
    if (!user) return;
    setParsing(doc.id);
    try {
      const { data, error } = await supabase.functions.invoke('parse-cv', { body: { document_id: doc.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const p = data.parsed;
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, parsed_content: p } : d));

      // Auto-import to profile — merge/delta approach (never wipe existing data)
      const profileUpdate: any = {};
      if (p.full_name) profileUpdate.full_name = p.full_name;
      if (p.headline) profileUpdate.headline = p.headline;
      if (p.summary) profileUpdate.summary = p.summary;
      if (p.email) profileUpdate.email = p.email;
      if (p.phone) profileUpdate.phone = p.phone;
      if (p.location) profileUpdate.location = p.location;
      if (p.country) profileUpdate.country = p.country;
      if (Array.isArray(p.desired_titles) && p.desired_titles.length > 0) {
        // Merge desired titles with existing ones
        const { data: existingProfile } = await supabase.from('profiles_v2').select('desired_titles').eq('user_id', user.id).maybeSingle();
        const existingTitles: string[] = Array.isArray(existingProfile?.desired_titles) ? existingProfile.desired_titles as string[] : [];
        const mergedTitles = [...new Set([...existingTitles, ...p.desired_titles])];
        profileUpdate.desired_titles = mergedTitles;
      }
      if (Object.keys(profileUpdate).length > 0) {
        await supabase.from('profiles_v2').upsert({ user_id: user.id, ...profileUpdate }, { onConflict: 'user_id' });
      }

      // Fetch existing data to compute delta
      const [existingSkills, existingEmp, existingEdu, existingCerts] = await Promise.all([
        supabase.from('profile_skills').select('skill_name').eq('user_id', user.id),
        supabase.from('employment_history').select('title, company').eq('user_id', user.id),
        supabase.from('education_history').select('degree, institution').eq('user_id', user.id),
        supabase.from('certifications').select('name, issuing_organization').eq('user_id', user.id),
      ]);
      const existingSkillNames = new Set((existingSkills.data ?? []).map((s: any) => s.skill_name.toLowerCase()));
      const existingEmpKeys = new Set((existingEmp.data ?? []).map((e: any) => `${e.title}|||${e.company}`.toLowerCase()));
      const existingEduKeys = new Set((existingEdu.data ?? []).map((e: any) => `${e.degree}|||${e.institution}`.toLowerCase()));
      const existingCertKeys = new Set((existingCerts.data ?? []).map((c: any) => `${c.name}|||${c.issuing_organization}`.toLowerCase()));

      if (Array.isArray(p.skills) && p.skills.length > 0) {
        const newSkills = p.skills.filter((s: string) => !existingSkillNames.has(s.toLowerCase()));
        if (newSkills.length > 0) {
          await supabase.from('profile_skills').insert(newSkills.map((s: string) => ({ user_id: user.id, skill_name: s })));
        }
      }

      if (Array.isArray(p.employment) && p.employment.length > 0) {
        const newEmp = p.employment.filter((e: any) => !existingEmpKeys.has(`${e.title || 'Untitled'}|||${e.company || 'Unknown'}`.toLowerCase()));
        if (newEmp.length > 0) {
          await supabase.from('employment_history').insert(newEmp.map((e: any, i: number) => ({
            user_id: user.id, title: e.title || 'Untitled', company: e.company || 'Unknown',
            location: e.location || '', start_date: e.start_date || '2020-01-01',
            end_date: e.end_date || null, is_current: e.is_current || false,
            description: e.description || '', achievements: Array.isArray(e.achievements) ? e.achievements : [], sort_order: i,
          })));
        }
      }

      if (Array.isArray(p.education) && p.education.length > 0) {
        const newEdu = p.education.filter((e: any) => !existingEduKeys.has(`${e.degree || 'Degree'}|||${e.institution || 'Institution'}`.toLowerCase()));
        if (newEdu.length > 0) {
          await supabase.from('education_history').insert(newEdu.map((e: any, i: number) => ({
            user_id: user.id, degree: e.degree || 'Degree', institution: e.institution || 'Institution',
            field_of_study: e.field_of_study || '', start_date: e.start_date || null, end_date: e.end_date || null, sort_order: i,
          })));
        }
      }

      if (Array.isArray(p.certifications) && p.certifications.length > 0) {
        const newCerts = p.certifications.filter((c: any) => !existingCertKeys.has(`${c.name || 'Certification'}|||${c.issuing_organization || 'Unknown'}`.toLowerCase()));
        if (newCerts.length > 0) {
          await supabase.from('certifications').insert(newCerts.map((c: any) => ({
            user_id: user.id, name: c.name || 'Certification', issuing_organization: c.issuing_organization || 'Unknown', issue_date: c.issue_date || null,
          })));
        }
      }

      await supabase.from('activity_log').insert({
        user_id: user.id, action: 'auto_imported_cv_to_profile', entity_type: 'master_document', entity_id: doc.id,
      });

      toast({ title: 'Profile auto-populated!', description: 'Your CV was parsed and profile fields have been filled. Visit Profile to review.' });
    } catch (err: any) {
      toast({ title: 'Auto-extraction failed', description: err.message + ' — You can retry manually.', variant: 'destructive' });
    }
    setParsing(null);
  };

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
      user_id: user.id, document_type: 'cv', title: file.name.replace(/\.[^.]+$/, ''),
      file_path: filePath, file_name: file.name, file_size: file.size, mime_type: file.type,
      is_primary: documents.length === 0,
    }).select().single();
    if (data) {
      setDocuments([data, ...documents]);
      toast({ title: 'Document uploaded — now extracting profile...', description: 'AI is parsing your CV to auto-fill your profile.' });
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Auto-parse and import
      await autoParseAndImport(data);
    } else {
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const parseCV = async (docId: string) => {
    setParsing(docId);
    try {
      const { data, error } = await supabase.functions.invoke('parse-cv', { body: { document_id: docId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDocuments(documents.map(d => d.id === docId ? { ...d, parsed_content: data.parsed } : d));
      toast({ title: 'CV parsed!', description: 'Click "Import to Profile" to populate your profile.' });
    } catch (err: any) {
      toast({ title: 'Parse failed', description: err.message, variant: 'destructive' });
    }
    setParsing(null);
  };

  const importToProfile = async () => {
    if (!user || !importDoc?.parsed_content) return;
    setImporting(true);
    const p = importDoc.parsed_content;

    try {
      // Upsert profile basics — merge desired_titles
      const profileUpdate: any = {};
      if (p.full_name) profileUpdate.full_name = p.full_name;
      if (p.headline) profileUpdate.headline = p.headline;
      if (p.summary) profileUpdate.summary = p.summary;
      if (p.email) profileUpdate.email = p.email;
      if (p.phone) profileUpdate.phone = p.phone;
      if (p.location) profileUpdate.location = p.location;
      if (p.country) profileUpdate.country = p.country;
      if (Array.isArray(p.desired_titles) && p.desired_titles.length > 0) {
        const { data: existingProfile } = await supabase.from('profiles_v2').select('desired_titles').eq('user_id', user.id).maybeSingle();
        const existingTitles: string[] = Array.isArray(existingProfile?.desired_titles) ? existingProfile.desired_titles as string[] : [];
        profileUpdate.desired_titles = [...new Set([...existingTitles, ...p.desired_titles])];
      }
      if (Object.keys(profileUpdate).length > 0) {
        await supabase.from('profiles_v2').upsert({ user_id: user.id, ...profileUpdate }, { onConflict: 'user_id' });
      }

      // Fetch existing data for delta detection
      const [existingSkills, existingEmp, existingEdu, existingCerts] = await Promise.all([
        supabase.from('profile_skills').select('skill_name').eq('user_id', user.id),
        supabase.from('employment_history').select('title, company').eq('user_id', user.id),
        supabase.from('education_history').select('degree, institution').eq('user_id', user.id),
        supabase.from('certifications').select('name, issuing_organization').eq('user_id', user.id),
      ]);
      const existingSkillNames = new Set((existingSkills.data ?? []).map((s: any) => s.skill_name.toLowerCase()));
      const existingEmpKeys = new Set((existingEmp.data ?? []).map((e: any) => `${e.title}|||${e.company}`.toLowerCase()));
      const existingEduKeys = new Set((existingEdu.data ?? []).map((e: any) => `${e.degree}|||${e.institution}`.toLowerCase()));
      const existingCertKeys = new Set((existingCerts.data ?? []).map((c: any) => `${c.name}|||${c.issuing_organization}`.toLowerCase()));

      // Import only new skills
      if (Array.isArray(p.skills) && p.skills.length > 0) {
        const newSkills = p.skills.filter((s: string) => !existingSkillNames.has(s.toLowerCase()));
        if (newSkills.length > 0) {
          await supabase.from('profile_skills').insert(newSkills.map((s: string) => ({ user_id: user.id, skill_name: s })));
        }
      }

      // Import only new employment
      if (Array.isArray(p.employment) && p.employment.length > 0) {
        const newEmp = p.employment.filter((e: any) => !existingEmpKeys.has(`${e.title || 'Untitled'}|||${e.company || 'Unknown'}`.toLowerCase()));
        if (newEmp.length > 0) {
          await supabase.from('employment_history').insert(newEmp.map((e: any, i: number) => ({
            user_id: user.id, title: e.title || 'Untitled', company: e.company || 'Unknown',
            location: e.location || '', start_date: e.start_date || '2020-01-01',
            end_date: e.end_date || null, is_current: e.is_current || false,
            description: e.description || '', achievements: Array.isArray(e.achievements) ? e.achievements : [], sort_order: i,
          })));
        }
      }

      // Import only new education
      if (Array.isArray(p.education) && p.education.length > 0) {
        const newEdu = p.education.filter((e: any) => !existingEduKeys.has(`${e.degree || 'Degree'}|||${e.institution || 'Institution'}`.toLowerCase()));
        if (newEdu.length > 0) {
          await supabase.from('education_history').insert(newEdu.map((e: any, i: number) => ({
            user_id: user.id, degree: e.degree || 'Degree', institution: e.institution || 'Institution',
            field_of_study: e.field_of_study || '', start_date: e.start_date || null, end_date: e.end_date || null, sort_order: i,
          })));
        }
      }

      // Import only new certifications
      if (Array.isArray(p.certifications) && p.certifications.length > 0) {
        const newCerts = p.certifications.filter((c: any) => !existingCertKeys.has(`${c.name || 'Certification'}|||${c.issuing_organization || 'Unknown'}`.toLowerCase()));
        if (newCerts.length > 0) {
          await supabase.from('certifications').insert(newCerts.map((c: any) => ({
            user_id: user.id, name: c.name || 'Certification', issuing_organization: c.issuing_organization || 'Unknown', issue_date: c.issue_date || null,
          })));
        }
      }

      await supabase.from('activity_log').insert({
        user_id: user.id, action: 'imported_cv_to_profile',
        entity_type: 'master_document', entity_id: importDoc.id,
      });

      // Trigger an immediate auto-search if desired_titles were set
      if (Array.isArray(p.desired_titles) && p.desired_titles.length > 0) {
        toast({ title: 'Profile imported!', description: 'Desired job titles set — auto-search will find matching jobs.' });
      } else {
        toast({ title: 'Profile imported!', description: 'Your profile has been populated from the CV.' });
      }

      setImportDoc(null);
      navigate('/profile');
    } catch (err: any) {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    }
    setImporting(false);
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
        <EmptyState icon={FileText} title="No documents uploaded" description="Upload your master CV to get started." actionLabel="Upload CV" onAction={() => fileInputRef.current?.click()} />
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
                <div className="flex gap-2 mt-4 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={async () => {
                    setPreviewDoc(doc);
                    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300);
                    setPreviewUrl(data?.signedUrl || null);
                  }} title="Preview">
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => togglePrimary(doc.id)} title={doc.is_primary ? 'Unset primary' : 'Set as primary'}>
                    {doc.is_primary ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => parseCV(doc.id)} disabled={parsing === doc.id} title="Parse with AI">
                    {parsing === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  </Button>
                  {hasParsedContent(doc) && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setImportDoc(doc)} title="Import to Profile">
                        <UserPlus className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditorDoc(doc)} title="Edit Content">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setTemplateDoc(doc)} title="Generate Styled CV">
                        <Palette className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setVersionDoc(doc)} title="Version History">
                    <History className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteDoc(doc.id, doc.file_path)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
                  <History className="w-3 h-3" />v{doc.version || 1}
                  {doc.file_size && <span>• {Math.round(doc.file_size / 1024)}KB</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Preview Dialog with PDF embed */}
      <Dialog open={!!previewDoc} onOpenChange={() => { setPreviewDoc(null); setPreviewUrl(null); }}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              {previewDoc?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden rounded-lg border bg-muted">
            {previewUrl ? (
              previewDoc?.mime_type === 'application/pdf' ? (
                <iframe src={previewUrl} className="w-full h-full min-h-[60vh]" title="PDF Preview" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                  <FileText className="w-16 h-16 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Preview not available for this file type.</p>
                  <Button asChild variant="outline">
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer">Download to View</a>
                  </Button>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {previewDoc && (
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1"><History className="w-3 h-3" />Version {previewDoc.version || 1}</span>
                <span>{previewDoc.file_name}</span>
                {previewDoc.file_size && <span>{Math.round(previewDoc.file_size / 1024)} KB</span>}
              </div>
              <span>Uploaded {new Date(previewDoc.created_at).toLocaleDateString()}</span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Template Selector */}
      {user && (
        <CVTemplateSelector
          open={!!templateDoc}
          onOpenChange={(open) => { if (!open) setTemplateDoc(null); }}
          document={templateDoc}
          userId={user.id}
        />
      )}

      {/* Import Confirmation Dialog */}
      <Dialog open={!!importDoc} onOpenChange={() => setImportDoc(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import CV Data to Profile</DialogTitle></DialogHeader>
          {importDoc?.parsed_content && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">This will import the following data from <strong>{importDoc.title}</strong> into your profile:</p>
              <div className="space-y-2 text-sm">
                {importDoc.parsed_content.full_name && (
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" /><span>Name: {importDoc.parsed_content.full_name}</span></div>
                )}
                {Array.isArray(importDoc.parsed_content.skills) && importDoc.parsed_content.skills.length > 0 && (
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" /><span>{importDoc.parsed_content.skills.length} skills</span></div>
                )}
                {Array.isArray(importDoc.parsed_content.employment) && importDoc.parsed_content.employment.length > 0 && (
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" /><span>{importDoc.parsed_content.employment.length} employment entries</span></div>
                )}
                {Array.isArray(importDoc.parsed_content.education) && importDoc.parsed_content.education.length > 0 && (
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" /><span>{importDoc.parsed_content.education.length} education entries</span></div>
                )}
                {Array.isArray(importDoc.parsed_content.certifications) && importDoc.parsed_content.certifications.length > 0 && (
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" /><span>{importDoc.parsed_content.certifications.length} certifications</span></div>
                )}
                {Array.isArray(importDoc.parsed_content.desired_titles) && importDoc.parsed_content.desired_titles.length > 0 && (
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-score-excellent" /><span>{importDoc.parsed_content.desired_titles.length} desired job titles for auto-search</span></div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Existing skills won't be duplicated. New employment/education entries will be added.</p>
              <Button onClick={importToProfile} className="w-full" disabled={importing}>
                {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</> : 'Import to Profile'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Inline Content Editor */}
      <CVContentEditor
        open={!!editorDoc}
        onOpenChange={(open) => { if (!open) setEditorDoc(null); }}
        document={editorDoc}
        onSaved={(updated) => setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d))}
      />

      {/* Version History */}
      {user && (
        <CVVersionHistory
          open={!!versionDoc}
          onOpenChange={(open) => { if (!open) setVersionDoc(null); }}
          document={versionDoc}
          userId={user.id}
          onVersionRestored={(updated) => {
            setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
            setVersionDoc(updated);
          }}
        />
      )}
    </div>
  );
};

export default CVLibrary;
