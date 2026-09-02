import { useState, useCallback } from 'react';
import {
  Settings, Palette, BarChart2, Bot, ArrowRight, Layers,
  Puzzle, BookOpen, Globe, Zap, Eye, EyeOff, Check, RefreshCw,
  ChevronLeft,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import type { Theme } from '../lib/types';

// ── localStorage helpers ──────────────────────────────────────────────────────

function lsGet(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}
function lsSet(key: string, value: string) {
  localStorage.setItem(key, value);
}
function lsGetBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === 'true';
}
function lsSetBool(key: string, value: boolean) {
  localStorage.setItem(key, String(value));
}

// ── Settings state ────────────────────────────────────────────────────────────

interface SettingsState {
  ollamaUrl: string;
  streamResponses: boolean;
  contextLines: number;
  maxHistoryMessages: number;
  defaultMode: string;
  openAiKey: string;
  anthropicKey: string;
  googleKey: string;
  azureEnabled: boolean;
  azureEndpoint: string;
  azureDeployment: string;
  azureKey: string;
  awsEnabled: boolean;
  awsRegion: string;
  awsModel: string;
  cmdEnterSubmit: boolean;
  agentAutocomplete: boolean;
  showTips: boolean;
  autoApproveModeTransitions: boolean;
  webSearchTool: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
  betaFeatures: boolean;
  customRules: string;
}

function loadSettings(): SettingsState {
  return {
    ollamaUrl:                  lsGet('eminentai.cfg.ollamaUrl', 'http://localhost:11434'),
    streamResponses:            lsGetBool('eminentai.cfg.streamResponses', true),
    contextLines:               Number(lsGet('eminentai.cfg.contextLines', '50')),
    maxHistoryMessages:         Number(lsGet('eminentai.cfg.maxHistoryMessages', '20')),
    defaultMode:                lsGet('eminentai.cfg.defaultMode', 'Chat'),
    openAiKey:                  lsGet('eminentai.key.openai', ''),
    anthropicKey:               lsGet('eminentai.key.anthropic', ''),
    googleKey:                  lsGet('eminentai.key.google', ''),
    azureEnabled:               lsGetBool('eminentai.cfg.azureEnabled', false),
    azureEndpoint:              lsGet('eminentai.cfg.azureEndpoint', ''),
    azureDeployment:            lsGet('eminentai.cfg.azureDeployment', ''),
    azureKey:                   lsGet('eminentai.key.azure', ''),
    awsEnabled:                 lsGetBool('eminentai.cfg.awsEnabled', false),
    awsRegion:                  lsGet('eminentai.cfg.awsRegion', 'us-east-1'),
    awsModel:                   lsGet('eminentai.cfg.awsModel', 'us.anthropic.claude-sonnet-4-6'),
    cmdEnterSubmit:             lsGetBool('eminentai.cfg.cmdEnterSubmit', false),
    agentAutocomplete:          lsGetBool('eminentai.cfg.agentAutocomplete', true),
    showTips:                   lsGetBool('eminentai.cfg.showTips', true),
    autoApproveModeTransitions: lsGetBool('eminentai.cfg.autoApproveModeTransitions', false),
    webSearchTool:              lsGetBool('eminentai.cfg.webSearchTool', true),
    proxyEnabled:               lsGetBool('eminentai.cfg.proxyEnabled', false),
    proxyUrl:                   lsGet('eminentai.cfg.proxyUrl', ''),
    betaFeatures:               lsGetBool('eminentai.cfg.betaFeatures', false),
    customRules:                lsGet('eminentai.cfg.customRules', ''),
  };
}

// ── Nav ───────────────────────────────────────────────────────────────────────

type NavPage = 'general' | 'appearance' | 'usage' | 'agents' | 'tab' | 'models' | 'plugins' | 'rules' | 'network' | 'beta';

