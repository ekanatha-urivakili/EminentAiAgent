import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Zap, Scale, BrainCircuit, Eye, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn, formatBytes } from '../lib/utils';
import { useStore } from '../state/store';

const tierMeta: Record<string, { icon: typeof Zap; label: string; color: string }> = {
  fast: { icon: Zap, label: 'Fast', color: 'text-yellow-500' },
  balanced: { icon: Scale, label: 'Balanced', color: 'text-blue-500' },
  reasoning: { icon: BrainCircuit, label: 'Reasoning', color: 'text-purple-500' },
  vision: { icon: Eye, label: 'Vision', color: 'text-emerald-500' },
};

export function ModelSelector({ compact = false }: { compact?: boolean }) {
  const models = useStore((s) => s.models);
  const selected = useStore((s) => s.selectedModel);
  const setSelected = useStore((s) => s.setSelectedModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const chatModels = models.filter((m) => m.tier !== 'embedding');
  const tiers = ['fast', 'balanced', 'reasoning', 'vision'].filter((t) =>
    chatModels.some((m) => m.tier === t),
  );

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex max-w-[11rem] sm:max-w-none items-center gap-2 rounded-full hover:bg-muted text-sm font-medium transition-colors border border-border bg-background/60',
          compact ? 'px-2.5 py-1.5' : 'px-3 py-1.5',
        )}
      >
        <span className="truncate font-mono text-xs sm:text-sm">{selected || 'No model'}</span>
        <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 mb-2 w-[calc(100vw-2rem)] max-w-80 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl overflow-hidden py-1.5 z-50 max-h-96 overflow-y-auto custom-scrollbar"
          >
            {chatModels.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No models found. Run <code className="font-mono text-xs">ollama pull qwen2.5-coder:7b</code>
              </div>
            )}
            {tiers.map((tier) => {
              const meta = tierMeta[tier];
              const Icon = meta.icon;
              return (
                <div key={tier}>
                  <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Icon size={12} className={meta.color} />
                    {meta.label}
                  </div>
                  {chatModels.filter((m) => m.tier === tier).map((m) => (
                    <button
                      key={m.name}
                      onClick={() => { setSelected(m.name); setOpen(false); }}
                      className="flex items-center gap-3 w-full px-4 py-2 text-sm text-left hover:bg-muted transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs truncate">{m.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {m.parameterSize ?? ''} {m.sizeBytes ? `· ${formatBytes(m.sizeBytes)}` : ''}
                        </div>
                      </div>
                      {selected === m.name && <Check size={14} className="text-primary flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
