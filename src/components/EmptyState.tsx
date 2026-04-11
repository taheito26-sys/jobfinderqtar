import { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

const EmptyState = ({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
      <Icon className="w-6 h-6 text-muted-foreground" />
    </div>
    <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
    <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
    {actionLabel && onAction && (
      <Button onClick={onAction} size="sm">{actionLabel}</Button>
    )}
  </div>
);

export default EmptyState;
