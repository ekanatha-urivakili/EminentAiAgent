import { Settings, Sun, Moon, Monitor, UserCircle, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import type { Theme } from '../lib/types';
import { BrandLogo } from './BrandLogo';

const themes: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'system', icon: Monitor, label: 'System' },
  { value: 'dark', icon: Moon, label: 'Dark' },
];

export function Header({ toggleSidebar, onOpenSettings }: { sidebarOpen: boolean; toggleSidebar: () => void; onOpenSettings: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const backendOk = useStore((s) => s.backendOk);
  const ollamaOk = useStore((s) => s.ollamaOk);
  const admin = useStore((s) => s.admin);
  const logoutAdmin = useStore((s) => s.logoutAdmin);
  const [profileOpen, setProfileOpen] = useState(false);

  const status = !backendOk ? 'Backend offline' : !ollamaOk ? 'Ollama offline' : 'Online';
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
      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <div
          className="text-xs text-muted-foreground bg-muted/60 px-2.5 sm:px-3 py-1.5 rounded-full border border-border flex items-center gap-2"
          title={status}
        >
          <div className={cn('w-2 h-2 rounded-full', statusColor, backendOk && ollamaOk && 'animate-pulse')} />
          <span className="hidden sm:inline">{status}</span>
        </div>

        <div className="hidden sm:flex items-center bg-muted/60 border border-border rounded-full p-0.5">
          {themes.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              title={label}
              className={cn(
                'p-1.5 rounded-full transition-all',
                theme === value
                  ? 'bg-background text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <Settings size={17} />
        </button>
        <div className="relative">
          <button
            onClick={() => setProfileOpen((v) => !v)}
            title="Admin profile"
            className="p-1 rounded-full hover:bg-muted transition-colors"
          >
            <UserCircle size={28} />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-border bg-popover shadow-xl p-2 z-50">
              <div className="px-3 py-2 border-b border-border mb-1">
                <div className="font-medium truncate">{admin?.fullName ?? 'Admin'}</div>
                <div className="text-xs text-muted-foreground truncate">{admin?.email}</div>
              </div>
              <button
                onClick={() => { setProfileOpen(false); onOpenSettings(); }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors"
              >
                <Settings size={15} />
                Settings
              </button>
              <button
                onClick={() => { setProfileOpen(false); logoutAdmin(); }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
