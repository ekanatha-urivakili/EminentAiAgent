import { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw, Play, ChevronLeft, Inbox, AlertCircle, Check, Copy, ChevronDown, ExternalLink, Terminal, Download, Container, Apple, Monitor } from 'lucide-react';
import { cn } from '../lib/utils';

// Requests go through Vite's dev proxy (/mailpit-api → http://localhost:8025)
// to avoid CORS issues when the browser fetches cross-origin.
const MAILPIT_BASE = '/mailpit-api';
const MAILPIT_UI = 'http://localhost:8025';

interface MpAddress { Address: string; Name: string; }

interface MpMessage {
  ID: string;
  MessageID: string;
  Read: boolean;
  From: MpAddress;
  To: MpAddress[];
  Subject: string;
  Created: string;
  Size: number;
  Attachments: number;
  Snippet: string;
}

interface MpMessagesResponse {
  total: number;
  unread: number;
  messages: MpMessage[];
}

interface MpMessageDetail {
  ID: string;
  Subject: string;
  From: MpAddress;
  To: MpAddress[];
  Date: string;
  Text: string;
  HTML: string;
  Attachments: { FileName: string; ContentType: string; Size: number }[];
}

async function fetchMessages(): Promise<MpMessagesResponse> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/messages?limit=50`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Mailpit returned ${res.status}`);
  return res.json() as Promise<MpMessagesResponse>;
}

