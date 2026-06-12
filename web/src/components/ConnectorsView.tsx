import { useEffect, useState } from 'react';
import {
  Plug, Plus, Trash2, Loader2, AlertTriangle, Copy, Check,
  ChevronDown, ToggleLeft, ToggleRight, ExternalLink,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import type { ConnectorTransport, PolicyProfile } from '../lib/types';

// ── Role filter ───────────────────────────────────────────────────────────────

type Role = 'all' | 'developer' | 'engineering_manager' | 'product_manager';

const ROLE_LABELS: Record<Role, string> = {
  all: 'All',
  developer: 'Developer',
  engineering_manager: 'Engineering Manager',
  product_manager: 'Product Manager',
};

const ROLE_BADGE: Record<string, string> = {
  developer: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  engineering_manager: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  product_manager: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
};

const ROLE_DISPLAY: Record<string, string> = {
  developer: 'Dev',
  engineering_manager: 'EM',
  product_manager: 'PM',
};

// ── Suggested MCP catalogue ───────────────────────────────────────────────────

interface SuggestedMcp {
  id: string;
  name: string;
  description: string;
  openSource: boolean;
  roles: Exclude<Role, 'all'>[];
  transport: ConnectorTransport;
  command: string;
  policyProfile: PolicyProfile;
  envRequired?: string[];
  needsConfig?: boolean;
  docsUrl?: string;
}

const SUGGESTED_MCPS: SuggestedMcp[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write local files — workspace navigation, code editing, file search.',
    openSource: true,
    roles: ['developer'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-filesystem /workspace',
    policyProfile: 'readWrite',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Git log, diff, blame, and branch management over a local repository.',
    openSource: true,
    roles: ['developer'],
    transport: 'stdio',
    command: 'uvx mcp-server-git --repository /path/to/repo',
    policyProfile: 'readOnly',
    needsConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Search repos, read PRs, manage issues, and review code changes.',
    openSource: true,
    roles: ['developer', 'engineering_manager'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-github',
    policyProfile: 'readWrite',
    envRequired: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'fetch',
    name: 'Fetch / HTTP',
    description: 'Fetch web pages, API docs, and external URLs on demand.',
    openSource: true,
    roles: ['developer', 'engineering_manager', 'product_manager'],
    transport: 'stdio',
    command: 'uvx mcp-server-fetch',
    policyProfile: 'readOnly',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Read-only SQL queries against your Postgres database.',
    openSource: true,
    roles: ['developer'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-postgres postgresql://localhost/mydb',
    policyProfile: 'readOnly',
    needsConfig: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Privacy-respecting web and code search without tracking.',
    openSource: true,
    roles: ['developer', 'engineering_manager', 'product_manager'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-brave-search',
    policyProfile: 'readOnly',
    envRequired: ['BRAVE_API_KEY'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read channels, search messages, and post to Slack workspaces.',
    openSource: true,
    roles: ['engineering_manager', 'product_manager'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-slack',
    policyProfile: 'readOnly',
    envRequired: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Query issues, projects, and cycles for sprint planning and tracking.',
    openSource: true,
    roles: ['engineering_manager', 'product_manager', 'developer'],
    transport: 'stdio',
    command: 'npx @linear/mcp-server',
    policyProfile: 'readOnly',
    envRequired: ['LINEAR_API_KEY'],
    docsUrl: 'https://github.com/linear/linear/tree/master/packages/mcp',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read pages and databases from your Notion workspace.',
    openSource: true,
    roles: ['product_manager', 'engineering_manager'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-notion',
    policyProfile: 'readOnly',
    envRequired: ['NOTION_API_KEY'],
    docsUrl: 'https://github.com/makenotion/notion-mcp-server',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Search and read files from Drive, Docs, and Sheets.',
    openSource: true,
    roles: ['product_manager', 'engineering_manager'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-gdrive',
    policyProfile: 'readOnly',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent key-value memory for the agent across sessions.',
    openSource: true,
    roles: ['developer', 'engineering_manager', 'product_manager'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-memory',
    policyProfile: 'readWrite',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Enhanced chain-of-thought reasoning for complex multi-step tasks.',
    openSource: true,
    roles: ['developer', 'engineering_manager', 'product_manager'],
    transport: 'stdio',
    command: 'npx @modelcontextprotocol/server-sequential-thinking',
    policyProfile: 'readOnly',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Read sprints, issues, and backlogs from Atlassian Jira.',
    openSource: false,
    roles: ['engineering_manager', 'product_manager', 'developer'],
    transport: 'sse',
    command: 'https://your-domain.atlassian.net/mcp/sse',
    policyProfile: 'readOnly',
    needsConfig: true,
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Inspect design files, components, and dev-mode specs.',
    openSource: false,
    roles: ['product_manager', 'developer'],
    transport: 'sse',
    command: 'https://api.figma.com/mcp',
    policyProfile: 'readOnly',
    envRequired: ['FIGMA_ACCESS_TOKEN'],
    needsConfig: true,
  },
];

// ── Policy colours ─────────────────────────────────────────────────────────────

const POLICY_COLOR: Record<PolicyProfile, string> = {
  readOnly: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  readWrite: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  blocked: 'text-red-500 bg-red-500/10 border-red-500/20',
};

const TRANSPORT_OPTIONS: { value: ConnectorTransport; label: string }[] = [
  { value: 'stdio', label: 'stdio (local process)' },
  { value: 'sse', label: 'SSE (HTTP event stream)' },
  { value: 'http', label: 'HTTP (REST)' },
];

const POLICY_OPTIONS: { value: PolicyProfile; label: string; desc: string }[] = [
  { value: 'readOnly', label: 'Read-only', desc: 'All writes require approval' },
  { value: 'readWrite', label: 'Read + write', desc: 'Writes allowed automatically' },
  { value: 'blocked', label: 'Blocked', desc: 'Connector disabled for agent runs' },
];

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      title="Copy command"
      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
    >
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

// ── Suggested connector card ───────────────────────────────────────────────────

interface SuggestedCardProps {
  mcp: SuggestedMcp;
  registeredId?: string;
  onEnable: (mcp: SuggestedMcp, command: string) => Promise<void>;
  onDisable: (id: string) => Promise<void>;
  busy: boolean;
}

function SuggestedCard({ mcp, registeredId, onEnable, onDisable, busy }: SuggestedCardProps) {
  const isEnabled = registeredId !== undefined;
  const [expanded, setExpanded] = useState(false);
  const [command, setCommand] = useState(mcp.command);

  const handleToggle = async () => {
    if (isEnabled) {
      await onDisable(registeredId);
    } else if (mcp.needsConfig) {
      setExpanded((v) => !v);
    } else {
      await onEnable(mcp, mcp.command);
    }
  };

  const handleAdd = async () => {
    await onEnable(mcp, command);
    setExpanded(false);
  };

  return (
    <div className={cn(
      'rounded-xl border bg-card transition-colors',
      isEnabled ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-border/80',
    )}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
            isEnabled ? 'bg-primary/15' : 'bg-muted',
          )}>
            <Plug size={14} className={isEnabled ? 'text-primary' : 'text-muted-foreground'} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm">{mcp.name}</span>
              {mcp.openSource && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                  open source
                </span>
              )}
              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', POLICY_COLOR[mcp.policyProfile])}>
                {mcp.policyProfile}
              </span>
              {mcp.roles.map((r) => (
                <span key={r} className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', ROLE_BADGE[r])}>
                  {ROLE_DISPLAY[r]}
                </span>
              ))}
            </div>

            <p className="text-xs text-muted-foreground mb-2">{mcp.description}</p>

            {isEnabled && (
              <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-background border border-border">
                <code className="text-[11px] font-mono text-muted-foreground flex-1 truncate">{mcp.command}</code>
                <CopyButton text={mcp.command} />
              </div>
            )}

            {mcp.envRequired && mcp.envRequired.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {mcp.envRequired.map((env) => (
                  <span key={env} className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                    {env}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {mcp.docsUrl && (
              <a
                href={mcp.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Documentation"
              >
                <ExternalLink size={13} />
              </a>
            )}
            <button
              onClick={() => void handleToggle()}
              disabled={busy}
              className={cn(
                'transition-colors disabled:opacity-40',
                isEnabled ? 'text-primary hover:text-primary/80' : 'text-muted-foreground hover:text-foreground',
              )}
              title={isEnabled ? 'Disable' : 'Enable'}
            >
              {busy
                ? <Loader2 size={22} className="animate-spin" />
                : isEnabled
                  ? <ToggleRight size={28} />
                  : <ToggleLeft size={28} />}
            </button>
          </div>
        </div>

        {/* Inline config form for connectors that need customisation */}
        {expanded && !isEnabled && (
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <p className="text-xs text-muted-foreground">Edit the command before enabling:</p>
            <div className="flex items-center gap-2">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <CopyButton text={command} />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setExpanded(false); setCommand(mcp.command); }}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAdd()}
                disabled={busy || !command.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Enable
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Custom connector form ─────────────────────────────────────────────────────

interface AddForm {
  name: string;
  transport: ConnectorTransport;
  commandOrUrl: string;
  policyProfile: PolicyProfile;
}

const emptyForm = (): AddForm => ({ name: '', transport: 'stdio', commandOrUrl: '', policyProfile: 'readOnly' });

function CustomConnectorForm({ onDone }: { onDone: () => void }) {
  const addConnector = useStore((s) => s.addConnector);
  const [form, setForm] = useState<AddForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const handleAdd = async () => {
    if (!form.name.trim() || !form.commandOrUrl.trim()) {
      setError('Name and command/URL are required.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await addConnector(form);
      setForm(emptyForm());
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
      <p className="text-sm font-semibold">Add custom connector</p>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
            placeholder="my-mcp-server"
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Transport *</label>
          <div className="relative">
            <select
              value={form.transport}
              onChange={(e) => setForm({ ...form, transport: e.target.value as ConnectorTransport })}
              className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {TRANSPORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {form.transport === 'stdio' ? 'Command *' : 'URL *'}
          </label>
          <input
            value={form.commandOrUrl}
            onChange={(e) => setForm({ ...form, commandOrUrl: e.target.value })}
            placeholder={form.transport === 'stdio' ? 'npx my-mcp-server' : 'http://localhost:3001/sse'}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Policy profile</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {POLICY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setForm({ ...form, policyProfile: o.value })}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  form.policyProfile === o.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:border-border/80',
                )}
              >
                <div className="text-xs font-semibold">{o.label}</div>
                <div className="text-[10px] opacity-70">{o.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onDone} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
          Cancel
        </button>
        <button
          onClick={() => void handleAdd()}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add connector
        </button>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ConnectorsView() {
  const connectors = useStore((s) => s.connectors);
  const loadConnectors = useStore((s) => s.loadConnectors);
  const addConnector = useStore((s) => s.addConnector);
  const removeConnector = useStore((s) => s.removeConnector);

  const [roleFilter, setRoleFilter] = useState<Role>('all');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string>();

  useEffect(() => { void loadConnectors(); }, [loadConnectors]);

  const setMcpBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      busy ? next.add(id) : next.delete(id);
      return next;
    });

  const handleEnable = async (mcp: SuggestedMcp, command: string) => {
    setMcpBusy(mcp.id, true);
    try {
      await addConnector({
        name: mcp.id,
        transport: mcp.transport,
        commandOrUrl: command,
        policyProfile: mcp.policyProfile,
      });
    } finally {
      setMcpBusy(mcp.id, false);
    }
  };

  const handleDisable = async (id: string) => {
    setDeletingId(id);
    try { await removeConnector(id); }
    finally { setDeletingId(undefined); }
  };

  const filteredSuggested = roleFilter === 'all'
    ? SUGGESTED_MCPS
    : SUGGESTED_MCPS.filter((m) => m.roles.includes(roleFilter));

  // Connectors NOT matching any suggested MCP id — user-added custom ones
  const suggestedIds = new Set(SUGGESTED_MCPS.map((m) => m.id));
  const customConnectors = connectors.filter((c) => !suggestedIds.has(c.name));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Plug size={18} className="text-primary" />
          </div>
          <h1 className="text-xl font-bold">MCP Connectors</h1>
        </div>
        <p className="text-sm text-muted-foreground ml-12">
          Connect external tools and data sources to the agent via the Model Context Protocol.
          Built-in <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">filesystem</code> and{' '}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">shell</code> are always available.
        </p>
      </div>

      {/* ── Suggested connectors ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">Suggested</h2>
            <p className="text-xs text-muted-foreground">Curated open-source MCPs for everyday engineering and product work.</p>
          </div>

          {/* Role filter tabs */}
          <div className="flex items-center gap-1 bg-muted/60 border border-border rounded-xl p-1 flex-wrap">
            {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap',
                  roleFilter === role
                    ? 'bg-background text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {filteredSuggested.map((mcp) => {
            const registered = connectors.find((c) => c.name === mcp.id);
            return (
              <SuggestedCard
                key={mcp.id}
                mcp={mcp}
                registeredId={registered?.id}
                onEnable={handleEnable}
                onDisable={handleDisable}
                busy={busyIds.has(mcp.id) || deletingId === registered?.id}
              />
            );
          })}
        </div>
      </section>

      {/* ── Custom connectors ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Custom connectors</h2>
            <p className="text-xs text-muted-foreground">Your manually registered MCP servers.</p>
          </div>
          {!showCustomForm && (
            <button
              onClick={() => setShowCustomForm(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              Add custom
            </button>
          )}
        </div>

        {showCustomForm && (
          <CustomConnectorForm onDone={() => setShowCustomForm(false)} />
        )}

        {customConnectors.length === 0 && !showCustomForm ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground border border-dashed border-border rounded-xl gap-2">
            <Plug size={22} className="opacity-30" />
            <p className="text-sm">No custom connectors yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {customConnectors.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-sm font-semibold">{c.name}</span>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', POLICY_COLOR[c.policyProfile])}>
                      {c.policyProfile}
                    </span>
                    {!c.enabled && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border text-muted-foreground bg-muted">
                        disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{c.transport}</span>
                    <span className="truncate max-w-xs">{c.commandOrUrl}</span>
                    <CopyButton text={c.commandOrUrl} />
                  </div>
                </div>
                <button
                  onClick={() => void handleDisable(c.id)}
                  disabled={deletingId === c.id}
                  className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors disabled:opacity-40"
                  title="Remove connector"
                >
                  {deletingId === c.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Trash2 size={14} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── How to link ── */}
      <section className="space-y-3">
        <h2 className="font-semibold">How to link an MCP server</h2>
        <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-3 text-sm">
          <p className="text-muted-foreground">Enable a connector above, then reference it by name in the Agent settings or pass it directly in an agent run. The agent resolves the name to the registered command at runtime.</p>
          <div className="space-y-2">
            {[
              { label: 'stdio (local process)', cmd: 'npx @modelcontextprotocol/server-filesystem /workspace' },
              { label: 'SSE (HTTP stream)', cmd: 'http://localhost:3001/sse' },
            ].map(({ label, cmd }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
                  <code className="text-xs font-mono flex-1 text-foreground">{cmd}</code>
                  <CopyButton text={cmd} />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            For connectors requiring environment variables, set them in your shell before starting the backend:{' '}
            <code className="font-mono bg-background border border-border px-1.5 py-0.5 rounded">export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...</code>
          </p>
        </div>
      </section>
    </div>
  );
}
