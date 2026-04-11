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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plug, Shield, Bell, Loader2, CheckCircle2, XCircle, Zap, GitBranch } from 'lucide-react';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [testStatus, setTestStatus] = useState<ConnectionStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [testModel, setTestModel] = useState('');

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
    if (key === 'ai_provider' || key === 'ai_api_key') {
      setTestStatus('idle');
      setTestMessage('');
      setTestModel('');
    }
  };

  const testConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    setTestModel('');
    try {
      const { data, error } = await supabase.functions.invoke('test-ai-connection', { body: {} });
      if (error) throw error;
      if (data?.error && !data?.fallback) throw new Error(data.error);
      if (data?.fallback) {
        setTestStatus('success');
        setTestModel(data.model || '');
        setTestMessage(data.message || 'Key valid but temporarily limited');
        toast({ title: 'API key is valid', description: data.message });
      } else {
        setTestStatus('success');
        setTestModel(data.model || '');
        setTestMessage(data.message || 'Connection successful');
        toast({ title: 'Connection test passed', description: `Model: ${data.model || 'OK'}` });
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(err.message || 'Connection failed');
      toast({ title: 'Connection test failed', description: err.message, variant: 'destructive' });
    }
  };

  const providerLabel = (p: string) => {
    switch (p) {
      case 'anthropic': return 'Claude (Anthropic)';
      case 'openai': return 'ChatGPT (OpenAI)';
      case 'gemini': return 'Gemini (Google)';
      default: return 'Lovable AI';
    }
  };

  const currentProvider = prefs['ai_provider'] || 'lovable';
  const hasKey = currentProvider === 'lovable' || !!prefs['ai_api_key'];
  const pipelineEnabled = prefs['ai_pipeline_enabled'] === 'true';

  // Count configured pipeline providers
  const pipelineProviders: string[] = ['Lovable AI'];
  if (prefs['ai_key_openai']) pipelineProviders.push('OpenAI');
  if (prefs['ai_key_gemini']) pipelineProviders.push('Gemini');
  if (prefs['ai_key_anthropic']) pipelineProviders.push('Claude');

  return (
    <div className="animate-fade-in">
      <PageHeader title="Settings" description="Configure job sources, integrations, and preferences" />

      <div className="space-y-6 max-w-2xl">
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
              <Switch checked={prefs['notify_high_match'] === 'true'} onCheckedChange={(v) => setPref('notify_high_match', v.toString())} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Follow-up reminders</p>
                <p className="text-xs text-muted-foreground">Reminder on follow-up dates</p>
              </div>
              <Switch checked={prefs['notify_followup'] === 'true'} onCheckedChange={(v) => setPref('notify_followup', v.toString())} />
            </div>
          </CardContent>
        </Card>

        {/* AI Provider (Primary) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Plug className="w-4 h-4" />AI Provider (Primary)</CardTitle>
            <CardDescription>Primary provider for single-provider mode</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={currentProvider}
                onChange={e => setPref('ai_provider', e.target.value)}
              >
                <option value="lovable">Lovable AI (Gemini via Gateway) — Free tier included</option>
                <option value="anthropic">Claude (Anthropic) — Best for document tailoring</option>
                <option value="openai">ChatGPT (OpenAI)</option>
                <option value="gemini">Gemini (Google Direct)</option>
              </select>
            </div>

            {currentProvider !== 'lovable' && (
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  placeholder={`Enter your ${providerLabel(currentProvider)} API key`}
                  value={prefs['ai_api_key'] || ''}
                  onChange={e => setPref('ai_api_key', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {currentProvider === 'anthropic' && 'Get your key at console.anthropic.com → API Keys'}
                  {currentProvider === 'openai' && 'Get your key at platform.openai.com → API Keys'}
                  {currentProvider === 'gemini' && 'Get your key at aistudio.google.com → API Keys'}
                </p>
              </div>
            )}

            {/* Connection Status */}
            <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    testStatus === 'success' ? 'bg-green-500' :
                    testStatus === 'error' ? 'bg-destructive' :
                    hasKey ? 'bg-yellow-500' : 'bg-muted-foreground'
                  }`} />
                  <span className="text-sm font-medium text-foreground">{providerLabel(currentProvider)}</span>
                </div>
                <Badge variant={
                  testStatus === 'success' ? 'default' :
                  testStatus === 'error' ? 'destructive' :
                  hasKey ? 'secondary' : 'outline'
                } className="text-xs">
                  {testStatus === 'success' ? 'Connected' :
                   testStatus === 'error' ? 'Failed' :
                   hasKey ? 'Not tested' : 'No API key'}
                </Badge>
              </div>

              {testStatus === 'success' && (
                <div className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-foreground">{testMessage}</p>
                    {testModel && <p className="text-muted-foreground">Model: {testModel}</p>}
                  </div>
                </div>
              )}
              {testStatus === 'error' && (
                <div className="flex items-start gap-2 text-xs">
                  <XCircle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-destructive">{testMessage}</p>
                </div>
              )}

              <Button variant="outline" size="sm" className="w-full" onClick={testConnection} disabled={testStatus === 'testing' || !hasKey}>
                {testStatus === 'testing' ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing connection...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Test Connection</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Multi-AI Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><GitBranch className="w-4 h-4" />Multi-AI Pipeline</CardTitle>
            <CardDescription>
              Chain multiple AI providers for higher quality. Each provider reviews and corrects the previous one's output.
              Claude always finalizes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Enable pipeline mode</p>
                <p className="text-xs text-muted-foreground">Uses more API calls but produces better results</p>
              </div>
              <Switch
                checked={pipelineEnabled}
                onCheckedChange={(v) => setPref('ai_pipeline_enabled', v.toString())}
              />
            </div>

            {pipelineEnabled && (
              <>
                <div className="p-3 rounded-lg border border-border bg-muted/30">
                  <p className="text-xs font-medium text-foreground mb-2">Pipeline chain:</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {pipelineProviders.map((name, i) => (
                      <span key={name} className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-xs">{name}</Badge>
                        {i < pipelineProviders.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {pipelineProviders.length <= 1
                      ? 'Add API keys below to enable the chain. At least 2 providers needed.'
                      : `${pipelineProviders.length} providers configured. Add more keys for a longer chain.`
                    }
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Provider API Keys</p>

                  <div className="space-y-2">
                    <Label className="text-sm">OpenAI API Key</Label>
                    <Input
                      type="password"
                      placeholder="sk-proj-..."
                      value={prefs['ai_key_openai'] || ''}
                      onChange={e => setPref('ai_key_openai', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Reviewer — platform.openai.com → API Keys</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Google Gemini API Key</Label>
                    <Input
                      type="password"
                      placeholder="AIza..."
                      value={prefs['ai_key_gemini'] || ''}
                      onChange={e => setPref('ai_key_gemini', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Reviewer — aistudio.google.com → API Keys</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Anthropic (Claude) API Key <Badge variant="outline" className="text-xs ml-1">Finalizer</Badge></Label>
                    <Input
                      type="password"
                      placeholder="sk-ant-..."
                      value={prefs['ai_key_anthropic'] || ''}
                      onChange={e => setPref('ai_key_anthropic', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Final reviewer & executor — console.anthropic.com → API Keys</p>
                  </div>
                </div>
              </>
            )}
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
            <div className="p-3 rounded-lg border border-border">
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