async function fetchDetail(id: string): Promise<MpMessageDetail> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/message/${id}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Mailpit returned ${res.status}`);
  return res.json() as Promise<MpMessageDetail>;
}

async function startMailpit(): Promise<string> {
  const res = await fetch('http://127.0.0.1:5210/api/mailpit/start', { method: 'POST', signal: AbortSignal.timeout(10000) });
  const data = await res.json() as { message: string };
  return data.message ?? 'Started';
}

// ── Shared utilities ──────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="flex-shrink-0 p-1.5 rounded hover:bg-muted-foreground/20 transition-colors" title="Copy">
      {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} className="text-muted-foreground" />}
    </button>
  );
}

function CodeLine({ cmd }: { cmd: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/70 border border-border px-3 py-2 font-mono text-xs">
      <span className="select-all break-all">{cmd}</span>
      <CopyButton text={cmd} />
    </div>
  );
}

// ── Installation guide (shown when Mailpit is unreachable) ────────────────────
function MailpitInstallGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
      >
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Download size={16} className="text-muted-foreground" />
          Installation guide — Mailpit local mail catcher
        </div>
        <ChevronDown size={16} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="px-5 py-5 space-y-7 border-t border-border">

          <p className="text-sm text-muted-foreground">
            Mailpit is a lightweight SMTP mail catcher for development. It listens on port <code className="bg-muted px-1 rounded">1025</code> (SMTP)
            and serves a web UI on <code className="bg-muted px-1 rounded">8025</code>. Choose the method that fits your setup:
          </p>

          {/* Option A — No Docker needed (binary) */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Apple size={16} className="text-muted-foreground" />
                <h3 className="font-semibold text-sm">Option A — No Docker needed (recommended for macOS)</h3>
              </div>
              <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium border border-emerald-500/20">Simplest</span>
            </div>
            <div className="space-y-3 ml-0">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">macOS — Homebrew</p>
                <div className="space-y-1.5">
                  <CodeLine cmd="brew install axllent/tap/mailpit" />
                  <CodeLine cmd="mailpit" />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Mailpit starts immediately. SMTP on :1025, web UI at http://localhost:8025.</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">macOS — run as background service (auto-starts on login)</p>
                <CodeLine cmd="brew services start axllent/tap/mailpit" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Linux / macOS — download binary directly from GitHub releases</p>
                <a
                  href="https://github.com/axllent/mailpit/releases"
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mb-2"
                >
                  <ExternalLink size={12} /> github.com/axllent/mailpit/releases
                </a>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground font-medium">Or use the installer script (any platform):</p>
                  <CodeLine cmd="curl -sL https://raw.githubusercontent.com/axllent/mailpit/develop/install.sh | bash" />
                  <CodeLine cmd="mailpit" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Windows — download .exe from GitHub releases above, then:</p>
                <CodeLine cmd="mailpit.exe" />
              </div>
            </div>
          </section>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground">or, if you have Docker</span>
            <div className="flex-1 border-t border-border" />
          </div>

          {/* Option B — Docker Compose */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Container size={16} className="text-muted-foreground" />
              <h3 className="font-semibold text-sm">Option B — Docker Compose (if Docker is already installed)</h3>
            </div>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                A <code className="bg-muted px-1 rounded">docker-compose.yml</code> is already included in this project.
                If Docker Desktop (or an alternative) is running, just start the Mailpit service:
              </p>
              <CodeLine cmd="docker compose up -d mailpit" />
              <p className="text-xs text-muted-foreground">
                Or click the <span className="font-medium">Start Mailpit</span> button above — EminentAI will run this command for you.
              </p>
            </div>
          </section>

          {/* Option C — Docker alternatives */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={16} className="text-muted-foreground" />
              <h3 className="font-semibold text-sm">Option C — Docker alternatives (lighter than Docker Desktop)</h3>
            </div>
            <div className="space-y-4 text-sm">

              {/* OrbStack */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">OrbStack</span>
                  <span className="text-xs text-muted-foreground">macOS only · free for personal use</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Fast, lightweight Docker Desktop replacement for macOS. Uses ~50 MB RAM at idle vs ~500 MB for Docker Desktop.
                  Fully compatible with <code className="bg-muted px-1 rounded">docker compose</code>.
                </p>
                <a href="https://orbstack.dev" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <ExternalLink size={12} /> orbstack.dev
                </a>
                <div className="space-y-1.5 mt-2">
                  <CodeLine cmd="brew install orbstack" />
                  <CodeLine cmd="docker compose up -d mailpit" />
                </div>
              </div>

              {/* Rancher Desktop */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Rancher Desktop</span>
                  <span className="text-xs text-muted-foreground">macOS / Windows / Linux · free, open source</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Open-source Docker alternative with a GUI. Includes both Docker and containerd runtimes.
                </p>
                <a href="https://rancherdesktop.io" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <ExternalLink size={12} /> rancherdesktop.io
                </a>
              </div>

              {/* Podman */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Podman Desktop</span>
                  <span className="text-xs text-muted-foreground">macOS / Windows / Linux · free, open source</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Daemonless Docker-compatible runtime. Supports <code className="bg-muted px-1 rounded">docker compose</code> via the Compose plugin.
                </p>
                <a href="https://podman-desktop.io" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <ExternalLink size={12} /> podman-desktop.io
                </a>
              </div>

            </div>
          </section>

          {/* Verify */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Terminal size={16} className="text-muted-foreground" />
              <h3 className="font-semibold text-sm">Verify Mailpit is running</h3>
            </div>
            <div className="space-y-2">
              <CodeLine cmd='curl -s http://localhost:8025/api/v1/messages | head -c 100' />
              <p className="text-xs text-muted-foreground">
                You should see a JSON object with a <code className="bg-muted px-1 rounded">messages</code> array.
                Then click <span className="font-medium">Refresh</span> above — the inbox will load.
              </p>
            </div>
          </section>

          {/* SMTP config reminder */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-600 dark:text-blue-400 space-y-1">
            <p className="font-semibold">SMTP configuration (already set in this project)</p>
            <p>EminentAI sends password-reset emails via <code className="bg-blue-500/10 px-1 rounded">localhost:1025</code> — the Mailpit SMTP port.
              No credentials required. All outgoing mail is captured here instead of being delivered.</p>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export function MailpitView() {
  const [messages, setMessages] = useState<MpMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MpMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startMsg, setStartMsg] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMessages();
      setMessages(data.messages ?? []);
      setTotal(data.total ?? 0);
      setUnread(data.unread ?? 0);
    } catch (err) {
      setError((err as Error).message.includes('fetch') ? 'Mailpit is not running.' : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const openMessage = async (id: string) => {
    setDetailLoading(true);
    try {
      const detail = await fetchDetail(id);
      setSelected(detail);
      setMessages((prev) => prev.map((m) => m.ID === id ? { ...m, Read: true } : m));
      setUnread((n) => Math.max(0, n - (messages.find((m) => m.ID === id && !m.Read) ? 1 : 0)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    setStartMsg('');
    try {
      const msg = await startMailpit();
      setStartMsg(msg);
      await new Promise((r) => setTimeout(r, 1500));
      void load();
    } catch (err) {
      setStartMsg(`Error: ${(err as Error).message}`);
    } finally {
      setStarting(false);
    }
  };

  // Auto-open the guide when Mailpit is unreachable
  const effectiveGuideOpen = guideOpen || !!error;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Mail size={20} className="text-muted-foreground" />
          Mailpit
          {unread > 0 && (
            <span className="text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5">{unread} new</span>
          )}
          {total > 0 && unread === 0 && (
            <span className="text-xs text-muted-foreground">{total} messages</span>
          )}
        </h1>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleStart()}
            disabled={starting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 text-xs font-medium transition-colors disabled:opacity-60"
            title="Start Mailpit via docker compose"
          >
            <Play size={13} className={cn(starting && 'animate-pulse')} />
            {starting ? 'Starting…' : 'Start Mailpit'}
          </button>

          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium transition-colors disabled:opacity-60"
          >
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            Refresh
          </button>

          <a
            href={MAILPIT_UI}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium transition-colors"
          >
            Open UI ↗
          </a>
        </div>
      </div>

      {startMsg && (
        <div className="px-6 py-2 text-xs text-muted-foreground bg-muted/40 border-b border-border">{startMsg}</div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {/* Error + install guide */}
        {error && (
          <div className="max-w-3xl mx-auto px-5 py-6 space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
              <AlertCircle size={16} className="text-destructive flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-destructive">Mailpit is not reachable</span>
                <span className="text-muted-foreground ml-2">{error}</span>
              </div>
            </div>

            <MailpitInstallGuide open={effectiveGuideOpen} onToggle={() => setGuideOpen((v) => !v)} />

            {/* Quick-start commands */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
                <Terminal size={15} /> Quickest way to start — no Docker required
              </div>
              <div className="space-y-2">
                <CodeLine cmd="brew install axllent/tap/mailpit" />
                <CodeLine cmd="mailpit" />
              </div>
              <p className="text-xs text-muted-foreground">
                Then click <span className="font-medium">Refresh</span> above. SMTP is immediately available on :1025 for password-reset emails.
              </p>
            </div>
          </div>
        )}

        {/* Message list + detail (shown when no error) */}
        {!error && (
          <div className="flex h-full min-h-0">
            <div className={cn('flex flex-col border-r border-border overflow-y-auto custom-scrollbar', selected ? 'hidden md:flex md:w-72 lg:w-80 flex-shrink-0' : 'flex-1')}>
              {!loading && messages.length === 0 && (
                <div className="flex flex-col items-center justify-center flex-1 py-16 px-6 text-center gap-3">
                  <Inbox size={32} className="text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No emails yet.</p>
                  <p className="text-xs text-muted-foreground">Password reset emails will appear here.</p>
                </div>
              )}

              {messages.map((m) => (
                <button
                  key={m.ID}
                  onClick={() => void openMessage(m.ID)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-border hover:bg-muted/60 transition-colors',
                    selected?.ID === m.ID && 'bg-muted',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={cn('text-sm truncate', !m.Read && 'font-semibold')}>{m.Subject || '(no subject)'}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{fmtDate(m.Created)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{fmtAddr(m.From)}</div>
                  {m.Snippet && <div className="text-xs text-muted-foreground/70 truncate mt-0.5">{m.Snippet}</div>}
                </button>
              ))}
            </div>

            {/* Detail pane */}
            {selected && (
              <div className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
                <div className="px-6 py-4 border-b border-border">
                  <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 md:hidden">
                    <ChevronLeft size={14} /> Back
                  </button>
                  <h2 className="text-base font-semibold mb-1">{selected.Subject || '(no subject)'}</h2>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div><span className="font-medium">From:</span> {fmtAddr(selected.From)}</div>
                    <div><span className="font-medium">To:</span> {selected.To.map(fmtAddr).join(', ')}</div>
                    <div><span className="font-medium">Date:</span> {new Date(selected.Date).toLocaleString()}</div>
                  </div>
                </div>

                <div className="flex-1 px-6 py-4">
                  {detailLoading ? (
                    <div className="text-sm text-muted-foreground">Loading…</div>
                  ) : selected.HTML ? (
                    <iframe
                      srcDoc={selected.HTML}
                      className="w-full border-0 rounded-lg bg-white"
                      style={{ minHeight: '400px' }}
                      sandbox="allow-same-origin"
                      title="Email content"
                    />
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap font-sans">{selected.Text || '(empty)'}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtAddr(a: MpAddress) {
  return a.Name ? `${a.Name} <${a.Address}>` : a.Address;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
