import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  onSaved: (item: any) => void;
  editItem?: any;
}

const EducationModal = ({ open, onClose, userId, onSaved, editItem }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    institution: editItem?.institution || '',
    degree: editItem?.degree || '',
    field_of_study: editItem?.field_of_study || '',
    start_date: editItem?.start_date || '',
    end_date: editItem?.end_date || '',
    gpa: editItem?.gpa || '',
  });

  const handleSave = async () => {
    if (!form.institution || !form.degree) {
      toast({ title: 'Please fill required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = { user_id: userId, ...form, start_date: form.start_date || null, end_date: form.end_date || null };

    let result;
    if (editItem) {
      result = await supabase.from('education_history').update(payload).eq('id', editItem.id).select().single();
    } else {
      result = await supabase.from('education_history').insert(payload).select().single();
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
          <DialogTitle>{editItem ? 'Edit' : 'Add'} Education</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Degree *</Label>
              <Input value={form.degree} onChange={e => update('degree', e.target.value)} placeholder="e.g. B.Sc. Computer Science" />
            </div>
            <div className="space-y-2">
              <Label>Institution *</Label>
              <Input value={form.institution} onChange={e => update('institution', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Field of Study</Label>
            <Input value={form.field_of_study} onChange={e => update('field_of_study', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={form.start_date} onChange={e => update('start_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={form.end_date} onChange={e => update('end_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>GPA</Label>
              <Input value={form.gpa} onChange={e => update('gpa', e.target.value)} />
            </div>
          </div>
          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EducationModal;
