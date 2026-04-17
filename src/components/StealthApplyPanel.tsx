import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EyeOff, Loader2, Clock, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
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

  // Find jobs posted in last 24h with high enough scores
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const freshJobs = jobs.filter(j => {
    const postedAt = parseJobDate(j) ?? new Date(j.created_at);
    const isFresh = postedAt >= twentyFourHoursAgo;
    const match = matches[j.id];
    const hasScore = match && match.overall_score >= minScore;
    const hasApplyUrl = j.apply_url || j.source_url;
    return isFresh && hasScore && hasApplyUrl;
  });

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
          notes: `Stealth Apply - job posted ${formatDistanceToNow(parseJobDate(job) ?? new Date(job.created_at), { addSuffix: true })}`,
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
      toast.success(`Stealth Apply: ${applied} draft${applied > 1 ? 's' : ''} created for fresh jobs`);
      onDraftsCreated();
    }
    setRunning(false);
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <EyeOff className="w-4 h-4 text-primary" />
          Stealth Apply
        </CardTitle>
        <CardDescription className="text-xs">
          Auto-apply to high-scoring jobs posted in the last 24 hours for first-mover advantage
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm">{freshJobs.length} fresh job{freshJobs.length !== 1 ? 's' : ''} eligible</span>
          </div>
          <Badge variant={freshJobs.length > 0 ? 'default' : 'secondary'} className="text-xs">
            Score ≥ {minScore}
          </Badge>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="stealth-tailor" className="text-sm">Auto-tailor CV</Label>
          <Switch id="stealth-tailor" checked={autoTailor} onCheckedChange={setAutoTailor} />
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-sm whitespace-nowrap">Min score:</Label>
          <div className="flex gap-1">
            {[60, 70, 80, 90].map(s => (
              <Button
                key={s}
                variant={minScore === s ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setMinScore(s)}
              >
                {s}+
              </Button>
            ))}
          </div>
        </div>

        <Button
          onClick={runStealthApply}
          disabled={running || freshJobs.length === 0}
          className="w-full gap-1.5"
          size="sm"
        >
          {running ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Running Stealth Apply...</>
          ) : (
            <><Zap className="w-4 h-4" />Run Stealth Apply ({freshJobs.length})</>
          )}
        </Button>

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
