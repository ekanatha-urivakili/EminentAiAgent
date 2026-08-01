import { useEffect, useRef, useState } from 'react';
import {
  Bot, ShieldAlert, Check, X, Wrench, CheckCircle2, XCircle, Ban,
  Lightbulb, Flag, AlertTriangle, Loader2, SlidersHorizontal, Plug,
  ChevronRight, ChevronDown,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { AgentTimelineItem } from '../lib/types';

// ── Approval card ────────────────────────────────────────────────────────────
function ApprovalCard({ item }: { item: AgentTimelineItem }) {
  const approveStep = useStore((s) => s.approveStep);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const decide = async (decision: 'approve' | 'reject') => {
    if (!item.stepId || submitting) return;
    setSubmitting(true);
    try { await approveStep(item.stepId, decision, remember); }
    catch { setSubmitting(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-5 shadow-md"
    >
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert size={18} className="text-amber-600 dark:text-amber-400" />
        <span className="font-semibold text-base text-amber-700 dark:text-amber-400">
          Action requires your approval
        </span>
      </div>

      <div className="bg-background rounded-lg border border-border p-3 font-mono text-sm mb-3 overflow-x-auto">
        <div className="text-muted-foreground mb-1">{item.tool}</div>
        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(item.args, null, 2)}</pre>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void decide('approve')}
          disabled={submitting}
          className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg font-medium text-base transition-colors disabled:opacity-60"
        >
          <Check size={16} /> Approve
        </button>
        <button
          onClick={() => void decide('reject')}
          disabled={submitting}
          className="flex-1 flex items-center justify-center gap-2 bg-background hover:bg-muted py-2.5 rounded-lg font-medium text-base transition-colors border border-border disabled:opacity-60"
        >
          <X size={16} /> Reject
        </button>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="rounded accent-amber-500"
        />
        Remember this decision for this tool (writes a policy rule)
      </label>
    </motion.div>
  );
}

// ── Timeline item ────────────────────────────────────────────────────────────
const itemIcon: Record<AgentTimelineItem['kind'], { icon: typeof Wrench; cls: string }> = {
  thought: { icon: Lightbulb, cls: 'bg-blue-500/10 text-blue-500' },
  tool_call: { icon: Wrench, cls: 'bg-muted text-muted-foreground' },
  tool_result: { icon: CheckCircle2, cls: 'bg-emerald-500/10 text-emerald-500' },
  tool_failed: { icon: XCircle, cls: 'bg-red-500/10 text-red-500' },
  tool_denied: { icon: Ban, cls: 'bg-red-500/10 text-red-500' },
  tool_rejected: { icon: X, cls: 'bg-amber-500/10 text-amber-500' },
  answer: { icon: Flag, cls: 'bg-emerald-500/10 text-emerald-500' },
  info: { icon: Bot, cls: 'bg-muted text-muted-foreground' },
};

// Best-effort one-line preview of a tool call's arguments, e.g. { prompt: "a red fox" } → "a red fox"
function summarizeArgs(args: unknown): string {
  if (args && typeof args === 'object') {
    for (const key of ['prompt', 'path', 'command', 'query', 'url', 'source']) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  return JSON.stringify(args ?? {});
}

function truncate(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function TimelineItem({ item }: { item: AgentTimelineItem }) {
  if (item.pendingApproval) return <ApprovalCard item={item} />;
  const meta = itemIcon[item.kind];
  const Icon = meta.icon;

  const collapsible = item.kind === 'tool_call' || item.kind === 'tool_result' || item.kind === 'tool_failed';
  const [expanded, setExpanded] = useState(!collapsible);
  const summary = item.kind === 'tool_call'
    ? summarizeArgs(item.args)
    : (item.kind === 'tool_result' || item.kind === 'tool_failed')
      ? (item.text ?? '')
      : '';

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-4">
      <div className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', meta.cls)}>
        <Icon size={17} />
      </div>
      <div className="flex-1 min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div
          className={cn('flex items-center gap-2', collapsible && 'cursor-pointer select-none')}
          onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
        >
          {item.tool && (
            <span className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wide">
              {item.tool}
            </span>
          )}
          {collapsible && !expanded && (
            <span className="text-sm text-muted-foreground truncate flex-1 min-w-0">{truncate(summary)}</span>
          )}
          {collapsible && (
            expanded
              ? <ChevronDown size={14} className="text-muted-foreground flex-shrink-0 ml-auto" />
              : <ChevronRight size={14} className="text-muted-foreground flex-shrink-0 ml-auto" />
          )}
        </div>
        {item.kind === 'tool_call' && expanded && (
          <pre className="mt-1.5 text-sm font-mono bg-muted/60 p-2.5 rounded-md whitespace-pre-wrap break-all overflow-x-auto">
            {JSON.stringify(item.args, null, 2)}
          </pre>
        )}
        {item.kind === 'thought' && (
          <p className="text-base text-blue-600/90 dark:text-blue-400/90 leading-relaxed">{item.text}</p>
        )}
        {(item.kind === 'tool_result' || item.kind === 'tool_failed') && expanded && (
          <pre className={cn(
            'mt-1.5 text-sm font-mono p-2.5 rounded-md whitespace-pre-wrap break-all overflow-x-auto max-h-56 overflow-y-auto custom-scrollbar',
            item.kind === 'tool_failed' ? 'bg-red-500/5 text-red-600 dark:text-red-400' : 'bg-muted/60',
          )}>
            {item.text}
          </pre>
        )}
        {(item.kind === 'tool_denied' || item.kind === 'tool_rejected') && (
          <p className="text-base text-muted-foreground">{item.text}</p>
        )}
      </div>
    </motion.div>
  );
}

// ── Idle config panel ─────────────────────────────────────────────────────────
const BUILTIN_CONNECTORS = ['filesystem', 'shell', 'web', 'image'];

function AgentIdleConfig() {
  const agentStepBudget = useStore((s) => s.agentStepBudget);
  const setAgentStepBudget = useStore((s) => s.setAgentStepBudget);
  const agentConnectors = useStore((s) => s.agentConnectors);
  const setAgentConnectors = useStore((s) => s.setAgentConnectors);
  const agentWorkspaceRoot = useStore((s) => s.agentWorkspaceRoot);
  const setAgentWorkspaceRoot = useStore((s) => s.setAgentWorkspaceRoot);
  const connectors = useStore((s) => s.connectors);
  const loadConnectors = useStore((s) => s.loadConnectors);

  useEffect(() => { void loadConnectors(); }, [loadConnectors]);

  const allConnectors = [...BUILTIN_CONNECTORS, ...connectors.filter(c => c.enabled).map(c => c.name)];

  const toggleConnector = (name: string) => {
    setAgentConnectors(
      agentConnectors.includes(name)
        ? agentConnectors.filter((c) => c !== name)
        : [...agentConnectors, name],
    );
  };

  return (
    <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 space-y-6 shadow-sm">
      {/* Step budget */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <SlidersHorizontal size={16} className="text-muted-foreground" />
          <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Step budget
          </label>
          <span className="ml-auto font-mono text-base font-bold">{agentStepBudget}</span>
        </div>
        <input
          type="range"
          min={1}
          max={50}
          value={agentStepBudget}
          onChange={(e) => setAgentStepBudget(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>1 (quick)</span>
          <span>50 (deep)</span>
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Local workspace path
        </label>
        <input
          value={agentWorkspaceRoot}
          onChange={(event) => setAgentWorkspaceRoot(event.target.value)}
          placeholder="Leave blank for this repository, or enter /absolute/local/path"
          className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Reads stay inside this folder. Every edit, create, move, delete, ZIP, or shell command requires approval.
        </p>
      </div>

      {/* Connector selection */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Plug size={16} className="text-muted-foreground" />
          <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Active connectors
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {allConnectors.map((name) => {
            const active = agentConnectors.includes(name);
            return (
              <button
                key={name}
                onClick={() => toggleConnector(name)}
                className={cn(
                  'text-sm font-mono px-3 py-1.5 rounded-full border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/40',
                )}
              >
                {name}
              </button>
            );
          })}
          {allConnectors.length === 0 && (
            <span className="text-sm text-muted-foreground italic">No connectors available</span>
          )}
        </div>
        {agentConnectors.length === 0 && (
          <p className="text-xs text-amber-500 mt-2 flex items-center gap-1">
            <AlertTriangle size={13} /> No connectors selected — the agent won't have any tools.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main AgentView ────────────────────────────────────────────────────────────
export function AgentView() {
  const agent = useStore((s) => s.agent);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent.timeline.length, agent.streamText, agent.status]);

  if (agent.status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 pb-32 gap-8">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
          <Bot size={32} className="text-emerald-500" />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Agent mode</h1>
          <p className="text-muted-foreground text-base text-center max-w-md leading-relaxed">
            Give the agent a goal. It can inspect this repository, edit files, and create ZIP archives —
            every mutation pauses for your approval.
          </p>
        </div>
        <AgentIdleConfig />
      </div>
    );
  }

  const running = agent.status === 'running' || agent.status === 'waiting_approval';

  return (
    <div className="flex flex-col items-center pt-8 pb-48 px-4 w-full">
      <div className="max-w-3xl w-full">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2.5">
              {running ? (
                <span className="relative flex h-3.5 w-3.5 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500" />
                </span>
              ) : agent.status === 'done' ? (
                <CheckCircle2 size={22} className="text-emerald-500 flex-shrink-0" />
              ) : (
                <AlertTriangle size={22} className="text-amber-500 flex-shrink-0" />
              )}
              {agent.status === 'waiting_approval' ? 'Waiting for approval'
                : agent.status === 'running' ? 'Agent running'
                : agent.status === 'done' ? 'Run complete'
                : agent.status === 'error' ? 'Run failed' : 'Run halted'}
            </h2>
            <p className="text-muted-foreground text-base truncate">Goal: {agent.goal}</p>
          </div>

          <div className="flex gap-5 text-sm flex-shrink-0">
            <div className="flex flex-col items-end">
              <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Steps</span>
              <span className="font-mono text-sm">{agent.steps}/{agent.stepBudget}</span>
            </div>
            {agent.tokensUsed > 0 && (
              <div className="flex flex-col items-end">
                <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Tokens</span>
                <span className="font-mono text-sm">{(agent.tokensUsed / 1000).toFixed(1)}k</span>
              </div>
            )}
          </div>
        </div>

        {agent.tools.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {agent.tools.map((t) => (
              <span key={t} className="text-xs font-mono bg-muted px-2.5 py-1 rounded-full border border-border text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="space-y-5">
          {agent.timeline.map((item) => (
            <TimelineItem key={item.id} item={item} />
          ))}

          {agent.streamText && (
            <div className="flex gap-4">
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-muted text-muted-foreground mt-0.5">
                <Loader2 size={17} className="animate-spin" />
              </div>
              <div className="flex-1 rounded-xl border border-border bg-card p-4 text-base text-muted-foreground whitespace-pre-wrap">
                {agent.streamText}
              </div>
            </div>
          )}

          {agent.answer && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3 text-emerald-600 dark:text-emerald-400 text-base font-semibold">
                <Flag size={18} /> Final answer
              </div>
              <MarkdownRenderer content={agent.answer} />
            </motion.div>
          )}

          {agent.reason && agent.status !== 'done' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-base text-muted-foreground flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
              {agent.reason}
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
