import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EyeOff, Loader2, Clock, Zap, CheckCircle2, AlertCircle, ShieldCheck, FileText, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { parseJobDate } from '@/lib/job-date';

interface StealthApplyPanelProps {
  jobs: any[];
  matches: Record<string, any>;
  userId: string;
  onDraftsCreated: () => void;
}

const StealthApplyPanel = ({ jobs, matches, userId, onDraftsCreated }: StealthApplyPanelProps) => {
  const [running, setRunning] = useState(false);
  const [minScore, setMinScore] = useState(70);
  const [autoTailor, setAutoTailor] = useState(true);
  const [results, setResults] = useState<{ applied: number; skipped: number; errors: number } | null>(null);

  const freshJobs = useMemo(() => {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    return jobs.filter(j => {
      const postedAt = parseJobDate(j) ?? new Date(j.created_at);
      const isFresh = postedAt >= twentyFourHoursAgo;
      const match = matches[j.id];
      const hasScore = Boolean(match && match.overall_score >= minScore);
      const hasApplyUrl = Boolean(j.apply_url || j.source_url);
      return isFresh && hasScore && hasApplyUrl;
    });
  }, [jobs, matches, minScore]);

  const runStealthApply = async () => {
    if (freshJobs.length === 0) return;
    setRunning(true);
    setResults(null);

    let applied = 0;
    let skipped = 0;
    let errors = 0;

    for (const job of freshJobs) {
      try {
        // Check if draft already exists
        const { data: existing } = await supabase.from('application_drafts')
          .select('id').eq('job_id', job.id).eq('user_id', userId).maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Create draft
        await supabase.from('application_drafts').insert({
          user_id: userId,
          job_id: job.id,
          apply_mode: 'stealth',
          status: 'ready',
          notes: `Stealth Draft - job posted ${formatDistanceToNow(parseJobDate(job) ?? new Date(job.created_at), { addSuffix: true })}`,
        });

        // Optionally tailor CV
        if (autoTailor) {
          try {
            await supabase.functions.invoke('tailor-cv', { body: { job_id: job.id } });
          } catch { /* continue if tailoring fails */ }
        }

        // Log
        await supabase.from('activity_log').insert({
          user_id: userId,
          action: 'stealth_apply',
          entity_type: 'job',
          entity_id: job.id,
          details: { score: matches[job.id]?.overall_score },
        });

        applied++;
      } catch {
        errors++;
      }
    }

    setResults({ applied, skipped, errors });
    if (applied > 0) {
      toast.success(`Stealth Drafts: ${applied} draft${applied > 1 ? 's' : ''} created for fresh jobs`);
      onDraftsCreated();
    }
    setRunning(false);
  };

  return (
    <Card className="overflow-hidden border-dashed border-primary/25 bg-gradient-to-br from-background via-background to-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <EyeOff className="w-4 h-4" />
              </span>
              Stealth Draft Builder
            </CardTitle>
            <CardDescription className="text-xs max-w-xl">
              Prepares ready-to-review application drafts for fresh, high-scoring jobs. It does not submit anything externally.
            </CardDescription>
          </div>
          <Badge variant="outline" className="h-6 border-primary/20 bg-primary/5 text-primary text-[10px] uppercase tracking-wide">
            Drafts only
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card/80 p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Clock className="w-3.5 h-3.5" />
              Fresh eligible
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{freshJobs.length}</div>
            <p className="text-xs text-muted-foreground">Jobs posted in the last 24 hours with enough ATS score.</p>
          </div>
          <div className="rounded-xl border bg-card/80 p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Target className="w-3.5 h-3.5" />
              Score gate
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{minScore}+</div>
            <p className="text-xs text-muted-foreground">Only jobs at or above this match score are included.</p>
          </div>
          <div className="rounded-xl border bg-card/80 p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <FileText className="w-3.5 h-3.5" />
              CV tailoring
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{autoTailor ? 'On' : 'Off'}</div>
            <p className="text-xs text-muted-foreground">When enabled, the tailored CV is prepared before the draft is created.</p>
          </div>
        </div>

        <div className="rounded-xl border border-border/80 bg-background/70 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="stealth-tailor" className="text-sm font-medium">Include CV tailoring</Label>
              <p className="text-xs text-muted-foreground">
                If enabled, each draft will also generate a tailored CV version for that job.
              </p>
            </div>
            <Switch id="stealth-tailor" checked={autoTailor} onCheckedChange={setAutoTailor} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Minimum score</Label>
            {[60, 70, 80, 90].map(s => (
              <Button
                key={s}
                variant={minScore === s ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs px-3"
                onClick={() => setMinScore(s)}
              >
                {s}+
              </Button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Only jobs with an application URL and a posted date within the last 24 hours are eligible.
            </span>
            <Badge variant={freshJobs.length > 0 ? 'default' : 'secondary'} className="text-[10px]">
              {freshJobs.length} ready
            </Badge>
          </div>
        </div>

        <Button
          onClick={runStealthApply}
          disabled={running || freshJobs.length === 0}
          className="w-full h-11 gap-2 text-sm font-medium"
          size="lg"
        >
          {running ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Preparing drafts...</>
          ) : (
            <><Zap className="w-4 h-4" />Prepare {freshJobs.length} draft{freshJobs.length !== 1 ? 's' : ''}</>
          )}
        </Button>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border bg-card/80 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5" />
              What happens
            </div>
            <ol className="mt-2 space-y-1 text-xs text-muted-foreground list-decimal list-inside">
              <li>Find jobs posted in the last 24 hours.</li>
              <li>Filter by your selected ATS score gate.</li>
              <li>Create a draft application in your account.</li>
              <li>Optionally prepare a tailored CV for the draft.</li>
            </ol>
          </div>
          <div className="rounded-xl border bg-card/80 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <AlertCircle className="w-3.5 h-3.5" />
              What it does not do
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              It does not click external submit buttons or send applications on other websites. You still review and submit manually.
            </p>
          </div>
        </div>

        {freshJobs.length > 0 && (
          <div className="rounded-xl border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-muted-foreground">Preview eligible jobs</p>
              <Badge variant="outline" className="text-[10px]">
                Top {Math.min(3, freshJobs.length)}
              </Badge>
            </div>
            <div className="space-y-2">
              {freshJobs.slice(0, 3).map((job) => {
                const postedAt = parseJobDate(job) ?? new Date(job.created_at);
                return (
                  <div key={job.id} className="flex items-start justify-between gap-3 rounded-lg bg-background/80 border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{job.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{job.company}{job.location ? ` • ${job.location}` : ''}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium text-foreground">{matches[job.id]?.overall_score ?? 0}%</p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(postedAt, { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {results && (
          <div className="flex gap-3 text-xs pt-1">
            {results.applied > 0 && (
              <span className="flex items-center gap-1 text-score-excellent">
                <CheckCircle2 className="w-3 h-3" />{results.applied} applied
              </span>
            )}
            {results.skipped > 0 && (
              <span className="text-muted-foreground">{results.skipped} skipped</span>
            )}
            {results.errors > 0 && (
              <span className="flex items-center gap-1 text-score-poor">
                <AlertCircle className="w-3 h-3" />{results.errors} errors
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StealthApplyPanel;
