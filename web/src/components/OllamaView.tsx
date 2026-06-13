import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Play, RefreshCw, Square, Cpu, Eye, Zap, Scale, BrainCircuit, Check, Copy, ChevronDown, Terminal, Download, Package, Search, CloudDownload, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/utils';
import { useStore } from '../state/store';
import type { ModelInfo, OllamaRegistryModel } from '../lib/types';
import { cn } from '../lib/utils';

const tierIcon: Record<ModelInfo['tier'], typeof Cpu> = {
  fast: Zap, balanced: Scale, reasoning: BrainCircuit, vision: Eye, embedding: Cpu,
};
const tierLabel: Record<ModelInfo['tier'], string> = {
  fast: 'Fast', balanced: 'Balanced', reasoning: 'Reasoning', vision: 'Vision', embedding: 'Embedding',
};

function modelBase(name: string) { return name.split(':')[0]; }
function modelUrl(name: string) { return `https://ollama.com/library/${modelBase(name)}`; }

function describeModel(model: ModelInfo) {
  const base = modelBase(model.name).toLowerCase();
  if (base.startsWith('qwen2.5')) return 'Qwen2.5 is a multilingual family with strong coding, math, long-context, and structured-output capabilities.';
  if (base.startsWith('llama3')) return 'Llama 3 is a compact multilingual instruction-tuned family designed for local dialogue, retrieval, and summarization.';
  if (base.includes('llava') || model.tier === 'vision') return 'Vision-capable model for prompts that include images as well as text.';
  if (base.includes('embed') || model.tier === 'embedding') return 'Embedding model for search, retrieval, clustering, and similarity workflows.';
  if (base.includes('coder') || base.includes('code')) return 'Code-focused local model for programming help, refactoring, and technical explanations.';
  if (model.tier === 'reasoning') return 'Reasoning-oriented model for multi-step questions, analysis, and planning.';
  return 'General local Ollama model for chat, drafting, summarization, and everyday assistant tasks.';
}

// ── Recommended models ───────────────────────────────────────────────────────
const RECOMMENDED = [
  { cmd: 'ollama pull qwen2.5-coder:7b',        label: 'qwen2.5-coder:7b',        size: '~4.7 GB', role: 'Chat + agent',           desc: 'Best small coder; solid tool calling for agent mode' },
  { cmd: 'ollama pull qwen2.5-coder:1.5b-base', label: 'qwen2.5-coder:1.5b-base', size: '~1 GB',   role: 'Inline completions',     desc: 'Fast FIM model for the VS Code extension' },
  { cmd: 'ollama pull llama3.1:8b',              label: 'llama3.1:8b',              size: '~4.7 GB', role: 'General chat',           desc: 'Strong instruction following for everyday questions' },
  { cmd: 'ollama pull nomic-embed-text',         label: 'nomic-embed-text',         size: '~0.3 GB', role: 'Embeddings (RAG)',        desc: 'Needed for file-upload retrieval and search' },
  { cmd: 'ollama pull deepseek-r1:8b',           label: 'deepseek-r1:8b',           size: '~5 GB',   role: 'Reasoning / planning',   desc: 'Chain-of-thought traces; use in Plan mode' },
];

// ── Shared copy button ────────────────────────────────────────────────────────
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

