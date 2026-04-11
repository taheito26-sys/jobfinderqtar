import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Settings as SettingsIcon, Plus, Trash2, Plug } from 'lucide-react';

const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from('job_sources').select('*').eq('user_id', user.id).order('created_at')
      .then(({ data }) => { setSources(data ?? []); setLoading(false); });
  }, [user]);

  const addSource = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('job_sources').insert({
      user_id: user.id,
      source_name: 'New Source',
      source_type: 'manual',
    }).select().single();

    if (data) setSources([...sources, data]);
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

  return (
    <div className="animate-fade-in">
      <PageHeader title="Settings" description="Configure job sources, integrations, and preferences" />

      <div className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Job Sources</CardTitle>
            <Button size="sm" onClick={addSource}><Plus className="w-4 h-4 mr-2" />Add Source</Button>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Integration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              AI-powered features (CV parsing, job scoring, tailoring) use the Lovable AI Gateway. 
              These are powered by edge functions and require no additional configuration.
            </p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-score-excellent" />
              <span className="text-sm text-foreground">Lovable AI Gateway — Connected</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Application Modes</CardTitle>
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
      </div>
    </div>
  );
};

export default SettingsPage;
