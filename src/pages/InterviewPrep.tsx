import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  BookOpen, Plus, Pencil, Trash2, ChevronDown, ChevronUp,
  Loader2, Lightbulb, Star, Tag, Briefcase
} from 'lucide-react';

const IMPACT_LEVELS = [
  { value: 'low', label: 'Low', color: 'text-muted-foreground' },
  { value: 'medium', label: 'Medium', color: 'text-amber-600 dark:text-amber-400' },
  { value: 'high', label: 'High', color: 'text-blue-600 dark:text-blue-400' },
  { value: 'transformative', label: 'Transformative', color: 'text-primary' },
];

const STAR_FIELDS = [
  { key: 'situation', label: 'Situation', hint: 'Set the scene. What was the context? What was happening?', placeholder: 'e.g. Our team was facing a critical deadline with a legacy system that kept failing under load...' },
  { key: 'task', label: 'Task', hint: 'What was your specific responsibility? What were you asked to do?', placeholder: 'e.g. I was tasked with redesigning the data pipeline to handle 10x traffic...' },
  { key: 'action', label: 'Action', hint: 'What did you specifically do? Use "I" not "we". Be precise.', placeholder: 'e.g. I profiled the bottleneck, introduced async processing with a Redis queue, and rolled out canary releases...' },
  { key: 'result', label: 'Result', hint: 'What happened? Quantify if possible. Impact > effort.', placeholder: 'e.g. Reduced p99 latency by 82%, eliminated all downtime incidents, saved the Q3 launch...' },
  { key: 'reflection', label: 'Reflection (the "+R")', hint: 'What would you do differently? What did you learn? This is what separates great answers from good ones.', placeholder: 'e.g. I would have involved the on-call team earlier rather than owning the migration solo. I learned that communication under pressure matters as much as technical skill...' },
];

const emptyForm = {
  title: '',
  situation: '',
  task: '',
  action: '',
  result: '',
  reflection: '',
  tags: [] as string[],
  impact_level: 'medium',
  linked_job_id: null as string | null,
};

