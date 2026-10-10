import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
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

const tabItems = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/jobs', icon: Rss, label: 'Jobs' },
  { to: '/applications', icon: Send, label: 'Applied' },
  { to: '/cv-library', icon: FileText, label: 'CVs' },
];

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-foreground/20 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-card border-r border-border transition-all duration-200',
          collapsed ? 'lg:w-16' : 'lg:w-56',
          'w-64 max-w-[85vw] pt-[env(safe-area-inset-top)]',
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
            aria-label="Close menu" className="ml-auto lg:hidden text-muted-foreground p-2 -mr-2"
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

        <div className="p-2 border-t border-border pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
        <header className="flex items-center h-14 px-4 border-b border-border bg-card pt-[env(safe-area-inset-top)] box-content">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="text-muted-foreground lg:hidden -ml-2 p-2">
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-3 font-semibold text-foreground lg:hidden">FindMeAJob</span>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:p-6 lg:pb-6">{children}</main>

        {/* Mobile bottom tab bar */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          {tabItems.map(({ to, icon: Icon, label }) => {
            const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[11px] font-medium',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="w-5 h-5" />
                {label}
              </Link>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[11px] font-medium text-muted-foreground"
          >
            <Menu className="w-5 h-5" />
            More
          </button>
        </nav>
      </div>
    </div>
  );
};

export default AppLayout;
