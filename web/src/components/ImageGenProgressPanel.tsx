import { useState } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Cpu,
  HardDrive,
  ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { ImageGenStage } from '../lib/types';

export interface ImageGenProgressProps {
  stage?: ImageGenStage;
  progress?: { current: number; total: number; stage: string };
  killingModels?: string[];
  restoringModels?: string[];
  currentPrompt?: string;
  completedCount?: number;
  understanding?: string;   // qwen3's one-line understanding
  analystModel?: string;    // e.g. "qwen3:latest"
}

// ── Pipeline definition ───────────────────────────────────────────────────────

type StepId = 'analyzing_request' | 'freeing_vram' | 'generating' | 'saving' | 'restoring_models';
type StepState = 'done' | 'active' | 'pending';

interface PipelineStep {
  id: StepId;
  label: string;
  detail: (p: ImageGenProgressProps) => string;
  Icon: React.ElementType;
}

const PIPELINE: PipelineStep[] = [
  {
    id:     'analyzing_request',
    label:  'Analysing request',
    Icon:   BrainCircuit,
    detail: ({ analystModel, understanding }) =>
      understanding
        ? `"${understanding}"`
        : `${analystModel ?? 'qwen3:latest'} is understanding your request and writing optimised image prompts`,
  },
  {
    id:     'freeing_vram',
    label:  'Freeing GPU memory',
    Icon:   Cpu,
    detail: ({ killingModels }) =>
      killingModels?.length
        ? `Unloading: ${killingModels.join(', ')}`
        : 'Stopping all running models to free VRAM for image generation',
  },
  {
    id:     'generating',
    label:  'Generating image',
    Icon:   ImageIcon,
    detail: ({ progress, currentPrompt }) => {
      const countStr = progress?.total && progress.total > 1
        ? ` (${progress.current} of ${progress.total})`
        : '';
      return currentPrompt
        ? `"${currentPrompt}"${countStr}`
        : `Running x/z-image-turbo${countStr} — typically 30–180 s`;
    },
  },
  {
    id:     'saving',
    label:  'Saving to disk',
    Icon:   HardDrive,
    detail: ({ progress }) =>
      `Writing image ${progress?.current ?? ''} to Generated_images/`,
  },
  {
    id:     'restoring_models',
    label:  'Restoring models',
    Icon:   RefreshCw,
    detail: ({ restoringModels }) =>
      restoringModels?.length
        ? `Warming up: ${restoringModels.join(', ')}`
        : 'Reloading your previous models into VRAM',
  },
];

// Maps SSE stage → which pipeline step is active
const STAGE_INDEX: Partial<Record<ImageGenStage, number>> = {
  analyzing_request: 0,
  analysis_done:     0,   // still on step 0, but it completed
  freeing_vram:      1,
  generating:        2,
  gen_failed:        2,
  saving:            3,
  save_failed:       3,
  restoring_models:  4,
};

// After analysis_done the first step is complete, not active
const ANALYSIS_DONE_STAGES: Set<ImageGenStage> = new Set([
  'freeing_vram', 'generating', 'gen_failed',
  'saving', 'save_failed', 'restoring_models',
]);

