import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Pencil, Save, Loader2, ArrowUp, ArrowDown, Plus, Trash2,
  User, Briefcase, GraduationCap, Award, Wrench, X,
} from 'lucide-react';

interface CVContentEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: any;
  onSaved: (updated: any) => void;
}

const CVContentEditor = ({ open, onOpenChange, document, onSaved }: CVContentEditorProps) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState<any>(null);

  // Initialize content when dialog opens
  const initContent = useCallback(() => {
    if (document?.parsed_content) {
      setContent(JSON.parse(JSON.stringify(document.parsed_content)));
    }
  }, [document]);

  if (open && !content && document?.parsed_content) {
    initContent();
  }

  const handleClose = (o: boolean) => {
    if (!o) setContent(null);
    onOpenChange(o);
  };

  const handleSave = async () => {
    if (!document || !content) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('master_documents')
        .update({ parsed_content: content })
        .eq('id', document.id);
      if (error) throw error;
      onSaved({ ...document, parsed_content: content });
      toast({ title: 'CV content saved!', description: 'Your changes have been saved.' });
      handleClose(false);
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const moveItem = (arr: any[], idx: number, dir: -1 | 1) => {
    const newArr = [...arr];
    const target = idx + dir;
    if (target < 0 || target >= newArr.length) return newArr;
    [newArr[idx], newArr[target]] = [newArr[target], newArr[idx]];
    return newArr;
  };

  const updateField = (field: string, value: any) => {
    setContent((prev: any) => ({ ...prev, [field]: value }));
  };

  const updateArrayItem = (field: string, idx: number, key: string, value: any) => {
    setContent((prev: any) => {
      const arr = [...(prev[field] || [])];
      arr[idx] = { ...arr[idx], [key]: value };
      return { ...prev, [field]: arr };
    });
  };

  const removeArrayItem = (field: string, idx: number) => {
    setContent((prev: any) => ({
      ...prev,
      [field]: (prev[field] || []).filter((_: any, i: number) => i !== idx),
    }));
  };

  const addEmployment = () => {
    setContent((prev: any) => ({
      ...prev,
      employment: [...(prev.employment || []), { title: '', company: '', location: '', start_date: '', end_date: '', is_current: false, description: '', achievements: [] }],
    }));
  };

  const addEducation = () => {
    setContent((prev: any) => ({
      ...prev,
      education: [...(prev.education || []), { degree: '', institution: '', field_of_study: '', start_date: '', end_date: '' }],
    }));
  };

  const addCertification = () => {
    setContent((prev: any) => ({
      ...prev,
      certifications: [...(prev.certifications || []), { name: '', issuing_organization: '', issue_date: '' }],
    }));
  };

  if (!content) return null;

  const employment = content.employment || [];
  const education = content.education || [];
  const certifications = content.certifications || [];
  const skills = content.skills || [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            Edit CV Content
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basics" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="basics" className="gap-1 text-xs"><User className="w-3 h-3" />Basics</TabsTrigger>
            <TabsTrigger value="experience" className="gap-1 text-xs"><Briefcase className="w-3 h-3" />Experience</TabsTrigger>
            <TabsTrigger value="education" className="gap-1 text-xs"><GraduationCap className="w-3 h-3" />Education</TabsTrigger>
            <TabsTrigger value="skills" className="gap-1 text-xs"><Wrench className="w-3 h-3" />Skills</TabsTrigger>
            <TabsTrigger value="certs" className="gap-1 text-xs"><Award className="w-3 h-3" />Certs</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-4">
            {/* Basics Tab */}
            <TabsContent value="basics" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input value={content.full_name || ''} onChange={e => updateField('full_name', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Headline</Label>
                  <Input value={content.headline || ''} onChange={e => updateField('headline', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={content.email || ''} onChange={e => updateField('email', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={content.phone || ''} onChange={e => updateField('phone', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input value={content.location || ''} onChange={e => updateField('location', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>LinkedIn URL</Label>
                  <Input value={content.linkedin_url || ''} onChange={e => updateField('linkedin_url', e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Professional Summary</Label>
                <Textarea rows={4} value={content.summary || ''} onChange={e => updateField('summary', e.target.value)} />
              </div>
            </TabsContent>

            {/* Experience Tab */}
            <TabsContent value="experience" className="space-y-4 mt-0">
              {employment.map((exp: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Position {idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0}
                        onClick={() => updateField('employment', moveItem(employment, idx, -1))}>
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === employment.length - 1}
                        onClick={() => updateField('employment', moveItem(employment, idx, 1))}>
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeArrayItem('employment', idx)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Title</Label>
                      <Input value={exp.title || ''} onChange={e => updateArrayItem('employment', idx, 'title', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Company</Label>
                      <Input value={exp.company || ''} onChange={e => updateArrayItem('employment', idx, 'company', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Location</Label>
                      <Input value={exp.location || ''} onChange={e => updateArrayItem('employment', idx, 'location', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Start</Label>
                        <Input value={exp.start_date || ''} onChange={e => updateArrayItem('employment', idx, 'start_date', e.target.value)} className="h-8 text-sm" placeholder="YYYY-MM-DD" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">End</Label>
                        <Input value={exp.end_date || ''} onChange={e => updateArrayItem('employment', idx, 'end_date', e.target.value)} className="h-8 text-sm" placeholder="YYYY-MM-DD" disabled={exp.is_current} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea rows={2} value={exp.description || ''} onChange={e => updateArrayItem('employment', idx, 'description', e.target.value)} className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Achievements (one per line)</Label>
                    <Textarea rows={3} value={(exp.achievements || []).join('\n')}
                      onChange={e => updateArrayItem('employment', idx, 'achievements', e.target.value.split('\n').filter((a: string) => a.trim()))}
                      className="text-sm" placeholder="• Led migration of 500 servers..." />
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addEmployment} className="w-full gap-2">
                <Plus className="w-4 h-4" />Add Position
              </Button>
            </TabsContent>

            {/* Education Tab */}
            <TabsContent value="education" className="space-y-4 mt-0">
              {education.map((edu: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-4 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Education {idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0}
                        onClick={() => updateField('education', moveItem(education, idx, -1))}>
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === education.length - 1}
                        onClick={() => updateField('education', moveItem(education, idx, 1))}>
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeArrayItem('education', idx)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Degree</Label>
                      <Input value={edu.degree || ''} onChange={e => updateArrayItem('education', idx, 'degree', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Institution</Label>
                      <Input value={edu.institution || ''} onChange={e => updateArrayItem('education', idx, 'institution', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Field of Study</Label>
                      <Input value={edu.field_of_study || ''} onChange={e => updateArrayItem('education', idx, 'field_of_study', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Start</Label>
                        <Input value={edu.start_date || ''} onChange={e => updateArrayItem('education', idx, 'start_date', e.target.value)} className="h-8 text-sm" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">End</Label>
                        <Input value={edu.end_date || ''} onChange={e => updateArrayItem('education', idx, 'end_date', e.target.value)} className="h-8 text-sm" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addEducation} className="w-full gap-2">
                <Plus className="w-4 h-4" />Add Education
              </Button>
            </TabsContent>

            {/* Skills Tab */}
            <TabsContent value="skills" className="space-y-4 mt-0">
              <div className="flex flex-wrap gap-2">
                {skills.map((skill: string, idx: number) => (
                  <Badge key={idx} variant="secondary" className="gap-1 pl-2.5 pr-1 py-1">
                    {skill}
                    <button onClick={() => updateField('skills', skills.filter((_: any, i: number) => i !== idx))}
                      className="ml-1 rounded-full hover:bg-destructive/20 p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add a skill and press Enter"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                      updateField('skills', [...skills, (e.target as HTMLInputElement).value.trim()]);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                  className="h-8 text-sm"
                />
              </div>
              <p className="text-xs text-muted-foreground">{skills.length} skills total. Type and press Enter to add.</p>
            </TabsContent>

            {/* Certifications Tab */}
            <TabsContent value="certs" className="space-y-4 mt-0">
              {certifications.map((cert: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Certification {idx + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === 0}
                        onClick={() => updateField('certifications', moveItem(certifications, idx, -1))}>
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={idx === certifications.length - 1}
                        onClick={() => updateField('certifications', moveItem(certifications, idx, 1))}>
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeArrayItem('certifications', idx)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input value={cert.name || ''} onChange={e => updateArrayItem('certifications', idx, 'name', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Issuing Org</Label>
                      <Input value={cert.issuing_organization || ''} onChange={e => updateArrayItem('certifications', idx, 'issuing_organization', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Issue Date</Label>
                      <Input value={cert.issue_date || ''} onChange={e => updateArrayItem('certifications', idx, 'issue_date', e.target.value)} className="h-8 text-sm" />
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addCertification} className="w-full gap-2">
                <Plus className="w-4 h-4" />Add Certification
              </Button>
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CVContentEditor;