const NAV: { id: NavPage; label: string; subtitle: string; Icon: typeof Settings }[] = [
  { id: 'general',    label: 'General',       subtitle: 'Connection & behaviour',   Icon: Settings   },
  { id: 'appearance', label: 'Appearance',    subtitle: 'Theme & display',          Icon: Palette    },
  { id: 'usage',      label: 'Plan & Usage',  subtitle: 'Status & API keys',        Icon: BarChart2  },
  { id: 'agents',     label: 'Agents',        subtitle: 'Agent runtime settings',   Icon: Bot        },
  { id: 'tab',        label: 'Tab',           subtitle: 'Keyboard shortcuts',       Icon: ArrowRight },
  { id: 'models',     label: 'Models',        subtitle: 'Ollama & cloud models',    Icon: Layers     },
  { id: 'plugins',    label: 'Plugins',       subtitle: 'Extensions & integrations',Icon: Puzzle     },
  { id: 'rules',      label: 'Rules & Skills',subtitle: 'Custom instructions',      Icon: BookOpen   },
  { id: 'network',    label: 'Network',       subtitle: 'Proxy & timeouts',         Icon: Globe      },
  { id: 'beta',       label: 'Beta',          subtitle: 'Experimental features',    Icon: Zap        },
];

const PAGE_SUBTITLES: Record<NavPage, string> = {
  general:    'Configure your local Ollama connection and default behaviour.',
  appearance: 'Customize the look and feel of EminentAI.',
  usage:      'View system status and configure cloud API providers.',
  agents:     'Control how agents run, respond, and use tools.',
  tab:        'Keyboard shortcuts and input behaviour.',
  models:     'Manage available models and configure cloud providers.',
  plugins:    'Extend EminentAI with additional capabilities.',
  rules:      'Set persistent instructions applied to every prompt.',
  network:    'Configure proxy settings and request timeouts.',
  beta:       'Opt in to experimental features under active development.',
};

// ── Shared components ─────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden mb-5">
      <div className="px-5 py-3 border-b border-border bg-muted/30">
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="text-base font-medium text-foreground">{label}</div>
        {desc && <div className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200',
        checked ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  );
}

function TextInput({ value, onChange, placeholder, className, type = 'text' }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; className?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
        className,
      )}
    />
  );
}

function NumberInput({ value, onChange, min, max, className }: {
  value: number; onChange: (v: number) => void; min: number; max: number; className?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value) || min)}
      className={cn('w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring', className)}
    />
  );
}

function SelectInput({ value, onChange, options, className }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer', className)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function SavedBadge({ show }: { show: boolean }) {
  return (
    <span className={cn(
      'text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded transition-opacity duration-200',
      show ? 'opacity-100' : 'opacity-0 pointer-events-none',
    )}>
      Saved
    </span>
  );
}

// ── API Key row ───────────────────────────────────────────────────────────────

