import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GitCompare, CheckCircle2, AlertTriangle, Eye } from 'lucide-react';

const TailoringReview = () => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from('tailored_documents').select('*, jobs(title, company)').eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setDocuments(data ?? []); setLoading(false); });
  }, [user]);

  const statusColor = (s: string) => {
    switch (s) {
      case 'approved': return 'default';
      case 'pending': return 'secondary';
      case 'rejected': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Tailoring Review"
        description="Review and approve tailored documents before applying"
      />

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading...</p>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={GitCompare}
          title="No tailored documents"
          description="Select a job from the Job Feed and click 'Tailor CV' to generate job-specific versions of your CV."
        />
      ) : (
        <div className="space-y-3">
          {documents.map(doc => (
            <Card key={doc.id}>
              <CardContent className="py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <GitCompare className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground">
                    {doc.document_type === 'cv' ? 'Tailored CV' : 'Cover Letter'} — {doc.jobs?.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{doc.jobs?.company} • v{doc.version}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(doc.unsupported_claims as any[])?.length > 0 && (
                    <Badge variant="destructive" className="text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />{(doc.unsupported_claims as any[]).length} claims
                    </Badge>
                  )}
                  <Badge variant={statusColor(doc.approval_status)} className="capitalize text-xs">
                    {doc.approval_status}
                  </Badge>
                  <Button variant="ghost" size="sm"><Eye className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default TailoringReview;
