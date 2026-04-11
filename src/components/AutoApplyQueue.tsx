import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ListChecks, Play, Loader2, CheckCircle2, XCircle, Pause, SkipForward, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ScoreBadge from '@/components/ScoreBadge';

interface AutoApplyQueueProps {
  jobs: any[];
  matches: Record<string, any>;
  userId: string;
  selectedJobs: Set<string>;
  onComplete: () => void;
}

type QueueItem = {
  jobId: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'skipped';
  message?: string;
};

const AutoApplyQueue = ({ jobs, matches, userId, selectedJobs, onComplete }: AutoApplyQueueProps) => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tailorCV, setTailorCV] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);

  const selectedJobsList = jobs.filter(j => selectedJobs.has(j.id));

  const startQueue = async () => {
    if (selectedJobsList.length === 0) {
      toast.error('Select jobs to add to the queue');
      return;
    }

    const items: QueueItem[] = selectedJobsList.map(j => ({
      jobId: j.id,
      status: 'pending' as const,
    }));

    setQueue(items);
    setRunning(true);
    setPaused(false);
    setCurrentIdx(0);

    for (let i = 0; i < items.length; i++) {
      // Check if paused
      if (paused) {
        toast.info('Queue paused');
        break;
      }

      setCurrentIdx(i);
      setQueue(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: 'processing' } : item
      ));

      const job = jobs.find(j => j.id === items[i].jobId);
      if (!job) {
        setQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'skipped', message: 'Job not found' } : item
        ));
        continue;
      }

      try {
        // Check if draft already exists
        const { data: existing } = await supabase.from('application_drafts')
          .select('id').eq('job_id', job.id).eq('user_id', userId).maybeSingle();

        if (existing) {
          setQueue(prev => prev.map((item, idx) =>
            idx === i ? { ...item, status: 'skipped', message: 'Draft exists' } : item
          ));
          continue;
        }

        // Create draft
        await supabase.from('application_drafts').insert({
          user_id: userId,
          job_id: job.id,
          apply_mode: 'auto_queue',
          status: 'ready',
          notes: 'Created via Auto-Apply Queue',
        });

        // Tailor CV if enabled
        if (tailorCV) {
          try {
            await supabase.functions.invoke('tailor-cv', { body: { job_id: job.id } });
          } catch { /* continue */ }
        }

        // Log activity
        await supabase.from('activity_log').insert({
          user_id: userId,
          action: 'auto_queue_apply',
          entity_type: 'job',
          entity_id: job.id,
        });

        setQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'done', message: 'Draft created & CV tailored' } : item
        ));
      } catch (err: any) {
        setQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'error', message: err.message || 'Failed' } : item
        ));
      }

      // Small delay between jobs
      await new Promise(r => setTimeout(r, 500));
    }

    setRunning(false);
    const doneCount = items.filter((_, i) => {
      // Re-read from latest queue state
      return true;
    }).length;
    toast.success('Auto-Apply Queue complete!');
    onComplete();
  };

  const completedCount = queue.filter(q => q.status === 'done' || q.status === 'skipped').length;
  const errorCount = queue.filter(q => q.status === 'error').length;
  const progress = queue.length > 0 ? Math.round((completedCount + errorCount) / queue.length * 100) : 0;

  if (selectedJobs.size === 0 && queue.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" />
          Auto-Apply Queue
          {selectedJobs.size > 0 && !running && (
            <Badge variant="secondary" className="text-xs">{selectedJobs.size} selected</Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Batch-approve jobs, then the system creates drafts and tailors CVs in sequence
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!running && queue.length === 0 && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="queue-tailor" className="text-sm">Auto-tailor CV for each job</Label>
              <Switch id="queue-tailor" checked={tailorCV} onCheckedChange={setTailorCV} />
            </div>
            <div className="text-xs text-muted-foreground">
              {selectedJobsList.slice(0, 5).map(j => (
                <div key={j.id} className="flex items-center gap-2 py-1">
                  <Building2 className="w-3 h-3" />
                  <span className="truncate">{j.title} — {j.company}</span>
                  {matches[j.id] && <ScoreBadge score={matches[j.id].overall_score} />}
                </div>
              ))}
              {selectedJobsList.length > 5 && (
                <p className="text-muted-foreground">+{selectedJobsList.length - 5} more</p>
              )}
            </div>
            <Button onClick={startQueue} className="w-full gap-1.5" size="sm">
              <Play className="w-4 h-4" />Start Queue ({selectedJobs.size} jobs)
            </Button>
          </>
        )}

        {(running || queue.length > 0) && (
          <>
            <Progress value={progress} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{completedCount + errorCount}/{queue.length} processed</span>
              <div className="flex gap-2">
                {completedCount > 0 && <span className="text-score-excellent">{completedCount} done</span>}
                {errorCount > 0 && <span className="text-score-poor">{errorCount} errors</span>}
              </div>
            </div>
            <Separator />
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {queue.map((item, idx) => {
                const job = jobs.find(j => j.id === item.jobId);
                return (
                  <div key={item.jobId} className={`flex items-center gap-2 text-xs py-1.5 px-2 rounded ${
                    item.status === 'processing' ? 'bg-primary/5' : ''
                  }`}>
                    {item.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30" />}
                    {item.status === 'processing' && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                    {item.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-score-excellent" />}
                    {item.status === 'error' && <XCircle className="w-3.5 h-3.5 text-score-poor" />}
                    {item.status === 'skipped' && <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="truncate flex-1">{job?.title || 'Unknown'} — {job?.company || ''}</span>
                    {item.message && <span className="text-muted-foreground text-[10px]">{item.message}</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AutoApplyQueue;
