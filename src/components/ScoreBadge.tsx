import { cn } from '@/lib/utils';

interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const getScoreColor = (score: number) => {
  if (score >= 80) return 'text-score-excellent bg-score-excellent/10 border-score-excellent/30';
  if (score >= 60) return 'text-score-good bg-score-good/10 border-score-good/30';
  if (score >= 40) return 'text-score-fair bg-score-fair/10 border-score-fair/30';
  return 'text-score-poor bg-score-poor/10 border-score-poor/30';
};

const getScoreLabel = (score: number) => {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Low';
};

const ScoreBadge = ({ score, size = 'md', showLabel = false }: ScoreBadgeProps) => {
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5 font-semibold',
  };

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border font-mono', getScoreColor(score), sizeClasses[size])}>
      {score}
      {showLabel && <span className="font-sans text-xs opacity-80">— {getScoreLabel(score)}</span>}
    </span>
  );
};

export default ScoreBadge;
