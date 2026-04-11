import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ClipboardList } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const Activity = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from('activity_log').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setLogs(data ?? []); setLoading(false); });
  }, [user]);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Activity Log" description="Audit trail of all actions" />

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading...</p>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No activity recorded"
          description="Actions will be logged here as you use the system."
        />
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <Card key={log.id}>
              <CardContent className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{log.action}</span>
                    <span className="text-muted-foreground"> on </span>
                    <Badge variant="outline" className="text-xs">{log.entity_type}</Badge>
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Activity;
