import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

async function syncLinkedInProfile(session: Session) {
  const user = session.user;
  const identity = user.identities?.find(i => i.provider === 'linkedin_oidc');
  if (!identity) return;

  const claims = identity.identity_data || {};
  const { error } = await supabase.from('linkedin_profiles').upsert({
    user_id: user.id,
    linkedin_sub: identity.id,
    full_name: claims.full_name || claims.name || null,
    email: claims.email || user.email || null,
    avatar_url: claims.avatar_url || claims.picture || null,
    headline: claims.headline || null,
    profile_url: claims.profile_url || null,
    raw_claims: claims,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) console.error('LinkedIn profile sync error:', error.message);
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (import.meta.env.DEV) {
        const hasLinkedInIdentity = Boolean(nextSession?.user?.identities?.some((identity) => identity.provider === 'linkedin_oidc'));
        console.debug('[auth]', {
          event,
          hasSession: Boolean(nextSession),
          hasLinkedInIdentity,
        });
      }

      setSession(nextSession);
      setLoading(false);

      // Sync LinkedIn profile data on sign-in (non-blocking)
      if (nextSession && event === 'SIGNED_IN') {
        syncLinkedInProfile(nextSession);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (import.meta.env.DEV) {
        const hasLinkedInIdentity = Boolean(session?.user?.identities?.some((identity) => identity.provider === 'linkedin_oidc'));
        console.debug('[auth]', {
          event: 'INITIAL_SESSION',
          hasSession: Boolean(session),
          hasLinkedInIdentity,
        });
      }

      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
