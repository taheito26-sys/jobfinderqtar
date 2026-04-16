import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Briefcase, ArrowRight, ChevronDown, Linkedin } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatAuthBackendLabel, getAuthDebugInfo } from '@/lib/auth-debug';
import { mapSupabaseAuthError } from '@/lib/auth-error-map';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [linkedinLoading, setLinkedinLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const authDebug = getAuthDebugInfo();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw error;
        navigate('/');
      } else {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({ title: 'Account created', description: 'Check your email to confirm your account.' });
      }
    } catch (error: any) {
      const mappedError = mapSupabaseAuthError(error, isLogin ? { operation: 'password_sign_in' } : { operation: 'signup' });
      const isExistingAccountSignup = !isLogin && mappedError.code === 'EMAIL_ALREADY_REGISTERED';

      if (isExistingAccountSignup) {
        setIsLogin(true);
      }

      toast({
        title: mappedError.title,
        description: mappedError.recommendedAction
          ? `${mappedError.description} ${mappedError.recommendedAction}`
          : mappedError.description,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast({ title: 'Enter your email first', description: 'We need the account email to send a reset link.', variant: 'destructive' });
      return;
    }

    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;

      toast({
        title: 'Reset request sent',
        description:
          'If this email belongs to a password-based account in the current backend, Supabase will send a reset link.',
      });
    } catch (error: any) {
      const mappedError = mapSupabaseAuthError(error, { operation: 'password_reset' });
      toast({
        title: mappedError.title,
        description: mappedError.recommendedAction
          ? `${mappedError.description} ${mappedError.recommendedAction}`
          : mappedError.description,
        variant: 'destructive',
      });
    } finally {
      setResetLoading(false);
    }
  };

  const handleLinkedInLogin = async () => {
    setLinkedinLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'linkedin_oidc',
        options: { redirectTo: window.location.origin + '/' },
      });
      if (error) throw error;
    } catch (error: any) {
      const mappedError = mapSupabaseAuthError(error, { operation: 'oauth_sign_in', provider: 'linkedin_oidc' });
      toast({
        title: mappedError.title,
        description: mappedError.recommendedAction
          ? `${mappedError.description} ${mappedError.recommendedAction}`
          : mappedError.description,
        variant: 'destructive',
      });
    } finally {
      setLinkedinLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground mb-2">
            <Briefcase className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">JobOps</h1>
          <p className="text-muted-foreground text-sm">Your intelligent job search operations system</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{isLogin ? 'Sign in' : 'Create account'}</CardTitle>
            <CardDescription>
              {isLogin ? 'Enter your credentials to access your dashboard' : 'Start building your professional profile'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleLinkedInLogin}
              disabled={linkedinLoading}
            >
              <Linkedin className="w-4 h-4 mr-2 text-[#0A66C2]" />
              {linkedinLoading ? 'Redirecting...' : 'Continue with LinkedIn'}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Loading...' : isLogin ? 'Sign in' : 'Create account'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>

            <Collapsible className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" className="group flex h-auto w-full items-center justify-between px-1 py-1.5">
                  <span className="text-sm font-medium text-foreground">Troubleshooting login</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pb-1 pt-2 text-sm text-muted-foreground">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-background">
                    {formatAuthBackendLabel(authDebug)}
                  </Badge>
                  {authDebug.uiAuthMethods.map((method) => (
                    <Badge key={method.key} variant="secondary">
                      {method.label}
                    </Badge>
                  ))}
                </div>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Password login only works for accounts that actually have a password in this auth backend.</li>
                  <li>Same email does not guarantee the same account across different Supabase projects.</li>
                  <li>An account created with LinkedIn may fail password login unless a password was later set.</li>
                  <li>If LinkedIn is disabled in Supabase, LinkedIn-created accounts may be locked out.</li>
                  <li>Reset password only helps password-based accounts in the current backend.</li>
                </ul>
              </CollapsibleContent>
            </Collapsible>

            {isLogin && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">If this account came from LinkedIn, password login may not work unless a password was later added.</p>
                <Button type="button" variant="link" className="px-0" onClick={handlePasswordReset} disabled={resetLoading}>
                  {resetLoading ? 'Sending...' : 'Forgot password?'}
                </Button>
              </div>
            )}
            <div className="text-center">
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