// ── Installation guide ────────────────────────────────────────────────────────
function InstallGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
      >
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Download size={16} className="text-muted-foreground" />
          Installation guide — Ollama + recommended models
        </div>
        <ChevronDown size={16} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="px-5 py-5 space-y-7 border-t border-border">

          {/* Step 1 — Install */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">1</span>
              <h3 className="font-semibold text-sm">Install Ollama</h3>
            </div>
            <div className="space-y-3 ml-8">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">macOS — Homebrew (recommended)</p>
                <CodeLine cmd="brew install ollama" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">macOS — or download the app directly</p>
                <a
                  href="https://ollama.com/download/mac"
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink size={12} /> ollama.com/download/mac
                </a>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Linux — one-liner</p>
                <CodeLine cmd="curl -fsSL https://ollama.com/install.sh | sh" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Windows — download installer</p>
                <a
                  href="https://ollama.com/download/windows"
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink size={12} /> ollama.com/download/windows
                </a>
              </div>
            </div>
          </section>

          {/* Step 2 — Start */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">2</span>
              <h3 className="font-semibold text-sm">Start Ollama</h3>
            </div>
            <div className="space-y-3 ml-8">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">As a background service (macOS — stays running after reboot)</p>
                <CodeLine cmd="brew services start ollama" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Or run once in a terminal</p>
                <CodeLine cmd="ollama serve" />
              </div>
              <p className="text-xs text-muted-foreground">
                Ollama listens on <code className="bg-muted px-1 rounded">http://127.0.0.1:11434</code> by default.
                You can also click <span className="font-medium">Start Ollama</span> above — EminentAi will launch it for you.
              </p>
            </div>
          </section>

          {/* Step 3 — Optional env vars */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">3</span>
              <h3 className="font-semibold text-sm">Optional: tune for your hardware</h3>
            </div>
            <div className="space-y-2 ml-8">
              <p className="text-xs text-muted-foreground mb-2">
                These env vars help on machines with limited RAM (e.g., 16 GB M2).
                Set them before running <code className="bg-muted px-1 rounded">ollama serve</code>.
              </p>
              <CodeLine cmd="export OLLAMA_MAX_LOADED_MODELS=2   # 1 chat + 1 embed at a time" />
              <CodeLine cmd="export OLLAMA_KEEP_ALIVE=10m         # unload model after 10 min idle" />
              <p className="text-xs text-muted-foreground mt-2">
                To make these permanent, add them to your <code className="bg-muted px-1 rounded">~/.zshrc</code> or <code className="bg-muted px-1 rounded">~/.bashrc</code>.
              </p>
            </div>
          </section>

          {/* Step 4 — Pull models */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">4</span>
              <h3 className="font-semibold text-sm">Pull recommended models</h3>
            </div>
            <div className="ml-8 space-y-3">
              <p className="text-xs text-muted-foreground">
                Run each command in a terminal. Download sizes are approximate; disk space needed is similar.
              </p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Model</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Size</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Role</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Notes</th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {RECOMMENDED.map((m) => (
                      <tr key={m.cmd} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2.5 font-mono font-medium">{m.label}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{m.size}</td>
                        <td className="px-3 py-2.5">
                          <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">{m.role}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">{m.desc}</td>
                        <td className="px-3 py-2.5">
                          <CopyButton text={m.cmd} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Minimum to get started:</span> pull <code className="bg-muted px-1 rounded">qwen2.5-coder:7b</code> — that covers chat, plan, and agent modes.
                Pull <code className="bg-muted px-1 rounded">nomic-embed-text</code> only if you use file uploads.
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Memory budget (16 GB):</span> keep total loaded model weights ≤ 9–10 GB.
                Never run two large models simultaneously — use <code className="bg-muted px-1 rounded">OLLAMA_MAX_LOADED_MODELS=2</code> with one chat model + the tiny embed model.
              </p>
            </div>
          </section>

          {/* Step 5 — Verify */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">5</span>
              <h3 className="font-semibold text-sm">Verify it works</h3>
            </div>
            <div className="space-y-2 ml-8">
              <CodeLine cmd="ollama list                             # shows installed models" />
              <CodeLine cmd='curl http://127.0.0.1:11434/api/tags    # JSON list of models' />
              <p className="text-xs text-muted-foreground mt-1">
                Then click <span className="font-medium">Refresh</span> above — installed models will appear in the list below.
              </p>
            </div>
          </section>

        </div>
      )}
    </div>
  );
}

// ── Pull progress ─────────────────────────────────────────────────────────────
interface PullState {
  status: string;
  completed?: number;
  total?: number;
  done: boolean;
  error?: string;
}

function PullProgress({ state }: { state: PullState }) {
  const pct = state.total && state.completed ? Math.round((state.completed / state.total) * 100) : null;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{state.error ?? state.status}</span>
        {pct !== null && <span className="ml-2 flex-shrink-0">{pct}%</span>}
      </div>
      {pct !== null && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', state.done ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Model search panel ────────────────────────────────────────────────────────
function ModelSearch({ installedNames, onInstalled }: { installedNames: Set<string>; onInstalled: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OllamaRegistryModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [pulling, setPulling] = useState<Record<string, PullState>>({});
  const abortRefs = useRef<Record<string, AbortController>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!query.trim()) { setResults([]); setSearchError(undefined); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(undefined);
      try {
        const data = await api.searchModels(query.trim());
        setResults(Array.isArray(data) ? data : []);
      } catch (err) {
        setSearchError((err as Error).message);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [query]);

  const install = async (modelName: string) => {
    if (pulling[modelName] && !pulling[modelName].done) return;
    const ctrl = new AbortController();
    abortRefs.current[modelName] = ctrl;
    setPulling((p) => ({ ...p, [modelName]: { status: 'Starting…', done: false } }));
    try {
      for await (const ev of api.pullModel(modelName, ctrl.signal)) {
        if (ev.event === 'progress' || ev.event === 'done') {
          const d = ev.data as { status?: string; completed?: number; total?: number };
          setPulling((p) => ({
            ...p,
            [modelName]: {
              status: d.status ?? '',
              completed: d.completed,
              total: d.total,
              done: ev.event === 'done',
            },
          }));
          if (ev.event === 'done') onInstalled();
        } else if (ev.event === 'error') {
          const d = ev.data as { message?: string };
          setPulling((p) => ({ ...p, [modelName]: { status: 'Error', error: d.message, done: true } }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setPulling((p) => ({ ...p, [modelName]: { status: 'Error', error: (err as Error).message, done: true } }));
      }
    }
  };

  const cancel = (modelName: string) => {
    abortRefs.current[modelName]?.abort();
    setPulling((p) => { const n = { ...p }; delete n[modelName]; return n; });
  };

  const isInstalled = (name: string) => installedNames.has(name) || installedNames.has(`${name}:latest`);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Search &amp; install models</h2>
        <a
          href="https://ollama.com/search"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink size={11} /> ollama.com/search
        </a>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models (e.g. qwen3, llama3, gemma…)"
          className="w-full rounded-lg border border-border bg-background pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
        />
        {searching && (
          <RefreshCw size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {searchError && (
        <p className="text-sm text-destructive">{searchError}</p>
      )}

      {results.length > 0 && (
        <div className="grid gap-2">
          {results.map((model) => {
            const pullState = pulling[model.name];
            const installed = isInstalled(model.name);
            const isPulling = pullState && !pullState.done;
            return (
              <div key={model.name} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold">{model.name}</span>
                      {installed && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium">
                          <Check size={10} /> Installed
                        </span>
                      )}
                      {model.pulls !== undefined && (
                        <span className="text-xs text-muted-foreground">{model.pulls.toLocaleString()} pulls</span>
                      )}
                    </div>
                    {model.description && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{model.description}</p>
                    )}
                    {model.tags && model.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {model.tags.slice(0, 6).map((t) => (
                          <span key={t.name} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{t.name}</span>
                        ))}
                      </div>
                    )}
                    {pullState && <PullProgress state={pullState} />}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1.5">
                    {isPulling ? (
                      <button
                        onClick={() => cancel(model.name)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                      >
                        <X size={14} /> Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => void install(model.name)}
                        disabled={installed && !pullState?.error}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/5 px-3 py-2 text-sm text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-default"
                      >
                        <CloudDownload size={14} />
                        {installed ? (pullState?.error ? 'Retry' : 'Update') : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!searching && query.trim() && results.length === 0 && !searchError && (
        <p className="text-sm text-muted-foreground text-center py-6">No models found for "{query}".</p>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export function OllamaView() {
  const [busy, setBusy] = useState<'start' | 'stop' | 'refresh'>();
  const [message, setMessage] = useState<string>();
  const [guideOpen, setGuideOpen] = useState(false);
  const models = useStore((s) => s.models);
  const ollamaOk = useStore((s) => s.ollamaOk);
  const refreshHealth = useStore((s) => s.refreshHealth);
  const loadModels = useStore((s) => s.loadModels);
  const installedNames = new Set(models.map((m) => m.name));

  // Auto-open the guide when Ollama is offline
  const effectiveGuideOpen = guideOpen || !ollamaOk;

  const refresh = async () => {
    setBusy('refresh');
    try { await refreshHealth(); await loadModels(); setMessage('Model list refreshed.'); }
    finally { setBusy(undefined); }
  };
  const start = async () => {
    setBusy('start');
    try { const r = await api.startOllama(); setMessage(r.message); await refreshHealth(); await loadModels(); }
    catch (err) { setMessage((err as Error).message); }
    finally { setBusy(undefined); }
  };
  const stop = async () => {
    setBusy('stop');
    try { const r = await api.stopOllama(); setMessage(r.message); await refreshHealth(); }
    catch (err) { setMessage((err as Error).message); }
    finally { setBusy(undefined); }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-3 sm:px-5 py-6 sm:py-8 pb-28 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-base text-muted-foreground">
            <Cpu size={18} /> Local model runtime
          </div>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">Ollama</h1>
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            Manage the local Ollama runtime and inspect models installed on this machine.
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 text-base">
            <span className={ollamaOk ? 'h-2 w-2 rounded-full bg-emerald-500' : 'h-2 w-2 rounded-full bg-red-500'} />
            {ollamaOk ? 'Running' : 'Stopped'}
          </div>
          <button onClick={() => void start()} disabled={busy !== undefined} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-base hover:bg-muted disabled:opacity-50">
            <Play size={16} /> Start Ollama
          </button>
          <button onClick={() => void stop()} disabled={busy !== undefined} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-base hover:bg-muted disabled:opacity-50">
            <Square size={15} /> Stop Ollama
          </button>
          <button onClick={() => void refresh()} disabled={busy !== undefined} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-base hover:bg-muted disabled:opacity-50">
            <RefreshCw size={16} className={busy === 'refresh' ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-base text-muted-foreground">{message}</div>
      )}

      {/* Installation guide (auto-open when Ollama is offline) */}
      <InstallGuide open={effectiveGuideOpen} onToggle={() => setGuideOpen((v) => !v)} />

      {/* Quick-start pull commands if not installed */}
      {!ollamaOk && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
            <Terminal size={15} /> Quick start — minimum commands to get going
          </div>
          <div className="space-y-2">
            <CodeLine cmd="brew install ollama" />
            <CodeLine cmd="brew services start ollama" />
            <CodeLine cmd="ollama pull qwen2.5-coder:7b" />
          </div>
          <p className="text-xs text-muted-foreground">
            After pulling the model, click <span className="font-medium">Refresh</span> above. No Homebrew? See the full guide above.
          </p>
        </div>
      )}

      {/* Search & install */}
      <ModelSearch
        installedNames={installedNames}
        onInstalled={() => void loadModels()}
      />

      {/* Installed models */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Installed models</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{models.length} models</span>
            {models.length > 0 && (
              <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Package size={12} /> Browse more
              </a>
            )}
          </div>
        </div>

        {models.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            <Cpu size={28} className="mx-auto mb-3 opacity-30" />
            No models found. Follow the installation guide above, then click Refresh.
          </div>
        ) : (
          <div className="grid gap-3">
            {models.map((model) => {
              const Icon = tierIcon[model.tier];
              return (
                <div key={model.name} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-mono text-sm font-semibold">{model.name}</h3>
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                          <Icon size={12} /> {tierLabel[model.tier]}
                        </span>
                      </div>
                      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{describeModel(model)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <CopyButton text={`ollama pull ${model.name}`} />
                      <a href={modelUrl(model.name)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                        Ollama page <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Size</div>
                      <div className="font-medium">{formatBytes(model.sizeBytes)}</div>
                    </div>
                    <div className="rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Family</div>
                      <div className="font-medium">{model.family ?? modelBase(model.name)}</div>
                    </div>
                    <div className="rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs text-muted-foreground">Parameters</div>
                      <div className="font-medium">{model.parameterSize ?? 'Unknown'}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
