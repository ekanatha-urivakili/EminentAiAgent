import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type BeforeInstallPromptOutcome = 'accepted' | 'dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: BeforeInstallPromptOutcome; platform: string }>;
};

const installPromptKey = 'eminentai-install-prompt-dismissed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(installPromptKey) === 'true') return;

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

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const close = () => {
    localStorage.setItem(installPromptKey, 'true');
    setVisible(false);
  };

  const install = async () => {
    if (!installEvent) return;

    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setVisible(false);
      setInstallEvent(null);
    }
  };

  if (!visible || !installEvent) return null;

  return (
    <div className="fixed bottom-4 left-3 right-3 z-[70] mx-auto max-w-md rounded-2xl border border-border bg-popover p-3 shadow-2xl sm:left-auto sm:right-4">
      <div className="flex items-center gap-3">
        <img src="/brand/eminentai-app-icon.svg" alt="" className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Install EminentAI</div>
          <div className="text-xs text-muted-foreground">Add the local AI app to your home screen or desktop.</div>
        </div>
        <button onClick={close} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" title="Dismiss install prompt">
          <X size={16} />
        </button>
      </div>
      <button
        onClick={() => void install()}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-sm font-medium text-background"
      >
        <Download size={16} />
        Install app
      </button>
    </div>
  );
}