function getStepState(idx: number, activeIdx: number, stage?: ImageGenStage): StepState {
  if (idx < activeIdx) return 'done';
  // Step 0 is "done" once we've moved past the analysis phase
  if (idx === 0 && stage && ANALYSIS_DONE_STAGES.has(stage)) return 'done';
  if (idx === activeIdx) return 'active';
  return 'pending';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepRow({ step, state, detailText }: {
  step: PipelineStep;
  state: StepState;
  detailText: string;
}) {
  const { Icon } = step;
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center pt-0.5">
        <div className={cn(
          'h-5 w-5 flex-shrink-0 flex items-center justify-center rounded-full transition-all duration-300',
          state === 'done'    && 'text-emerald-500',
          state === 'active'  && 'text-primary',
          state === 'pending' && 'text-muted-foreground/25',
        )}>
          {state === 'done'    && <CheckCircle2 size={16} />}
          {state === 'active'  && <Loader2 size={16} className="animate-spin" />}
          {state === 'pending' && <Circle size={16} />}
        </div>
      </div>

      <div className="min-w-0 flex-1 pb-3.5">
        <div className="flex items-center gap-2">
          <Icon
            size={12}
            className={cn(
              'flex-shrink-0',
              state === 'active'  && 'text-primary',
              state === 'done'    && 'text-emerald-500',
              state === 'pending' && 'text-muted-foreground/25',
            )}
          />
          <p className={cn(
            'text-xs font-semibold leading-tight',
            state === 'active'  && 'text-foreground',
            state === 'done'    && 'text-muted-foreground/60',
            state === 'pending' && 'text-muted-foreground/30',
          )}>
            {step.label}
            {state === 'active' && (
              <span className="ml-1.5 inline-flex gap-0.5" aria-hidden>
                <span className="h-1 w-1 rounded-full bg-primary animate-bounce [animation-delay:-0.2s]" />
                <span className="h-1 w-1 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.1s]" />
                <span className="h-1 w-1 rounded-full bg-primary/40 animate-bounce" />
              </span>
            )}
          </p>
        </div>

        {(state === 'active' || state === 'done') && (
          <p className={cn(
            'mt-0.5 text-[11px] leading-relaxed break-words',
            state === 'done'   ? 'text-muted-foreground/45 italic' : 'text-muted-foreground',
          )}>
            {detailText}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ImageGenProgressPanel(props: ImageGenProgressProps) {
  const { stage, progress, completedCount = 0, understanding, analystModel } = props;
  const [expanded, setExpanded] = useState(false);

  const activeIdx = stage !== undefined ? (STAGE_INDEX[stage] ?? 0) : 0;
  const total     = progress?.total ?? 1;

  // ── Headline text ──
  const headline = (() => {
    if (!stage) return 'Starting image generation…';
    switch (stage) {
      case 'analyzing_request': return `Analysing your request with ${analystModel ?? 'qwen3:latest'}…`;
      case 'analysis_done':     return understanding ? `Understood — expanding into ${total} image${total !== 1 ? 's' : ''}` : `Planning ${total} image${total !== 1 ? 's' : ''}…`;
      case 'freeing_vram':      return 'Freeing GPU memory…';
      case 'generating': {
        const cur = progress?.current ?? 1;
        return total > 1 ? `Generating image ${cur} of ${total}…` : 'Generating image (30–180 s)…';
      }
      case 'gen_failed':        return 'Generation failed — continuing with next…';
      case 'saving':            return `Saving image ${progress?.current ?? ''} to disk…`;
      case 'save_failed':       return 'Save failed — continuing…';
      case 'restoring_models':  return 'Restoring your models…';
      default:                  return 'Working…';
    }
  })();

  // Progress bar: analysis = 10%, then spreads over generation
  const barPct = (() => {
    if (!stage) return 4;
    if (stage === 'analyzing_request') return 12;
    if (stage === 'analysis_done')     return 18;
    if (stage === 'freeing_vram')      return 22;
    if (stage === 'restoring_models')  return 95;
    // During generation: 22–90% spread over total images
    if (total > 1 && completedCount > 0)
      return Math.round(22 + (completedCount / total) * 68);
    return Math.round(22 + (activeIdx / (PIPELINE.length - 1)) * 68);
  })();

  return (
    <div className="w-full max-w-xl rounded-2xl border border-border bg-background/90 shadow-sm overflow-hidden">

      {/* ── Collapsed header ─────────────────────────────────────────── */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        aria-expanded={expanded}
        aria-label="Toggle generation pipeline details"
      >
        {/* Icon */}
        <div className="relative flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-sm">
          {stage === 'analyzing_request' || stage === 'analysis_done'
            ? <BrainCircuit size={15} className="text-white" />
            : <ImageIcon    size={15} className="text-white" />
          }
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-400 animate-pulse" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{headline}</p>

          {/* Progress bar */}
          <div className="mt-1.5 h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-700 ease-out"
              style={{ width: `${barPct}%` }}
            />
          </div>

          {/* Status line */}
          <div className="mt-1 flex items-center gap-2">
            {completedCount > 0 && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                ✓ {completedCount} of {total} image{total !== 1 ? 's' : ''} done
              </span>
            )}
            {understanding && stage !== 'analyzing_request' && (
              <span className="text-[11px] text-muted-foreground truncate italic">
                "{understanding}"
              </span>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 text-muted-foreground ml-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* ── Expanded pipeline detail ──────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-border/60 px-4 pb-4 pt-3">

          {/* Agent-to-agent badge */}
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 px-3 py-2">
            <Sparkles size={12} className="text-violet-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                Agent-to-agent pipeline
              </p>
              <p className="text-[10px] text-violet-600/70 dark:text-violet-400/70">
                <span className="font-mono">{analystModel ?? 'qwen3:latest'}</span>
                {' '}→ prompt engineer → {' '}
                <span className="font-mono">x/z-image-turbo</span>
                {' '}→ image generator
              </p>
            </div>
          </div>

          {/* Pipeline steps */}
          <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">
            Pipeline
          </p>
          {PIPELINE.map((step, idx) => (
            <StepRow
              key={step.id}
              step={step}
              state={getStepState(idx, activeIdx, stage)}
              detailText={step.detail(props)}
            />
          ))}

          {/* Killed model chips */}
          {stage === 'freeing_vram' && props.killingModels && props.killingModels.length > 0 && (
            <div className="mt-0.5 mb-3 flex flex-wrap gap-1.5">
              {props.killingModels.map(m => (
                <span key={m} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                  <Cpu size={8} /> {m}
                </span>
              ))}
            </div>
          )}

          {/* Note about duration */}
          {stage === 'generating' && (
            <p className="mt-1 flex items-start gap-1.5 text-[10px] text-muted-foreground/55 italic">
              <Zap size={10} className="flex-shrink-0 mt-0.5" />
              Runs fully on-device — 30–180 s per image depending on your hardware.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
