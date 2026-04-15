import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, ArrowLeft, FileJson, PauseCircle, PlayCircle, ShieldAlert, Sparkles, Table2 } from 'lucide-react';

type SourceRow = {
  id: string;
  source_name: string;
  adapter_type: string;
  base_url: string | null;
  auth_mode: string | null;
  config_json: Record<string, unknown> | null;
  active_flag: boolean | null;
  created_at: string;
  updated_at?: string | null;
};

type SourceSyncRunRow = {
  id: string;
  source_id: string;
  run_mode: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  jobs_seen_count: number;
  jobs_inserted_count: number;
  jobs_updated_count: number;
  jobs_invalid_count: number;
  errors_json: any[] | null;
};

type RawJobRow = {
  id: string;
  source_id: string;
  source_job_id: string;
  fetched_at: string;
  checksum: string | null;
  raw_payload_json: any;
};

const NOISE_THRESHOLD = 50;
const MIN_NOISY_RUNS = 3;

const SourceLedger = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [source, setSource] = useState<SourceRow | null>(null);
  const [runs, setRuns] = useState<SourceSyncRunRow[]>([]);
  const [rawJobs, setRawJobs] = useState<RawJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !id) return;
    const load = async () => {
      setLoading(true);
      const [sourceRes, runsRes, rawRes] = await Promise.all([
        (supabase as any).from('sources').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
        (supabase as any).from('source_sync_runs').select('*').eq('source_id', id).eq('user_id', user.id).order('started_at', { ascending: false }).limit(50),
        (supabase as any).from('raw_jobs').select('*').eq('source_id', id).eq('user_id', user.id).order('fetched_at', { ascending: false }).limit(25),
      ]);

      setSource((sourceRes.data as SourceRow | null) ?? null);
      setRuns((runsRes.data as SourceSyncRunRow[]) ?? []);
      setRawJobs((rawRes.data as RawJobRow[]) ?? []);
      setLoading(false);
    };

    load();
  }, [id, user]);

  const summary = useMemo(() => {
    const noisyRuns = runs.slice(0, MIN_NOISY_RUNS);
    const seen = noisyRuns.reduce((sum, run) => sum + Number(run.jobs_seen_count ?? 0), 0);
    const invalid = noisyRuns.reduce((sum, run) => sum + Number(run.jobs_invalid_count ?? 0), 0);
    const latestRun = runs[0] ?? null;
    const recentNoiseRate = seen > 0 ? Math.round((invalid / seen) * 100) : 0;
    const persistentNoise = runs.length >= MIN_NOISY_RUNS && recentNoiseRate >= NOISE_THRESHOLD;
    const totalRunsSeen = runs.reduce((sum, run) => sum + Number(run.jobs_seen_count ?? 0), 0);
    const totalRunsInvalid = runs.reduce((sum, run) => sum + Number(run.jobs_invalid_count ?? 0), 0);
    const totalNoiseRate = totalRunsSeen > 0 ? Math.round((totalRunsInvalid / totalRunsSeen) * 100) : 0;

    return {
      latestRun,
      seen,
      invalid,
      recentNoiseRate,
      persistentNoise,
      totalRunsSeen,
      totalRunsInvalid,
      totalNoiseRate,
    };
  }, [runs]);

  const disableSource = async () => {
    if (!user || !source) return;
    setSaving(true);
    try {
      const [ledgerUpdate, sourceUpdate] = await Promise.all([
        (supabase as any).from('sources').update({ active_flag: false }).eq('id', source.id).eq('user_id', user.id),
        (supabase as any).from('job_sources').update({ enabled: false }).eq('user_id', user.id).eq('source_name', source.source_name),
      ]);

      if (ledgerUpdate.error) throw ledgerUpdate.error;
      if (sourceUpdate.error) {
        console.warn('Failed to disable matching job_sources row:', sourceUpdate.error);
      }

      setSource({ ...source, active_flag: false });
      toast({
        title: 'Source disabled',
        description: `${source.source_name} will no longer be recorded or auto-discovered.`,
      });
    } catch (err: any) {
      toast({
        title: 'Disable failed',
        description: err?.message || 'Could not disable the source.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="animate-fade-in p-8 text-center text-muted-foreground">Loading source ledger...</div>;
  }

  if (!source) {
    return (
      <div className="animate-fade-in space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/" className="gap-2"><ArrowLeft className="w-4 h-4" />Back to Dashboard</Link>
        </Button>
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <AlertTriangle className="w-5 h-5 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium text-foreground">Source not found</p>
            <p className="text-xs text-muted-foreground">This source may not belong to your account or it no longer exists.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={source.active_flag === false ? 'secondary' : 'default'} className="gap-1">
            {source.active_flag === false ? <PauseCircle className="w-3 h-3" /> : <PlayCircle className="w-3 h-3" />}
            {source.active_flag === false ? 'Disabled' : 'Active'}
          </Badge>
          <Badge variant="outline" className="capitalize">{source.adapter_type}</Badge>
        </div>
      </div>

      <PageHeader
        title={source.source_name}
        description="Per-source ledger history, recent raw jobs, and source-quality controls."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Tracked runs</p>
            <p className="text-2xl font-bold text-foreground">{runs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Recent raw jobs</p>
            <p className="text-2xl font-bold text-foreground">{rawJobs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Recent noise</p>
            <p className="text-2xl font-bold text-foreground">{summary.recentNoiseRate}%</p>
            <p className="text-[11px] text-muted-foreground">Latest {MIN_NOISY_RUNS} runs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Total invalid</p>
            <p className="text-2xl font-bold text-foreground">{summary.totalRunsInvalid}</p>
            <p className="text-[11px] text-muted-foreground">Across all recorded runs</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            Source Control
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <p className="text-muted-foreground">Adapter</p>
              <p className="text-foreground">{source.adapter_type}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Base URL</p>
              <p className="text-foreground break-all">{source.base_url || 'Not set'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Auth mode</p>
              <p className="text-foreground">{source.auth_mode || 'unknown'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Created</p>
              <p className="text-foreground">{formatDistanceToNow(new Date(source.created_at), { addSuffix: true })}</p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Noise threshold</p>
                <p className="text-xs text-muted-foreground">
                  Disable is recommended when the latest {MIN_NOISY_RUNS} runs stay at or above {NOISE_THRESHOLD}% invalid.
                </p>
              </div>
              <Badge variant={summary.persistentNoise ? 'destructive' : 'secondary'} className="gap-1">
                <Sparkles className="w-3 h-3" />
                {summary.persistentNoise ? 'Persistently noisy' : 'Within range'}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-md border bg-background p-3">
                <p className="text-muted-foreground">Recent invalid</p>
                <p className="text-base font-semibold text-foreground">{summary.invalid}</p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-muted-foreground">Recent seen</p>
                <p className="text-base font-semibold text-foreground">{summary.seen}</p>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-muted-foreground">Total noise</p>
                <p className={`text-base font-semibold ${summary.totalNoiseRate >= NOISE_THRESHOLD ? 'text-destructive' : 'text-foreground'}`}>{summary.totalNoiseRate}%</p>
              </div>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={saving || source.active_flag === false || !summary.persistentNoise}
                  className="gap-2"
                >
                  <ShieldAlert className="w-4 h-4" />
                  Disable noisy source
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disable this source?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {source.source_name} has stayed above the noise threshold across the latest {MIN_NOISY_RUNS} runs.
                    Disabling it will stop future ledger recording and automated discovery for this source.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={disableSource} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Disable source
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Table2 className="w-4 h-4 text-muted-foreground" />
              source_sync_runs history
            </CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="py-8 text-sm text-muted-foreground text-center">No sync runs recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {runs.map((run) => {
                  const noiseRate = run.jobs_seen_count > 0 ? Math.round((run.jobs_invalid_count / run.jobs_seen_count) * 100) : 0;
                  return (
                    <div key={run.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground capitalize">{run.status}</p>
                          <p className="text-xs text-muted-foreground">
                            {run.run_mode} · {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                          </p>
                        </div>
                        <Badge variant={noiseRate >= NOISE_THRESHOLD ? 'destructive' : 'secondary'} className="text-[10px]">
                          {noiseRate}% noise
                        </Badge>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div className="rounded-md bg-muted/30 p-2">
                          <p className="text-muted-foreground">Seen</p>
                          <p className="font-semibold text-foreground">{run.jobs_seen_count}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 p-2">
                          <p className="text-muted-foreground">Inserted</p>
                          <p className="font-semibold text-foreground">{run.jobs_inserted_count}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 p-2">
                          <p className="text-muted-foreground">Updated</p>
                          <p className="font-semibold text-foreground">{run.jobs_updated_count}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 p-2">
                          <p className="text-muted-foreground">Invalid</p>
                          <p className="font-semibold text-foreground">{run.jobs_invalid_count}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{run.completed_at ? `Completed ${formatDistanceToNow(new Date(run.completed_at), { addSuffix: true })}` : 'Still running'}</span>
                        <span>{run.errors_json?.length ? `${run.errors_json.length} error(s)` : 'No recorded errors'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileJson className="w-4 h-4 text-muted-foreground" />
              Recent raw_jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rawJobs.length === 0 ? (
              <p className="py-8 text-sm text-muted-foreground text-center">No raw job payloads captured yet.</p>
            ) : (
              <div className="space-y-3">
                {rawJobs.map((job) => {
                  const payload = job.raw_payload_json || {};
                  const nestedJob = payload.job || {};
                  const title = nestedJob.title || nestedJob.job_title || 'Untitled job';
                  const company = nestedJob.company || nestedJob.company_name || 'Unknown company';
                  const location = nestedJob.location || nestedJob.location_text || '';
                  const normalizationStatus = nestedJob.normalization_status || payload.normalization_status || 'unknown';
                  return (
                    <div key={job.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{title}</p>
                          <p className="text-xs text-muted-foreground truncate">{company}{location ? ` · ${location}` : ''}</p>
                        </div>
                        <Badge variant={normalizationStatus === 'valid' ? 'default' : 'secondary'} className="text-[10px] capitalize">
                          {normalizationStatus}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md bg-muted/30 p-2">
                          <p className="text-muted-foreground">Fetched</p>
                          <p className="font-semibold text-foreground">{formatDistanceToNow(new Date(job.fetched_at), { addSuffix: true })}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 p-2">
                          <p className="text-muted-foreground">Source job ID</p>
                          <p className="font-semibold text-foreground truncate">{job.source_job_id}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SourceLedger;
