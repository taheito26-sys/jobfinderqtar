import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, FileText, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

const statusIcons: Record<string, any> = {
  draft: Clock,
  ready_to_apply: FileText,
  approved: CheckCircle2,
  blocked: AlertTriangle,
  submitted: Send,
};

const submissionStatusColors: Record<string, string> = {
  submitted: 'secondary',
  acknowledged: 'default',
  interview: 'default',
  offer: 'default',
  rejected: 'destructive',
  withdrawn: 'outline',
  no_response: 'secondary',
};

const Applications = () => {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [draftRes, subRes] = await Promise.all([
        supabase.from('application_drafts').select('*, jobs(title, company)').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('application_submissions').select('*, jobs(title, company)').eq('user_id', user.id).order('submitted_at', { ascending: false }),
      ]);
      setDrafts(draftRes.data ?? []);
      setSubmissions(subRes.data ?? []);
      setLoading(false);
    };
    load();
  }, [user]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Applications"
        description="Track your application lifecycle from draft to outcome"
      />

      <Tabs defaultValue="drafts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
          <TabsTrigger value="submitted">Submitted ({submissions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts">
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : drafts.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No drafts"
              description="Create application drafts from the Job Detail page."
            />
          ) : (
            <div className="space-y-3">
              {drafts.map(draft => {
                const Icon = statusIcons[draft.status] || Clock;
                return (
                  <Card key={draft.id}>
                    <CardContent className="py-4 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <Icon className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground">{draft.jobs?.title}</h3>
                        <p className="text-sm text-muted-foreground">{draft.jobs?.company}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize">{draft.apply_mode.replace('_', ' ')}</Badge>
                        <Badge variant="secondary" className="text-xs capitalize">{draft.status.replace('_', ' ')}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="submitted">
          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={Send}
              title="No submissions"
              description="Submit approved applications to track their outcomes."
            />
          ) : (
            <div className="space-y-3">
              {submissions.map(sub => (
                <Card key={sub.id}>
                  <CardContent className="py-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                      <Send className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground">{sub.jobs?.title}</h3>
                      <p className="text-sm text-muted-foreground">{sub.jobs?.company}</p>
                    </div>
                    <Badge variant={(submissionStatusColors[sub.submission_status] || 'secondary') as any} className="text-xs capitalize">
                      {sub.submission_status.replace('_', ' ')}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Applications;
