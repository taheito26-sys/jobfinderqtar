import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  employmentOptions: { id: string; title: string; company: string }[];
  onSaved: (item: any) => void;
  editItem?: any;
}

const ProofPointModal = ({ open, onClose, userId, employmentOptions, onSaved, editItem }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    category: editItem?.category || 'achievement',
    statement: editItem?.statement || '',
    metric_value: editItem?.metric_value || '',
    context: editItem?.context || '',
    employment_id: editItem?.employment_id || '',
  });

  const handleSave = async () => {
    if (!form.statement) {
      toast({ title: 'Statement is required', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      user_id: userId,
      ...form,
      employment_id: form.employment_id || null,
    };

    let result;
    if (editItem) {
      result = await supabase.from('proof_points').update(payload).eq('id', editItem.id).select().single();
    } else {
      result = await supabase.from('proof_points').insert(payload).select().single();
    }

    if (result.error) {
      toast({ title: 'Error', description: result.error.message, variant: 'destructive' });
    } else {
      onSaved(result.data);
      onClose();
    }
    setSaving(false);
  };

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editItem ? 'Edit' : 'Add'} Proof Point</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.category} onChange={e => update('category', e.target.value)}>
              <option value="achievement">Achievement</option>
              <option value="impact">Impact</option>
              <option value="leadership">Leadership</option>
              <option value="technical">Technical</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Statement *</Label>
            <Textarea value={form.statement} onChange={e => update('statement', e.target.value)} rows={3} placeholder="e.g. Reduced API response time by 40% through caching optimization" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Metric / Value</Label>
              <Input value={form.metric_value} onChange={e => update('metric_value', e.target.value)} placeholder="e.g. 40% reduction" />
            </div>
            <div className="space-y-2">
              <Label>Related Experience</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.employment_id} onChange={e => update('employment_id', e.target.value)}>
                <option value="">None</option>
                {employmentOptions.map(e => (
                  <option key={e.id} value={e.id}>{e.title} at {e.company}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Context</Label>
            <Input value={form.context} onChange={e => update('context', e.target.value)} placeholder="Additional context for this achievement" />
          </div>
          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProofPointModal;
