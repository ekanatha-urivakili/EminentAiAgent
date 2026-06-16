import { Menu } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { BrandLogo } from './BrandLogo';

export function Header({ toggleSidebar }: { sidebarOpen: boolean; toggleSidebar: () => void }) {
  const backendOk = useStore((s) => s.backendOk);
  const ollamaOk  = useStore((s) => s.ollamaOk);

  const status      = !backendOk ? 'Backend offline' : !ollamaOk ? 'Ollama offline' : 'Online';
  const statusColor = backendOk && ollamaOk ? 'bg-emerald-500' : 'bg-red-500';

  return (
    <div className="h-14 border-b border-border flex items-center gap-2 px-4 bg-background/80 backdrop-blur-md sticky top-0 z-30">
      <button
        onClick={toggleSidebar}
        className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors md:hidden"
        title="Open menu"
      >
        <Menu size={20} />
      </button>
      <BrandLogo compact className="h-8 w-8 md:hidden" />

      <div className="ml-auto">
        <div
          className="text-xs text-muted-foreground bg-muted/60 px-2.5 sm:px-3 py-1.5 rounded-full border border-border flex items-center gap-2"
          title={status}
        >
          <div className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColor, backendOk && ollamaOk && 'animate-pulse')} />
          <span className="hidden sm:inline">{status}</span>
        </div>
      </div>
    </div>
  );
}
