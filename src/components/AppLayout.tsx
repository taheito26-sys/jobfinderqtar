import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { ensureJobsHydratedAndScored } from '@/lib/job-hydration';
import {
  LayoutDashboard, User, FileText, Rss, Settings, Send, ClipboardList,
  LogOut, Menu, X, ChevronLeft, Briefcase, GitCompare, Bell as BellIcon, Inbox, BookOpen, ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NotificationBell from '@/components/NotificationBell';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/profile', icon: User, label: 'Profile' },
  { to: '/cv-library', icon: FileText, label: 'CV Library' },
  { to: '/jobs', icon: Rss, label: 'Job Feed' },
  { to: '/subscriptions', icon: BellIcon, label: 'Subscriptions' },
  { to: '/tailoring', icon: GitCompare, label: 'Tailoring' },
  { to: '/applications', icon: Send, label: 'Applications' },
  { to: '/follow-up', icon: Inbox, label: 'Follow-up' },
  { to: '/interview-prep', icon: BookOpen, label: 'Interview Prep' },
  { to: '/hardline', icon: ShieldAlert, label: 'Hardline' },
  { to: '/activity', icon: ClipboardList, label: 'Activity' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const GlobalJobBackfill = ({ user }: { user: any }) => {
  const runningRef = useRef(false);
  const signatureRef = useRef('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const run = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const [jobsRes, matchesRes] = await Promise.all([
          supabase.from('jobs').select('id, apply_url, source_url, description').eq('user_id', user.id),
          supabase.from('job_matches').select('job_id').eq('user_id', user.id),
        ]);

        const matchIds = new Set((matchesRes.data ?? []).map((match: any) => match.job_id));
        const targets = (jobsRes.data ?? [])
          .filter((job: any) => {
            const desc = String(job.description || '').trim();
            return desc.length === 0 || !matchIds.has(job.id);
          })
          .map((job: any) => ({
            id: job.id,
            apply_url: job.apply_url,
            source_url: job.source_url,
            description: job.description,
            has_match: matchIds.has(job.id),
          }));

        const signature = `${user.id}:${targets.map((target) => target.id).join('|')}`;
        if (!targets.length || signatureRef.current === signature) return;
        signatureRef.current = signature;

        await ensureJobsHydratedAndScored(targets);
        if (!cancelled) {
          window.dispatchEvent(new Event('jobs-backfilled'));
        }
      } catch (err) {
        console.warn('Automatic job backfill failed:', err);
      } finally {
        if (!cancelled) {
          runningRef.current = false;
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return null;
};

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { signOut, user } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <GlobalJobBackfill user={user} />
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-foreground/20 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-card border-r border-border transition-all duration-200',
          collapsed ? 'w-16' : 'w-56',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex items-center h-14 px-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-primary-foreground" />
            </div>
            {!collapsed && <span className="font-semibold text-foreground truncate">FindMeAJob</span>}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto hidden lg:flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto lg:hidden text-muted-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border">
          <button
            onClick={signOut}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted w-full transition-colors'
            )}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center h-14 px-4 border-b border-border bg-card">
          <button onClick={() => setMobileOpen(true)} className="text-muted-foreground lg:hidden">
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-3 font-semibold text-foreground lg:hidden">FindMeAJob</span>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
};

export default AppLayout;
