import { useEffect, useState } from 'react';
import { Download, Share, X, PlusSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed-at';
const DISMISS_DAYS = 7;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const recentlyDismissed = () => {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY));
    return t && Date.now() - t < DISMISS_DAYS * 864e5;
  } catch {
    return false;
  }
};

/** Mobile "install app" banner: native prompt on Android/Chrome, Add-to-Home-Screen steps on iOS. */
const InstallPrompt = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [visible, setVisible] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    if (isStandalone() || recentlyDismissed()) return;
    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    if (!mobile) return;

    if (isIOS()) {
      setIos(true);
      setVisible(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
  };

  const install = async () => {
    if (ios) return setShowSteps((s) => !s);
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === 'accepted') setVisible(false); else dismiss();
  };

  if (!visible) return null;

  return (
    <div className="lg:hidden fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-lg flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Install FindMeAJob</p>
          <p className="text-xs text-muted-foreground">Add it to your home screen for a full-screen app.</p>
        </div>
        <Button size="sm" onClick={install}>
          <Download className="w-4 h-4 mr-1" />
          {ios ? 'How' : 'Install'}
        </Button>
        <button onClick={dismiss} aria-label="Dismiss" className="p-1 text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      {ios && showSteps && (
        <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">1. Tap <Share className="w-4 h-4 text-primary" /> Share in Safari's toolbar</li>
          <li className="flex items-center gap-2">2. Choose <PlusSquare className="w-4 h-4 text-primary" /> Add to Home Screen</li>
          <li>3. Tap Add</li>
        </ol>
      )}
    </div>
  );
};

export default InstallPrompt;
