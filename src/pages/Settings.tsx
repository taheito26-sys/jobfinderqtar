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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plug, Shield, Bell, Loader2, CheckCircle2, XCircle, Zap, GitBranch, ShieldAlert } from 'lucide-react';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const MODEL_OPTIONS: Record<string, { label: string; value: string }[]> = {
  openai: [
    { label: 'GPT-4o (Default)', value: 'gpt-4o' },
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
    { label: 'o1', value: 'o1' },
    { label: 'o1 Mini', value: 'o1-mini' },
  ],
  gemini: [
    { label: 'Gemini 2.5 Flash (Default)', value: 'gemini-2.5-flash' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
    { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
    { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' },
  ],
  anthropic: [
    { label: 'Claude Sonnet 4 (Default)', value: 'claude-sonnet-4-20250514' },
    { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
    { label: 'Claude Haiku 3.5', value: 'claude-3-5-haiku-20241022' },
    { label: 'Claude Sonnet 3.5 v2', value: 'claude-3-5-sonnet-20241022' },
  ],
};

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
      default: return 'ChatGPT (OpenAI)';
    }
  };

  const currentProvider = prefs['ai_provider'] || 'openai';
  const hasKey = !!prefs['ai_api_key'];
  const pipelineEnabled = prefs['ai_pipeline_enabled'] === 'true';

  // Fallback defaults to the "other" of OpenAI/Gemini if none set.
  const fallbackProvider = prefs['ai_fallback_provider']
    || (currentProvider === 'openai' ? 'gemini' : 'openai');

  const pipelineProviders: string[] = [];
  pipelineProviders.push(providerLabel(currentProvider) + ' (Main)');
  if (prefs[`ai_key_${fallbackProvider}`]) {
    pipelineProviders.push(providerLabel(fallbackProvider) + ' (Fallback)');
  }

  const ModelSelector = ({ providerKey, prefKey, label }: { providerKey: string; prefKey: string; label?: string }) => {
    const models = MODEL_OPTIONS[providerKey] || [];
    const currentModel = prefs[prefKey] || models[0]?.value || '';
    return (
      <div className="space-y-1.5">
        {label && <Label className="text-xs text-muted-foreground">{label}</Label>}
        <Select value={currentModel} onValueChange={(v) => setPref(prefKey, v)}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {models.map(m => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

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
                <option value="openai">ChatGPT (OpenAI)</option>
                <option value="gemini">Gemini (Google)</option>
                <option value="anthropic">Claude (Anthropic)</option>
              </select>
            </div>

            <ModelSelector providerKey={currentProvider} prefKey="ai_model_primary" label="Model" />

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

            <div className="space-y-2 pt-2 border-t border-border">
              <Label>Fallback provider</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={fallbackProvider}
                onChange={e => setPref('ai_fallback_provider', e.target.value)}
              >
                {['openai', 'gemini', 'anthropic']
                  .filter(p => p !== currentProvider)
                  .map(p => (
                    <option key={p} value={p}>{providerLabel(p)}</option>
                  ))}
              </select>
              <Input
                type="password"
                placeholder={`Enter your ${providerLabel(fallbackProvider)} API key`}
                value={prefs[`ai_key_${fallbackProvider}`] || ''}
                onChange={e => setPref(`ai_key_${fallbackProvider}`, e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Used automatically if the main provider fails or returns 402/429.
              </p>
            </div>

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
            <CardTitle className="text-base flex items-center gap-2"><GitBranch className="w-4 h-4" />Review Pipeline</CardTitle>
            <CardDescription>
              When enabled, the fallback provider reviews and refines the main provider's output before it's returned.
              When disabled, the fallback is used only if the main provider fails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Enable review pipeline</p>
                <p className="text-xs text-muted-foreground">Uses 2 API calls per request — higher quality, higher cost.</p>
              </div>
              <Switch
                checked={pipelineEnabled}
                onCheckedChange={(v) => setPref('ai_pipeline_enabled', v.toString())}
              />
            </div>

            <div className="p-3 rounded-lg border border-border bg-muted/30">
              <p className="text-xs font-medium text-foreground mb-2">Chain:</p>
              <div className="flex items-center gap-1 flex-wrap">
                {pipelineProviders.map((name, i) => (
                  <span key={name} className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-xs">{name}</Badge>
                    {i < pipelineProviders.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                  </span>
                ))}
              </div>
              {pipelineProviders.length < 2 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Add a fallback API key above to enable automatic failover and review pipeline.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Hardline Safety */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Hardline Safety
            </CardTitle>
            <CardDescription>Personal guardrails for the collect, draft, and auto-submit workflow.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Default mode</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={prefs['hardline_default_mode'] || 'draft'}
                onChange={e => setPref('hardline_default_mode', e.target.value)}
              >
                <option value="collect">Collect</option>
                <option value="draft">Draft</option>
                <option value="auto_submit">Auto-submit</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Skip below</Label>
                <Input type="number" value={prefs['hardline_skip_below'] || '60'} onChange={e => setPref('hardline_skip_below', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Draft min</Label>
                <Input type="number" value={prefs['hardline_draft_min'] || '80'} onChange={e => setPref('hardline_draft_min', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Auto-submit min</Label>
                <Input type="number" value={prefs['hardline_auto_submit_min'] || '90'} onChange={e => setPref('hardline_auto_submit_min', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Daily auto cap</Label>
                <Input type="number" value={prefs['hardline_max_auto_submit_per_day'] || '5'} onChange={e => setPref('hardline_max_auto_submit_per_day', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Daily draft cap</Label>
                <Input type="number" value={prefs['hardline_max_drafts_per_day'] || '20'} onChange={e => setPref('hardline_max_drafts_per_day', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Require verification</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={prefs['hardline_require_submission_verification'] ?? 'true'}
                  onChange={e => setPref('hardline_require_submission_verification', e.target.value)}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
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
