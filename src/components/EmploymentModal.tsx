import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  onSaved: (item: any) => void;
  editItem?: any;
}

const EmploymentModal = ({ open, onClose, userId, onSaved, editItem }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company: editItem?.company || '',
    title: editItem?.title || '',
    location: editItem?.location || '',
    start_date: editItem?.start_date || '',
    end_date: editItem?.end_date || '',
    is_current: editItem?.is_current || false,
    description: editItem?.description || '',
  });

  const handleSave = async () => {
    if (!form.company || !form.title || !form.start_date) {
      toast({ title: 'Please fill required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      user_id: userId,
      ...form,
      end_date: form.is_current ? null : form.end_date || null,
    };

    let result;
    if (editItem) {
      result = await supabase.from('employment_history').update(payload).eq('id', editItem.id).select().single();
    } else {
      result = await supabase.from('employment_history').insert(payload).select().single();
    }

    if (result.error) {
      toast({ title: 'Error', description: result.error.message, variant: 'destructive' });
    } else {
      onSaved(result.data);
      onClose();
    }
    setSaving(false);
  };

  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editItem ? 'Edit' : 'Add'} Experience</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Job Title *</Label>
              <Input value={form.title} onChange={e => update('title', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Company *</Label>
              <Input value={form.company} onChange={e => update('company', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Input value={form.location} onChange={e => update('location', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date *</Label>
              <Input type="date" value={form.start_date} onChange={e => update('start_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={form.end_date} onChange={e => update('end_date', e.target.value)} disabled={form.is_current} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.is_current} onCheckedChange={v => update('is_current', v)} />
            <Label>Currently working here</Label>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => update('description', e.target.value)} rows={4} />
          </div>
          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EmploymentModal;
