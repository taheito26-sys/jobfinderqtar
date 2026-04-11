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

const CertificationModal = ({ open, onClose, userId, onSaved, editItem }: Props) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: editItem?.name || '',
    issuing_organization: editItem?.issuing_organization || '',
    issue_date: editItem?.issue_date || '',
    expiry_date: editItem?.expiry_date || '',
    credential_id: editItem?.credential_id || '',
    credential_url: editItem?.credential_url || '',
  });

  const handleSave = async () => {
    if (!form.name || !form.issuing_organization) {
      toast({ title: 'Please fill required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = { user_id: userId, ...form, issue_date: form.issue_date || null, expiry_date: form.expiry_date || null };

    let result;
    if (editItem) {
      result = await supabase.from('certifications').update(payload).eq('id', editItem.id).select().single();
    } else {
      result = await supabase.from('certifications').insert(payload).select().single();
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
          <DialogTitle>{editItem ? 'Edit' : 'Add'} Certification</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Certification Name *</Label>
              <Input value={form.name} onChange={e => update('name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Issuing Organization *</Label>
              <Input value={form.issuing_organization} onChange={e => update('issuing_organization', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Issue Date</Label>
              <Input type="date" value={form.issue_date} onChange={e => update('issue_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiry_date} onChange={e => update('expiry_date', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Credential ID</Label>
              <Input value={form.credential_id} onChange={e => update('credential_id', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Credential URL</Label>
              <Input value={form.credential_url} onChange={e => update('credential_url', e.target.value)} />
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

export default CertificationModal;
