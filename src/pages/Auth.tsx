import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Briefcase, ArrowRight, Linkedin } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [linkedinLoading, setLinkedinLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

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
      console.error('Auth error:', error);
      const isExistingAccountSignup =
        !isLogin && (error?.message === 'Database error saving new user' || error?.status === 500);

      if (isExistingAccountSignup) {
        setIsLogin(true);
      }

      const description =
        isLogin && (error?.message === 'Invalid login credentials' || error?.status === 400)
          ? 'That password does not match this account. If this account was created with LinkedIn, use Continue with LinkedIn. Otherwise, request a password reset.'
          : isExistingAccountSignup
            ? 'That email is already registered. Switch to Sign in and use your password instead.'
          : error?.message ?? 'Something went wrong.';

      toast({ title: 'Error', description, variant: 'destructive' });
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
        title: 'Reset link sent',
        description: 'Check your email for the password reset link and then come back here to sign in.',
      });
    } catch (error: any) {
      console.error('Password reset error:', error);
      toast({ title: 'Reset failed', description: error?.message ?? 'Could not send the reset link.', variant: 'destructive' });
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
      console.error('LinkedIn sign-in error:', error);
      toast({ title: 'LinkedIn sign-in failed', description: error.message, variant: 'destructive' });
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
            {isLogin && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">If this account came from LinkedIn, password login will not work.</p>
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
