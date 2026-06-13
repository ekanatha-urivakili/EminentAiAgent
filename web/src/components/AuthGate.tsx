import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useStore } from '../state/store';
import { BrandLogo } from './BrandLogo';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
const mailpitUrl = 'http://localhost:8025';

function getResetToken(): string | null {
  return new URLSearchParams(window.location.search).get('token');
}

export function AuthGate({ children }: { children: ReactNode }) {
  const admin = useStore((s) => s.admin);
  const authLoading = useStore((s) => s.authLoading);
  const authError = useStore((s) => s.authError);
  const registerAdmin = useStore((s) => s.registerAdmin);
  const loginAdmin = useStore((s) => s.loginAdmin);
  const forgotPassword = useStore((s) => s.forgotPassword);
  const resetPassword = useStore((s) => s.resetPassword);

  const [mode, setMode] = useState<AuthMode>(() => (getResetToken() ? 'reset' : 'login'));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  if (admin) return <>{children}</>;

  const clearMessages = () => { setInfoMsg(''); setLocalError(''); setForgotSent(false); };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearMessages();

    if (mode === 'register') {
      void registerAdmin(fullName, email, password);
      return;
    }

    if (mode === 'login') {
      void loginAdmin(email, password);
      return;
    }

    if (mode === 'forgot') {
      setLoading(true);
      const res = await forgotPassword(email);
      setLoading(false);
      if (res.ok) {
        setInfoMsg(res.message ?? 'Check your email for the reset link.');
        setForgotSent(true);
      } else {
        setLocalError(res.error ?? 'Something went wrong.');
      }
      return;
    }

    if (mode === 'reset') {
      if (newPassword !== confirmPassword) { setLocalError('Passwords do not match.'); return; }
      if (newPassword.length < 8) { setLocalError('Password must be at least 8 characters.'); return; }
      const token = getResetToken();
      if (!token) { setLocalError('No reset token found in URL.'); return; }
      setLoading(true);
      const res = await resetPassword(token, newPassword);
      setLoading(false);
      if (res.ok) {
        setInfoMsg(res.message ?? 'Password updated. You can now log in.');
        // Strip token from URL without reload.
        window.history.replaceState({}, '', window.location.pathname);
        setMode('login');
      } else {
        setLocalError(res.error ?? 'Something went wrong.');
      }
    }
  };

  const isWorking = loading || authLoading;
  const error = localError || authError;

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <BrandLogo compact className="h-11 w-11" />
          <div>
            <h1 className="text-xl font-semibold">EminentAi Admin</h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'register' ? 'Create your admin profile'
                : mode === 'forgot' ? 'Reset your password'
                : mode === 'reset' ? 'Set a new password'
                : 'Sign in to continue'}
            </p>
          </div>
        </div>

        {/* Tab bar — only for login/register */}
        {(mode === 'login' || mode === 'register') && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 mb-5">
            <button type="button" onClick={() => { setMode('login'); clearMessages(); }}
              className={mode === 'login' ? 'rounded-md bg-background py-2 text-sm shadow-sm' : 'py-2 text-sm text-muted-foreground'}>
              Login
            </button>
            <button type="button" onClick={() => { setMode('register'); clearMessages(); }}
              className={mode === 'register' ? 'rounded-md bg-background py-2 text-sm shadow-sm' : 'py-2 text-sm text-muted-foreground'}>
              Register
            </button>
          </div>
        )}

        <div className="space-y-3">
          {mode === 'register' && (
            <input value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name" required
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
          )}

          {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Email" type="email" required
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
          )}

          {(mode === 'login' || mode === 'register') && (
            <div>
              <input value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password" type="password" required
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
              {mode === 'login' && (
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => { setMode('forgot'); clearMessages(); }}
                    className="text-sm font-medium text-primary hover:text-primary/80 underline underline-offset-4">
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'reset' && (
            <>
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password" type="password" required minLength={8}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
              <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password" type="password" required
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
            </>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {infoMsg && <p className="mt-3 text-sm text-green-600 dark:text-green-400">{infoMsg}</p>}
        {mode === 'forgot' && forgotSent && (
          <a
            href={mailpitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex w-full items-center justify-center rounded-lg border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Open Mailpit
          </a>
        )}

        <button type="submit" disabled={isWorking}
          className="mt-5 w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium disabled:opacity-60">
          {isWorking ? 'Please wait...'
            : mode === 'register' ? 'Create admin'
            : mode === 'forgot' ? 'Send reset link'
            : mode === 'reset' ? 'Set new password'
            : 'Login'}
        </button>

        {/* Back to login link — for forgot/reset modes */}
        {(mode === 'forgot' || mode === 'reset') && (
          <div className="mt-3 text-center">
            <button type="button" onClick={() => { setMode('login'); clearMessages(); }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              Back to login
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