function ApiKeyRow({ label, desc, storageKey, placeholder, onSaved }: {
  label: string; desc: string; storageKey: string; placeholder: string; onSaved?: () => void;
}) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const isSet = Boolean(lsGet(storageKey, ''));

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    lsSet(storageKey, trimmed);
    setValue('');
    setSaved(true);
    onSaved?.();
    setTimeout(() => setSaved(false), 2000);
  };

  const clear = () => {
    lsSet(storageKey, '');
    setValue('');
    onSaved?.();
  };

  return (
    <SettingRow label={label} desc={desc}>
      <div className="flex flex-col items-end gap-2">
        <span className={cn(
          'text-sm px-2.5 py-0.5 rounded-full font-medium',
          isSet ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-muted-foreground',
        )}>
          {isSet ? '● Key set' : 'Not set'}
        </span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              maxLength={512}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              className="rounded-lg border border-input bg-background pl-3 pr-9 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-52"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={save}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Save
          </button>
          <button
            onClick={clear}
            className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
        <SavedBadge show={saved} />
      </div>
    </SettingRow>
  );
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function PageGeneral({ s, save }: { s: SettingsState; save: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void }) {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const flash = (key: string) => { setSavedKey(key); setTimeout(() => setSavedKey(null), 2000); };

  return (
    <>
      <SectionCard title="Connection">
        <SettingRow label="Ollama URL" desc="Base URL of the local Ollama server">
          <div className="flex items-center gap-2">
            <TextInput value={s.ollamaUrl} onChange={(v) => { save('ollamaUrl', v); flash('ollamaUrl'); }} placeholder="http://localhost:11434" className="w-72" />
            <SavedBadge show={savedKey === 'ollamaUrl'} />
          </div>
        </SettingRow>
      </SectionCard>

      <SectionCard title="Behaviour">
        <SettingRow label="Stream Responses" desc="Show responses token-by-token as they arrive">
          <Toggle checked={s.streamResponses} onChange={(v) => save('streamResponses', v)} />
        </SettingRow>
        <SettingRow label="Context Lines" desc="Lines of active file context to include automatically (10–500)">
          <div className="flex items-center gap-2">
            <NumberInput value={s.contextLines} min={10} max={500} onChange={(v) => { save('contextLines', v); flash('contextLines'); }} />
            <SavedBadge show={savedKey === 'contextLines'} />
          </div>
        </SettingRow>
        <SettingRow label="Max History Messages" desc="Maximum messages sent per request (2–100)">
          <div className="flex items-center gap-2">
            <NumberInput value={s.maxHistoryMessages} min={2} max={100} onChange={(v) => { save('maxHistoryMessages', v); flash('maxHistoryMessages'); }} />
            <SavedBadge show={savedKey === 'maxHistoryMessages'} />
          </div>
        </SettingRow>
      </SectionCard>

      <SectionCard title="Defaults">
        <SettingRow label="Default Mode" desc="Default interaction mode for new sessions">
          <SelectInput
            value={s.defaultMode}
            onChange={(v) => save('defaultMode', v)}
            options={[{ value: 'Chat', label: 'Chat' }, { value: 'Plan', label: 'Plan' }, { value: 'Agent', label: 'Agent' }]}
          />
        </SettingRow>
      </SectionCard>
    </>
  );
}

