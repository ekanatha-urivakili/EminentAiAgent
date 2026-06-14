import { Sun, Moon, Monitor, UserCircle, LogOut, Menu, Palette, KeyRound, ChevronDown, Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import type { Theme } from '../lib/types';
import { BrandLogo } from './BrandLogo';

const themes: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: 'light',  icon: Sun,     label: 'Light'  },
  { value: 'system', icon: Monitor, label: 'System' },
  { value: 'dark',   icon: Moon,    label: 'Dark'   },
  { value: 'navy',   icon: Palette, label: 'Navy'   },
];

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function Header({ toggleSidebar }: { sidebarOpen: boolean; toggleSidebar: () => void }) {
  const theme      = useStore((s) => s.theme);
  const setTheme   = useStore((s) => s.setTheme);
  const backendOk  = useStore((s) => s.backendOk);
  const ollamaOk   = useStore((s) => s.ollamaOk);
  const admin      = useStore((s) => s.admin);
  const logoutAdmin = useStore((s) => s.logoutAdmin);
  const changePassword = useStore((s) => s.changePassword);

  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen]     = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError]     = useState('');
  const [pwDone, setPwDone]       = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const closePanel = () => { setOpen(false); setPwOpen(false); resetPw(); };

  const resetPw = () => {
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    setPwError(''); setPwDone(false); setPwLoading(false);
  };

  const submitPasswordChange = async () => {
    if (!newPw || !currentPw) { setPwError('All fields are required.'); return; }
    if (newPw !== confirmPw)  { setPwError('New passwords do not match.'); return; }
    if (newPw.length < 8)     { setPwError('New password must be at least 8 characters.'); return; }
    setPwLoading(true); setPwError('');
    const result = await changePassword(currentPw, newPw);
    setPwLoading(false);
    if (result.ok) { setPwDone(true); resetPw(); setPwDone(true); }
    else setPwError(result.error ?? 'Failed to change password.');
  };

  const status      = !backendOk ? 'Backend offline' : !ollamaOk ? 'Ollama offline' : 'Online';
  const statusColor = backendOk && ollamaOk ? 'bg-emerald-500' : 'bg-red-500';
  const adminInitials = initials(admin?.fullName ?? 'A');

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

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Status pill */}
        <div
          className="text-xs text-muted-foreground bg-muted/60 px-2.5 sm:px-3 py-1.5 rounded-full border border-border flex items-center gap-2"
          title={status}
        >
          <div className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColor, backendOk && ollamaOk && 'animate-pulse')} />
          <span className="hidden sm:inline">{status}</span>
        </div>

        {/* Profile button */}
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            title="Account"
            className="flex items-center gap-1.5 p-1 rounded-full hover:bg-muted transition-colors"
          >
            {admin ? (
              <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center select-none">
                {adminInitials}
              </span>
            ) : (
              <UserCircle size={28} className="text-muted-foreground" />
            )}
            <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-border bg-popover shadow-2xl z-50 overflow-hidden">

              {/* ── Admin identity ─────────────────────────────────── */}
              <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-border">
                <div className="w-11 h-11 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center flex-shrink-0 select-none">
                  {adminInitials}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{admin?.fullName ?? 'Admin'}</div>
                  <div className="text-xs text-muted-foreground truncate">{admin?.email ?? '—'}</div>
                </div>
              </div>

              {/* ── Appearance ─────────────────────────────────────── */}
              <div className="px-4 py-3 border-b border-border">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Appearance</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {themes.map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      className={cn(
                        'flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-xs font-medium border transition-all',
                        theme === value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-transparent hover:border-border hover:bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon size={15} />
                      {label}
                      {theme === value && <Check size={10} className="text-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Change password ─────────────────────────────────── */}
              <div className="px-4 py-3 border-b border-border">
                <button
                  onClick={() => { setPwOpen((v) => !v); resetPw(); }}
                  className="flex items-center justify-between w-full text-sm font-medium hover:text-foreground text-muted-foreground transition-colors"
                >
                  <span className="flex items-center gap-2"><KeyRound size={15} /> Change password</span>
                  <ChevronDown size={14} className={cn('transition-transform', pwOpen && 'rotate-180')} />
                </button>

                {pwOpen && (
                  <div className="mt-3 space-y-2">
                    {pwDone && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <Check size={12} /> Password changed successfully.
                      </p>
                    )}
                    {pwError && (
                      <p className="text-xs text-destructive flex items-center gap-1.5">
                        <X size={12} /> {pwError}
                      </p>
                    )}
                    <input
                      type="password"
                      placeholder="Current password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      type="password"
                      placeholder="New password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void submitPasswordChange(); }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      onClick={() => void submitPasswordChange()}
                      disabled={pwLoading}
                      className="w-full py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
                    >
                      {pwLoading && <Loader2 size={13} className="animate-spin" />}
                      Update password
                    </button>
                  </div>
                )}
              </div>

              {/* ── Sign out ────────────────────────────────────────── */}
              <div className="px-4 py-2">
                <button
                  onClick={() => { closePanel(); logoutAdmin(); }}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
