import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface QuickApplyButtonProps {
  job: any;
  userId: string;
  size?: 'sm' | 'default';
  className?: string;
}

const QuickApplyButton = ({ job, userId, size = 'sm', className = '' }: QuickApplyButtonProps) => {
  const [applying, setApplying] = useState(false);

  const handleQuickApply = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setApplying(true);

    try {
      // 1. Create application draft
      const { data: draft, error: draftError } = await supabase.from('application_drafts').insert({
        user_id: userId,
        job_id: job.id,
        apply_mode: 'assisted',
        status: 'ready',
        notes: 'Created via Quick Apply',
      }).select().single();

      if (draftError) throw draftError;

      // 2. Trigger CV tailoring
      toast.info('Tailoring your CV...', { id: 'quick-apply' });
      try {
        await supabase.functions.invoke('tailor-cv', {
          body: { job_id: job.id },
        });
        toast.success('CV tailored for this job', { id: 'quick-apply' });
      } catch {
        toast.info('CV tailoring skipped — draft created', { id: 'quick-apply' });
      }

      // 3. Log activity
      await supabase.from('activity_log').insert({
        user_id: userId,
        action: 'quick_apply',
        entity_type: 'job',
        entity_id: job.id,
        details: { job_title: job.title, company: job.company },
      });

      // 4. Open apply URL
      const applyUrl = job.apply_url || job.source_url;
      if (applyUrl) {
        window.open(applyUrl, '_blank', 'noopener,noreferrer');
        toast.success(`Quick Apply complete — application page opened for ${job.company}`, { id: 'quick-apply' });
      } else {
        toast.success(`Draft created for ${job.title} at ${job.company}. No apply URL found — apply manually.`, { id: 'quick-apply' });
      }
    } catch (err: any) {
      toast.error('Quick Apply failed: ' + (err.message || 'Unknown error'));
    }

    setApplying(false);
  };

  return (
    <Button
      variant="default"
      size={size}
      className={`gap-1 ${className}`}
      onClick={handleQuickApply}
      disabled={applying}
      title="Quick Apply: Create draft, tailor CV, open apply page"
    >
      {applying ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Zap className="w-3.5 h-3.5" />
      )}
      {size !== 'sm' && (applying ? 'Applying...' : 'Quick Apply')}
    </Button>
  );
};

export default QuickApplyButton;