function PageAppearance({ save }: { save: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const themes: { value: Theme; label: string; preview: string }[] = [
    { value: 'light',  label: 'Light',  preview: 'bg-white' },
    { value: 'dark',   label: 'Dark',   preview: 'bg-zinc-900' },
    { value: 'navy',   label: 'Navy',   preview: 'bg-slate-800' },
    { value: 'system', label: 'System', preview: 'bg-gradient-to-r from-white to-zinc-900' },
  ];

  return (
    <>
      <SectionCard title="Theme">
        <div className="px-5 py-4">
          <div className="grid grid-cols-4 gap-3">
            {themes.map(({ value, label, preview }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-2 py-4 px-3 rounded-xl border text-sm font-medium transition-all',
                  theme === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/40 hover:bg-muted text-muted-foreground',
                )}
              >
                <div className={cn('w-10 h-6 rounded border border-border/60', preview)} />
                {label}
                {theme === value && <Check size={13} className="text-primary" />}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Chat">
        <SettingRow label="Show Tips" desc="Show tips on the empty chat screen">
          <Toggle
            checked={lsGetBool('eminentai.cfg.showTips', true)}
            onChange={(v) => { lsSetBool('eminentai.cfg.showTips', v); save('showTips', v); }}
          />
        </SettingRow>
      </SectionCard>
    </>
  );
}

function PageUsage() {
  const backendOk = useStore((s) => s.backendOk);
  const ollamaOk  = useStore((s) => s.ollamaOk);
  const convCount = useStore((s) => s.conversations.length);
  const msgCount  = useStore((s) => s.messages.length);

  const providers = [
    { label: 'OpenAI',       set: Boolean(lsGet('eminentai.key.openai', '')) },
    { label: 'Anthropic',    set: Boolean(lsGet('eminentai.key.anthropic', '')) },
    { label: 'Google',       set: Boolean(lsGet('eminentai.key.google', '')) },
    { label: 'Azure OpenAI', set: Boolean(lsGet('eminentai.key.azure', '')) },
    { label: 'AWS Bedrock',  set: Boolean(lsGet('eminentai.key.awsAccess', '')) },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-base font-semibold mb-3">System Status</div>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-sm">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', backendOk ? 'bg-emerald-500' : 'bg-red-500')} />
              <span className="text-muted-foreground">Backend</span>
              <span className={cn('ml-auto font-medium', backendOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>{backendOk ? 'Online' : 'Offline'}</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', ollamaOk ? 'bg-emerald-500' : 'bg-amber-500')} />
              <span className="text-muted-foreground">Ollama</span>
              <span className={cn('ml-auto font-medium', ollamaOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500')}>{ollamaOk ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-base font-semibold mb-3">Session Stats</div>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Conversations</span>
              <span className="font-mono font-medium">{convCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Active messages</span>
              <span className="font-mono font-medium">{msgCount}</span>
            </div>
          </div>
        </div>
      </div>

      <SectionCard title="Cloud API Status">
        {providers.map(({ label, set }) => (
          <SettingRow key={label} label={label}>
            <span className={cn(
              'text-sm px-2.5 py-0.5 rounded-full font-medium',
              set ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
            )}>
              {set ? '● Configured' : 'Not configured'}
            </span>
          </SettingRow>
        ))}
      </SectionCard>
    </>
  );
}

function PageAgents({ s, save }: { s: SettingsState; save: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void }) {
  const agentStepBudget    = useStore((st) => st.agentStepBudget);
  const setAgentStepBudget = useStore((st) => st.setAgentStepBudget);

  return (
    <>
      <SectionCard title="Behaviour">
        <SettingRow label="Submit with ⌘ + Enter" desc="When enabled, ⌘/Ctrl+Enter submits; Enter inserts newline">
          <Toggle checked={s.cmdEnterSubmit} onChange={(v) => save('cmdEnterSubmit', v)} />
        </SettingRow>
        <SettingRow label="Queue Messages" desc="Behavior when sending while agent is running">
          <SelectInput
            value={lsGet('eminentai.cfg.queueMessages', 'after')}
            onChange={(v) => lsSet('eminentai.cfg.queueMessages', v)}
            options={[
              { value: 'after', label: 'Send after current' },
              { value: 'queue', label: 'Queue messages' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Agent Autocomplete" desc="Contextual suggestions while prompting">
          <Toggle checked={s.agentAutocomplete} onChange={(v) => save('agentAutocomplete', v)} />
        </SettingRow>
        <SettingRow label="Auto-Approve Mode Transitions" desc="Allow agent to switch modes without asking first">
          <Toggle checked={s.autoApproveModeTransitions} onChange={(v) => save('autoApproveModeTransitions', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Subagents">
        <SettingRow label="Step Budget" desc="Maximum steps per agent run (1–50)">
          <NumberInput value={agentStepBudget} min={1} max={50} onChange={setAgentStepBudget} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Context">
        <SettingRow label="Web Search Tool" desc="Allow agent to search the web for relevant information">
          <Toggle checked={s.webSearchTool} onChange={(v) => save('webSearchTool', v)} />
        </SettingRow>
      </SectionCard>
    </>
  );
}

function PageTab({ s, save }: { s: SettingsState; save: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void }) {
  return (
    <>
      <SectionCard title="Input">
        <SettingRow label="Submit with ⌘ + Enter" desc="When enabled, ⌘/Ctrl+Enter submits; Enter inserts newline. When disabled, Enter submits.">
          <Toggle checked={s.cmdEnterSubmit} onChange={(v) => save('cmdEnterSubmit', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Keyboard Shortcuts Reference">
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {[
              ['New chat',      'Ctrl+Shift+N'],
              ['Send message',  'Enter'],
              ['Cancel stream', 'Escape'],
              ['Open settings', 'Gear icon'],
            ].map(([label, key]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <kbd className="px-2 py-0.5 rounded bg-muted border border-border text-xs font-mono text-foreground">{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </>
  );
}

function PageModels({ onRefresh }: { onRefresh: () => void }) {
  const models           = useStore((s) => s.models);
  const selectedModel    = useStore((s) => s.selectedModel);
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  const loadModels       = useStore((s) => s.loadModels);
  const [refreshing, setRefreshing]       = useState(false);
  const [apiKeyRefresh, setApiKeyRefresh] = useState(0);
  const [azureOpen, setAzureOpen]         = useState(lsGetBool('eminentai.cfg.azureEnabled', false));
  const [awsOpen, setAwsOpen]             = useState(lsGetBool('eminentai.cfg.awsEnabled', false));
  const [awsRegion, setAwsRegion]         = useState(lsGet('eminentai.cfg.awsRegion', 'us-east-1'));
  const [awsModel, setAwsModel]           = useState(lsGet('eminentai.cfg.awsModel', 'us.anthropic.claude-sonnet-4-6'));
  const [azEp, setAzEp]                   = useState(lsGet('eminentai.cfg.azureEndpoint', ''));
  const [azDep, setAzDep]                 = useState(lsGet('eminentai.cfg.azureDeployment', ''));

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadModels();
    setRefreshing(false);
  };

  const bump = () => { setApiKeyRefresh(n => n + 1); onRefresh(); };

  return (
    <>
      <SectionCard title="Ollama Models">
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              placeholder="Search models…"
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => void handleRefresh()}
              className="p-2 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Refresh models"
            >
              <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
            </button>
          </div>
          {models.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No models available. Make sure Ollama is running.</div>
          ) : (
            <div className="space-y-1.5">
              {models.map((m) => {
                const selectable = m.tier !== 'embedding' && m.tier !== 'image_gen';
                return (
                  <button
                    key={m.name}
                    onClick={() => setSelectedModel(m.name)}
                    disabled={!selectable}
                    title={selectable ? undefined : `${m.name} is routed automatically by capability`}
                    className={cn(
                      'w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm transition-colors border',
                      selectedModel === m.name ? 'bg-primary/10 border-primary/30 text-foreground' : 'hover:bg-muted border-transparent text-foreground',
                      !selectable && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-border/60 bg-muted text-muted-foreground uppercase tracking-wide">
                        {m.tier ?? 'chat'}
                      </span>
                      <span className="font-medium">{m.name}</span>
                    </div>
                    {selectedModel === m.name && <Check size={15} className="text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Cloud API Keys">
        <ApiKeyRow key={`oai-${apiKeyRefresh}`} label="OpenAI" desc="GPT-4o, o1, o3, o4 models" storageKey="eminentai.key.openai" placeholder="sk-…" onSaved={bump} />
        <ApiKeyRow key={`ant-${apiKeyRefresh}`} label="Anthropic" desc="Claude Opus, Sonnet, Haiku models" storageKey="eminentai.key.anthropic" placeholder="sk-ant-…" onSaved={bump} />
        <ApiKeyRow key={`goo-${apiKeyRefresh}`} label="Google" desc="Gemini models via Google AI Studio" storageKey="eminentai.key.google" placeholder="AIza…" onSaved={bump} />
      </SectionCard>

      <SectionCard title="Azure OpenAI">
        <SettingRow label="Enable Azure OpenAI" desc="Use OpenAI models through your Azure account">
          <Toggle checked={azureOpen} onChange={(v) => { setAzureOpen(v); lsSetBool('eminentai.cfg.azureEnabled', v); }} />
        </SettingRow>
        {azureOpen && (
          <>
            <SettingRow label="Base URL">
              <TextInput value={azEp} onChange={(v) => { setAzEp(v); lsSet('eminentai.cfg.azureEndpoint', v); }} placeholder="https://my-resource.openai.azure.com" className="w-72" />
            </SettingRow>
            <SettingRow label="Deployment Name">
              <TextInput value={azDep} onChange={(v) => { setAzDep(v); lsSet('eminentai.cfg.azureDeployment', v); }} placeholder="gpt-4o" className="w-48" />
            </SettingRow>
            <ApiKeyRow key={`az-${apiKeyRefresh}`} label="API Key" desc="" storageKey="eminentai.key.azure" placeholder="Azure OpenAI API Key" onSaved={() => setApiKeyRefresh(n => n + 1)} />
          </>
        )}
      </SectionCard>

      <SectionCard title="AWS Bedrock">
        <SettingRow label="Enable AWS Bedrock" desc="Use Anthropic Claude models through your AWS account">
          <Toggle checked={awsOpen} onChange={(v) => { setAwsOpen(v); lsSetBool('eminentai.cfg.awsEnabled', v); }} />
        </SettingRow>
        {awsOpen && (
          <>
            <ApiKeyRow key={`awsA-${apiKeyRefresh}`} label="Access Key ID" desc="" storageKey="eminentai.key.awsAccess" placeholder="AWS Access Key ID" onSaved={() => setApiKeyRefresh(n => n + 1)} />
            <ApiKeyRow key={`awsS-${apiKeyRefresh}`} label="Secret Access Key" desc="" storageKey="eminentai.key.awsSecret" placeholder="AWS Secret Access Key" onSaved={() => setApiKeyRefresh(n => n + 1)} />
            <SettingRow label="Region">
              <TextInput value={awsRegion} onChange={(v) => { setAwsRegion(v); lsSet('eminentai.cfg.awsRegion', v); }} placeholder="us-east-1" className="w-40" />
            </SettingRow>
            <SettingRow label="Model ID">
              <TextInput value={awsModel} onChange={(v) => { setAwsModel(v); lsSet('eminentai.cfg.awsModel', v); }} placeholder="us.anthropic.claude-sonnet-4-6" className="w-72" />
            </SettingRow>
          </>
        )}
      </SectionCard>
    </>
  );
}

function PagePlugins() {
  const suggested = [
    { name: 'Indexing',    desc: 'Index your codebase for smarter context retrieval' },
    { name: 'Web Search',  desc: 'Enable real-time web search in agent mode' },
    { name: 'Analytics',   desc: 'Track token usage and session statistics' },
    { name: 'MCP Servers', desc: 'Connect to Model Context Protocol servers' },
  ];

  return (
    <>
      <SectionCard title="Installed">
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">No plugins installed yet.</div>
      </SectionCard>

      <SectionCard title="Suggested">
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          {suggested.map(({ name, desc }) => (
            <button key={name} className="text-left p-4 rounded-xl border border-border hover:border-primary/50 bg-background hover:bg-muted/50 transition-all group">
              <div className="text-base font-semibold mb-1">{name}</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{desc}</div>
            </button>
          ))}
        </div>
        <div className="px-5 pb-4 text-sm text-muted-foreground text-center">Plugin marketplace coming soon.</div>
      </SectionCard>
    </>
  );
}

function PageRules({ s, save }: { s: SettingsState; save: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void }) {
  const [saved, setSaved] = useState(false);

  return (
    <>
      <SectionCard title="Custom Rules">
        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
            Rules are added to every prompt as system-level instructions. Use them to set coding style, project context, or constraints the agent should always follow.
          </p>
          <textarea
            value={s.customRules}
            onChange={(e) => save('customRules', e.target.value)}
            onBlur={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
            placeholder="e.g. Always use TypeScript strict mode. Prefer functional React components."
            rows={8}
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y leading-relaxed"
          />
          <div className="mt-2 flex justify-end">
            <SavedBadge show={saved} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Skills">
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">Reusable prompt templates. Coming soon.</div>
      </SectionCard>
    </>
  );
}

function PageNetwork({ s, save }: { s: SettingsState; save: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void }) {
  return (
    <>
      <SectionCard title="Proxy">
        <SettingRow label="Use Proxy" desc="Route API requests through a proxy server">
          <Toggle checked={s.proxyEnabled} onChange={(v) => save('proxyEnabled', v)} />
        </SettingRow>
        {s.proxyEnabled && (
          <SettingRow label="Proxy URL" desc="e.g. http://proxy.example.com:8080">
            <TextInput value={s.proxyUrl} onChange={(v) => save('proxyUrl', v)} placeholder="http://proxy.example.com:8080" className="w-80" />
          </SettingRow>
        )}
      </SectionCard>

      <SectionCard title="Timeouts">
        <SettingRow label="Request Timeout" desc="Maximum time to wait for a model response">
          <span className="text-sm text-muted-foreground">120s (fixed)</span>
        </SettingRow>
      </SectionCard>
    </>
  );
}

function PageBeta({ s, save }: { s: SettingsState; save: <K extends keyof SettingsState>(k: K, v: SettingsState[K]) => void }) {
  return (
    <>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm text-amber-600 dark:text-amber-400 mb-5 leading-relaxed flex items-start gap-3">
        <Zap size={16} className="mt-0.5 flex-shrink-0" />
        Beta features are experimental and may change or be removed without notice. Use at your own risk.
      </div>

      <SectionCard title="Experimental Features">
        <SettingRow label="Enable Beta Features" desc="Opt in to experimental features as they are being developed">
          <Toggle checked={s.betaFeatures} onChange={(v) => save('betaFeatures', v)} />
        </SettingRow>
        <SettingRow label="Multi-file Context" desc="Automatically include related files in context">
          <span className="text-sm text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">Coming soon</span>
        </SettingRow>
        <SettingRow label="Agent Memory" desc="Persistent memory across sessions">
          <span className="text-sm text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">Coming soon</span>
        </SettingRow>
      </SectionCard>
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SettingsView() {
  const setAppView = useStore((s) => s.setAppView);
  const [page, setPage] = useState<NavPage>('general');
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [, forceRefresh] = useState(0);

  const save = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      const lsKey = `eminentai.cfg.${key}`;
      if (typeof value === 'boolean') lsSetBool(lsKey, value as boolean);
      else lsSet(lsKey, String(value));
      return next;
    });
  }, []);

  const PAGE_TITLES: Record<NavPage, string> = {
    general:    'General',
    appearance: 'Appearance',
    usage:      'Plan & Usage',
    agents:     'Agents',
    tab:        'Tab',
    models:     'Models',
    plugins:    'Plugins',
    rules:      'Rules & Skills',
    network:    'Network',
    beta:       'Beta',
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Left nav */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-background">
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <button
            onClick={() => setAppView('chat')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ChevronLeft size={16} /> Back
          </button>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Settings size={20} /> Settings
          </h2>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto custom-scrollbar">
          {NAV.map(({ id, label, subtitle, Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={cn(
                'flex items-center gap-3 w-full px-5 py-3 text-left transition-colors',
                page === id
                  ? 'bg-primary/10 text-primary border-r-2 border-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon size={18} className="flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-base font-medium leading-tight">{label}</div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</div>
              </div>
            </button>
          ))}
        </nav>

        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
          EminentAI v0.2.0
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Page header — matches JobSearchView header style */}
        <div className="border-b border-border px-6 pt-5 pb-5">
          <h1 className="text-2xl font-semibold">{PAGE_TITLES[page]}</h1>
          <p className="text-base text-muted-foreground mt-0.5">{PAGE_SUBTITLES[page]}</p>
        </div>

        <div className="px-6 py-6 w-full">
          {page === 'general'    && <PageGeneral s={settings} save={save} />}
          {page === 'appearance' && <PageAppearance save={save} />}
          {page === 'usage'      && <PageUsage />}
          {page === 'agents'     && <PageAgents s={settings} save={save} />}
          {page === 'tab'        && <PageTab s={settings} save={save} />}
          {page === 'models'     && <PageModels onRefresh={() => forceRefresh((n) => n + 1)} />}
          {page === 'plugins'    && <PagePlugins />}
          {page === 'rules'      && <PageRules s={settings} save={save} />}
          {page === 'network'    && <PageNetwork s={settings} save={save} />}
          {page === 'beta'       && <PageBeta s={settings} save={save} />}
        </div>
      </div>
    </div>
  );
}
