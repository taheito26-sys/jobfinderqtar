import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import { ArrowRight, Briefcase, CheckCircle2, LockKeyhole } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const ResetPassword = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;

      if (event === 'PASSWORD_RECOVERY') {
        setSession(nextSession);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nextPassword = password.trim();
    if (nextPassword.length < 6) {
      toast({
        title: 'Password too short',
        description: 'Use at least 6 characters.',
        variant: 'destructive',
      });
      return;
    }

    if (nextPassword !== confirmPassword.trim()) {
      toast({
        title: 'Passwords do not match',
        description: 'Please enter the same password twice.',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: nextPassword });
      if (error) throw error;

      setIsComplete(true);
      toast({
        title: 'Password updated',
        description: 'You can now sign in with your new password.',
      });
      setTimeout(() => navigate('/auth', { replace: true }), 1200);
    } catch (error: any) {
      toast({
        title: 'Reset failed',
        description: error?.message ?? 'Could not update the password.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const hasResetSession = Boolean(session);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground mb-2">
            <Briefcase className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">JobOps</h1>
          <p className="text-muted-foreground text-sm">Set a new password for your account</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Reset password</CardTitle>
            <CardDescription>
              {hasResetSession
                ? 'Choose a new password to finish the reset flow.'
                : 'Open the password reset link from your email to continue.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!loading && !hasResetSession && (
              <Alert>
                <LockKeyhole className="h-4 w-4" />
                <AlertTitle>Waiting for recovery session</AlertTitle>
                <AlertDescription>
                  If you already clicked the email link, refresh this page once more. Otherwise, request a new reset email from sign in.
                </AlertDescription>
              </Alert>
            )}

            {hasResetSession && !isComplete && (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Choose a new password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? 'Saving...' : 'Update password'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </form>
            )}

            {isComplete && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Password updated</AlertTitle>
                <AlertDescription>Redirecting you back to sign in now.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ResetPassword;
