import { Download, X, Share, PlusSquare, MoreVertical } from 'lucide-react';
import { useEffect, useState } from 'react';

type BeforeInstallPromptOutcome = 'accepted' | 'dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: BeforeInstallPromptOutcome; platform: string }>;
};

const installPromptKey = 'eminentai-install-prompt-dismissed';

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as NavigatorWithStandalone).standalone === true;
}

function getMobileOS() {
  const ua = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  return 'Other';
}

function isFirefox() {
  return navigator.userAgent.toLowerCase().includes('firefox');
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    // Don't show if already in standalone app mode
    if (isStandalone()) return;
    
    // Don't show if user dismissed it recently
    const dismissedAt = localStorage.getItem(installPromptKey);
    if (dismissedAt) {
      const now = Date.now();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (now - parseInt(dismissedAt) < oneWeek) return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onAppInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    // For browsers that don't support beforeinstallprompt (Firefox, iOS Safari)
    // We show the prompt after a short delay if they are on mobile or Firefox
    const os = getMobileOS();
    if (os === 'iOS' || os === 'Android' || isFirefox()) {
      const timer = setTimeout(() => {
        if (!installEvent) setVisible(true);
      }, 5000);
      return () => clearTimeout(timer);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [installEvent]);

  const close = () => {
    localStorage.setItem(installPromptKey, Date.now().toString());
    setVisible(false);
  };

  const install = async () => {
    if (installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setVisible(false);
        setInstallEvent(null);
      }
    } else {
      setShowInstructions(true);
    }
  };

  if (!visible) return null;

  const os = getMobileOS();

  return (
    <div className="fixed bottom-4 left-3 right-3 z-[70] mx-auto max-w-md rounded-2xl border border-border bg-popover p-4 shadow-2xl sm:left-auto sm:right-4">
      {!showInstructions ? (
        <>
          <div className="flex items-center gap-4">
            <img src="/brand/eminentai-app-icon.svg" alt="" className="h-12 w-12 rounded-xl shadow-sm" />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-base">Install EminentAi</div>
              <div className="text-sm text-muted-foreground leading-tight">Add the local AI workspace to your home screen or desktop.</div>
            </div>
            <button onClick={close} className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Dismiss">
              <X size={18} />
            </button>
          </div>
          <button
            onClick={() => void install()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Download size={18} />
            Install App
          </button>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base">How to install</h3>
            <button onClick={() => setShowInstructions(false)} className="text-muted-foreground hover:text-foreground">
              <X size={18} />
            </button>
          </div>
          
          <div className="space-y-3 text-sm text-muted-foreground leading-snug">
            {os === 'iOS' ? (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-foreground font-bold">1</div>
                <p>Tap the <Share size={16} className="inline mx-1 text-blue-500" /> **Share** button in the Safari toolbar.</p>
              </div>
            ) : isFirefox() ? (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-foreground font-bold">1</div>
                <p>Tap the <MoreVertical size={16} className="inline mx-1" /> **Menu** button in the browser.</p>
              </div>
            ) : (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-foreground font-bold">1</div>
                <p>Open your browser menu (usually <MoreVertical size={16} className="inline mx-1" />).</p>
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-foreground font-bold">2</div>
              <p>Select **{os === 'iOS' ? 'Add to Home Screen' : 'Install' }** <PlusSquare size={16} className="inline mx-1 text-foreground" />.</p>
            </div>
          </div>

          <button
            onClick={close}
            className="w-full rounded-xl bg-muted text-foreground px-4 py-2 text-sm font-semibold hover:bg-muted/80 transition-colors"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
