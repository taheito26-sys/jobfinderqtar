import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Plug, Shield, Bell, Database, Pencil } from 'lucide-react';

const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [newSource, setNewSource] = useState({ source_name: '', source_type: 'manual' });
  const [prefs, setPrefs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [srcRes, prefRes] = await Promise.all([
        supabase.from('job_sources').select('*').eq('user_id', user.id).order('created_at'),
        supabase.from('user_preferences').select('*').eq('user_id', user.id),
      ]);
      setSources(srcRes.data ?? []);
      const prefMap: Record<string, string> = {};
      (prefRes.data ?? []).forEach((p: any) => { prefMap[p.key] = p.value; });
      setPrefs(prefMap);
      setLoading(false);
    };
    load();
  }, [user]);

  const addSource = async () => {
    if (!user || !newSource.source_name.trim()) return;
    const { data, error } = await supabase.from('job_sources').insert({
      user_id: user.id,
      source_name: newSource.source_name,
      source_type: newSource.source_type,
    }).select().single();

    if (data) { setSources([...sources, data]); setAddModal(false); setNewSource({ source_name: '', source_type: 'manual' }); }
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
  };

  const deleteSource = async (id: string) => {
    await supabase.from('job_sources').delete().eq('id', id);
    setSources(sources.filter(s => s.id !== id));
  };

  const toggleSource = async (id: string, enabled: boolean) => {
    await supabase.from('job_sources').update({ enabled }).eq('id', id);
    setSources(sources.map(s => s.id === id ? { ...s, enabled } : s));
  };

  const setPref = async (key: string, value: string) => {
    if (!user) return;
    await supabase.from('user_preferences').upsert(
      { user_id: user.id, key, value },
      { onConflict: 'user_id,key' }
    );
    setPrefs({ ...prefs, [key]: value });
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Settings" description="Configure job sources, integrations, and preferences" />

      <div className="space-y-6 max-w-2xl">
        {/* Job Sources */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" />Job Sources</CardTitle>
              <CardDescription>Configure where jobs are ingested from</CardDescription>
            </div>
            <Button size="sm" onClick={() => setAddModal(true)}><Plus className="w-4 h-4 mr-2" />Add Source</Button>
          </CardHeader>
          <CardContent>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No job sources configured yet.</p>
            ) : (
              <div className="space-y-3">
                {sources.map(source => (
                  <div key={source.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                      <Plug className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{source.source_name}</p>
                      <Badge variant="outline" className="text-xs">{source.source_type}</Badge>
                    </div>
                    <Switch checked={source.enabled} onCheckedChange={(v) => toggleSource(source.id, v)} />
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteSource(source.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Bell className="w-4 h-4" />Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">High-match alerts</p>
                <p className="text-xs text-muted-foreground">Get notified when a job scores 80+</p>
              </div>
              <Switch
                checked={prefs['notify_high_match'] === 'true'}
                onCheckedChange={(v) => setPref('notify_high_match', v.toString())}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Follow-up reminders</p>
                <p className="text-xs text-muted-foreground">Reminder on follow-up dates</p>
              </div>
              <Switch
                checked={prefs['notify_followup'] === 'true'}
                onCheckedChange={(v) => setPref('notify_followup', v.toString())}
              />
            </div>
          </CardContent>
        </Card>

        {/* AI Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Plug className="w-4 h-4" />AI Integration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              AI-powered features (CV parsing, job scoring, tailoring) use the Lovable AI Gateway.
            </p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-score-excellent" />
              <span className="text-sm text-foreground">Lovable AI Gateway — Connected</span>
            </div>
          </CardContent>
        </Card>

        {/* Application Modes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" />Application Modes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 rounded-lg border border-border">
              <h4 className="text-sm font-medium text-foreground">Mode A: Manual Apply</h4>
              <p className="text-xs text-muted-foreground">You apply manually using the tailored documents. Always available.</p>
            </div>
            <div className="p-3 rounded-lg border border-border">
              <h4 className="text-sm font-medium text-foreground">Mode B: Assisted Apply</h4>
              <p className="text-xs text-muted-foreground">System pre-fills application forms. You review and submit.</p>
            </div>
            <div className="p-3 rounded-lg border border-border border-warning/30">
              <h4 className="text-sm font-medium text-foreground">Mode C: Controlled Auto-Submit</h4>
              <p className="text-xs text-muted-foreground">Only for explicitly supported sources. Requires approval before each submission. Stops on CAPTCHA/MFA.</p>
            </div>
          </CardContent>
        </Card>

        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Signed in as</p>
              <p className="text-sm font-medium text-foreground">{user?.email}</p>
            </div>
            <Button variant="destructive" onClick={signOut}>Sign Out</Button>
          </CardContent>
        </Card>
      </div>

      {/* Add Source Modal */}
      <Dialog open={addModal} onOpenChange={setAddModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Job Source</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Source Name</Label>
              <Input value={newSource.source_name} onChange={e => setNewSource({ ...newSource, source_name: e.target.value })} placeholder="e.g. LinkedIn, Indeed, Company RSS" />
            </div>
            <div className="space-y-2">
              <Label>Source Type</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newSource.source_type} onChange={e => setNewSource({ ...newSource, source_type: e.target.value })}>
                <option value="manual">Manual</option>
                <option value="rss">RSS Feed</option>
                <option value="api">API</option>
                <option value="scraper">Scraper</option>
              </select>
            </div>
            <Button onClick={addSource} className="w-full">Add Source</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SettingsPage;
