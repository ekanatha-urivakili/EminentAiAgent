import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Plug, Loader2, AlertTriangle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import type { ConnectorTransport, PolicyProfile } from '../lib/types';

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

const POLICY_COLOR: Record<PolicyProfile, string> = {
  readOnly: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  readWrite: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  blocked: 'text-red-500 bg-red-500/10 border-red-500/20',
};

interface AddForm {
  name: string;
  transport: ConnectorTransport;
  commandOrUrl: string;
  policyProfile: PolicyProfile;
}

const emptyForm = (): AddForm => ({
  name: '',
  transport: 'stdio',
  commandOrUrl: '',
  policyProfile: 'readOnly',
});

interface Props {
  onClose: () => void;
}

export function ConnectorsPanel({ onClose }: Props) {
  const connectors = useStore((s) => s.connectors);
  const loadConnectors = useStore((s) => s.loadConnectors);
  const addConnector = useStore((s) => s.addConnector);
  const removeConnector = useStore((s) => s.removeConnector);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();

  useEffect(() => { void loadConnectors(); }, [loadConnectors]);

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
      setShowForm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await removeConnector(id); }
    finally { setDeletingId(undefined); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.96, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 10 }}
        transition={{ duration: 0.15 }}
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[80vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Plug size={16} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm">MCP Connectors</h2>
            <p className="text-[11px] text-muted-foreground">
              External tool sources available to the agent (local processes or HTTP servers).
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-4">
          {/* Built-in note */}
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Built-in connectors</span> —{' '}
            <code className="font-mono">filesystem</code> and <code className="font-mono">shell</code> are
            always available and controlled separately via agent settings.
          </div>

          {/* Connector list */}
          {connectors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <Plug size={28} className="opacity-30" />
              <p className="text-sm">No external connectors registered yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {connectors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:border-border/80 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-semibold">{c.name}</span>
                      <span className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                        POLICY_COLOR[c.policyProfile],
                      )}>
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
                    </div>
                    {c.rules.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.rules.map((r) => (
                          <span key={r.id} className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                            {r.toolPattern} → {r.action}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => void handleDelete(c.id)}
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

          {/* Add form */}
          <AnimatePresence>
            {showForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
                  <p className="text-sm font-semibold">Add connector</p>

                  {error && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                      <AlertTriangle size={14} className="flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {/* Name */}
                    <div className="col-span-2 sm:col-span-1">
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                        placeholder="my-mcp-server"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>

                    {/* Transport */}
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

                    {/* Command / URL */}
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        {form.transport === 'stdio' ? 'Command *' : 'URL *'}
                      </label>
                      <input
                        value={form.commandOrUrl}
                        onChange={(e) => setForm({ ...form, commandOrUrl: e.target.value })}
                        placeholder={form.transport === 'stdio' ? 'npx @modelcontextprotocol/server-filesystem /workspace' : 'http://localhost:3001/sse'}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>

                    {/* Policy profile */}
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Policy profile</label>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {POLICY_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => setForm({ ...form, policyProfile: o.value })}
                            className={cn(
                              'flex-1 rounded-lg border px-3 py-2 text-left transition-colors',
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
                    <button
                      onClick={() => { setShowForm(false); setForm(emptyForm()); setError(undefined); }}
                      className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                    >
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {!showForm && (
          <div className="px-6 py-4 border-t border-border">
            <button
              onClick={() => { setShowForm(true); setError(undefined); }}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              Register connector
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
