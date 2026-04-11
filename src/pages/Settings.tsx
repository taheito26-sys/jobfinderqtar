import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import JobSourcesConfig from '@/components/JobSourcesConfig';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Plug, Shield, Bell } from 'lucide-react';

const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    supabase.from('user_preferences').select('*').eq('user_id', user.id).then(({ data }) => {
      const prefMap: Record<string, string> = {};
      (data ?? []).forEach((p: any) => { prefMap[p.key] = p.value; });
      setPrefs(prefMap);
    });
  }, [user]);

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
        {/* Job Sources — full config */}
        <JobSourcesConfig />

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
            <CardDescription>Choose the AI provider for CV parsing, job scoring, and tailoring</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>AI Provider</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={prefs['ai_provider'] || 'lovable'}
                onChange={e => setPref('ai_provider', e.target.value)}
              >
                <option value="lovable">Lovable AI (Gemini via Gateway)</option>
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="openai">ChatGPT (OpenAI)</option>
                <option value="gemini">Gemini (Google Direct)</option>
              </select>
            </div>

            {prefs['ai_provider'] && prefs['ai_provider'] !== 'lovable' && (
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  placeholder={`Enter your ${prefs['ai_provider'] === 'anthropic' ? 'Anthropic' : prefs['ai_provider'] === 'openai' ? 'OpenAI' : 'Google'} API key`}
                  value={prefs['ai_api_key'] || ''}
                  onChange={e => setPref('ai_api_key', e.target.value)}
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${(!prefs['ai_provider'] || prefs['ai_provider'] === 'lovable') ? 'bg-score-excellent' : prefs['ai_api_key'] ? 'bg-score-excellent' : 'bg-warning'}`} />
              <span className="text-sm text-foreground">
                {(!prefs['ai_provider'] || prefs['ai_provider'] === 'lovable')
                  ? 'Lovable AI Gateway — Connected'
                  : prefs['ai_api_key']
                    ? `${prefs['ai_provider'] === 'anthropic' ? 'Claude' : prefs['ai_provider'] === 'openai' ? 'ChatGPT' : 'Gemini'} — Key configured`
                    : 'API key required'}
              </span>
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
              <p className="text-xs text-muted-foreground">Only for explicitly supported sources. Requires approval before each submission.</p>
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
    </div>
  );
};

export default SettingsPage;