const InterviewPrep = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [stories, setStories] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [storiesRes, jobsRes] = await Promise.all([
        supabase.from('interview_stories').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('jobs').select('id, title, company').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      ]);
      setStories(storiesRes.data || []);
      setJobs(jobsRes.data || []);
      setLoading(false);
    };
    load();
  }, [user]);

  const openNew = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setTagInput('');
    setModalOpen(true);
  };

  const openEdit = (story: any) => {
    setForm({
      title: story.title,
      situation: story.situation,
      task: story.task,
      action: story.action,
      result: story.result,
      reflection: story.reflection,
      tags: story.tags || [],
      impact_level: story.impact_level || 'medium',
      linked_job_id: story.linked_job_id || null,
    });
    setTagInput('');
    setEditingId(story.id);
    setModalOpen(true);
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) {
      setForm(f => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));
  };

  const save = async () => {
    if (!user) return;
    if (!form.title.trim()) { toast({ title: 'Title required', variant: 'destructive' }); return; }
    if (!form.situation.trim() || !form.task.trim() || !form.action.trim() || !form.result.trim()) {
      toast({ title: 'S, T, A, R fields are required', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        ...form,
        tags: form.tags,
        linked_job_id: form.linked_job_id || null,
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const { data, error } = await supabase.from('interview_stories').update(payload).eq('id', editingId).select().single();
        if (error) throw error;
        setStories(s => s.map(x => x.id === editingId ? data : x));
        toast({ title: 'Story updated' });
      } else {
        const { data, error } = await supabase.from('interview_stories').insert(payload).select().single();
        if (error) throw error;
        setStories(s => [data, ...s]);
        toast({ title: 'Story added to your bank' });
      }
      setModalOpen(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const deleteStory = async (id: string) => {
    if (!user) return;
    setDeletingId(id);
    const { error } = await supabase.from('interview_stories').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setStories(s => s.filter(x => x.id !== id));
      toast({ title: 'Story removed' });
    }
    setDeletingId(null);
  };

  const impactConfig = (level: string) => IMPACT_LEVELS.find(l => l.value === level) || IMPACT_LEVELS[1];

  const linkedJobLabel = (jobId: string | null) => {
    if (!jobId) return null;
    const j = jobs.find(j => j.id === jobId);
    return j ? `${j.title} @ ${j.company}` : null;
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />Interview Prep
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Build a bank of 5–10 deep STAR+R stories. Reuse them flexibly across any interview question.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="w-4 h-4 mr-2" />Add Story
        </Button>
      </div>

      {/* Guidance card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">The STAR+R method</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Don't memorise 50+ answers — build <strong>5–10 rich stories</strong> and apply them flexibly.
                The <strong>+R (Reflection)</strong> is what separates exceptional candidates: "What would you do differently?" shows self-awareness and growth mindset.
                Each story should cover at least one of: leadership, conflict, failure, technical challenge, or impact.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {['Tell me about yourself', 'Most impactful project', 'Conflict resolution', 'Failure & recovery', 'Leadership under pressure'].map(q => (
                  <Badge key={q} variant="outline" className="text-[10px]">{q}</Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {stories.length === 0 ? (
        <Card>
          <CardContent className="pt-12 pb-12 text-center">
            <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No stories yet. Add your first STAR+R story to start building your bank.</p>
            <Button className="mt-4" onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add First Story</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {stories.map(story => {
            const expanded = expandedId === story.id;
            const impact = impactConfig(story.impact_level);
            const jobLabel = linkedJobLabel(story.linked_job_id);
            return (
              <Card key={story.id} className="transition-all">
                <CardHeader
                  className="pb-2 cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : story.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{story.title}</CardTitle>
                        <Badge variant="outline" className={`text-[10px] capitalize ${impact.color}`}>
                          <Star className="w-2.5 h-2.5 mr-1" />{impact.label} Impact
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {jobLabel && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Briefcase className="w-3 h-3" />{jobLabel}
                          </span>
                        )}
                        {(story.tags as string[] || []).map((tag: string) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                            <Tag className="w-2.5 h-2.5 mr-0.5" />{tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={e => { e.stopPropagation(); openEdit(story); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={deletingId === story.id}
                        onClick={e => { e.stopPropagation(); deleteStory(story.id); }}
                      >
                        {deletingId === story.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                      {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {expanded && (
                  <CardContent className="space-y-4 pt-0">
                    <div className="border-t border-border/50 pt-4 space-y-4">
                      {STAR_FIELDS.map(({ key, label }) => story[key] && (
                        <div key={key}>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{story[key]}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Story' : 'Add STAR+R Story'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Story Title <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Rebuilt the data pipeline under deadline pressure"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">A memorable name so you can find this story quickly during prep.</p>
            </div>

            {STAR_FIELDS.map(({ key, label, hint, placeholder }) => (
              <div key={key} className="space-y-2">
                <Label>{label} {key !== 'reflection' && <span className="text-destructive">*</span>}</Label>
                <p className="text-xs text-muted-foreground">{hint}</p>
                <Textarea
                  rows={3}
                  placeholder={placeholder}
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Impact Level</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.impact_level}
                  onChange={e => setForm(f => ({ ...f, impact_level: e.target.value }))}
                >
                  {IMPACT_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Linked Job (optional)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.linked_job_id || ''}
                  onChange={e => setForm(f => ({ ...f, linked_job_id: e.target.value || null }))}
                >
                  <option value="">— None —</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.title} @ {j.company}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="leadership, conflict, technical..."
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={addTag}>Add</Button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-xs cursor-pointer" onClick={() => removeTag(tag)}>
                      {tag} ×
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={save} disabled={saving} className="flex-1">
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : editingId ? 'Save Changes' : 'Add to Story Bank'}
              </Button>
              <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InterviewPrep;
