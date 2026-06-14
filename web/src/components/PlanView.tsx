import { CheckCircle2, ArrowRight, Play, LayoutList, Loader2, AlertTriangle, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '../state/store';
import type { Plan } from '../lib/types';

function downloadPlanAsMarkdown(plan: Plan) {
  const lines = [
    `# Plan: ${plan.goal}`,
    '',
    ...plan.steps.flatMap((s) => [
      `## Step ${s.ordinal}: ${s.title}`,
      s.detail ? s.detail : '',
      '',
    ]),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'eminentai-plan.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PlanView() {
  const plan = useStore((s) => s.plan);
  const loading = useStore((s) => s.planLoading);
  const error = useStore((s) => s.planError);
  const updatePlanStep = useStore((s) => s.updatePlanStep);
  const promote = useStore((s) => s.promotePlanToAgent);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
        <Loader2 size={32} className="animate-spin" />
        <p className="text-base">Drafting a plan…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <AlertTriangle size={32} className="text-amber-500" />
        <p className="text-base text-muted-foreground text-center max-w-md">{error}</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 pb-32">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/15 flex items-center justify-center mb-6">
          <LayoutList size={32} className="text-amber-500" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2 text-center">Plan mode</h1>
        <p className="text-muted-foreground text-base text-center max-w-md leading-relaxed">
          Describe a goal below. EminentAi drafts an editable, numbered plan —
          read-only, no tools executed — which you can promote to Agent mode.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-8 pb-48 px-4 w-full">
      <div className="max-w-3xl w-full">
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight mb-2">Execution plan</h2>
          <p className="text-muted-foreground text-base">
            Goal: <span className="text-foreground font-medium">{plan.goal}</span>
          </p>
        </div>

        <div className="space-y-4">
          {plan.steps.map((step, index) => (
            <motion.div
              key={step.ordinal}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
              className="flex items-start gap-5 p-5 rounded-xl border border-border bg-card shadow-sm group hover:border-primary/40 transition-colors"
            >
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground mt-0.5">
                {step.ordinal}
              </div>
              <div className="flex-1 min-w-0">
                <input
                  value={step.title}
                  onChange={(e) => updatePlanStep(step.ordinal, e.target.value)}
                  className="w-full bg-transparent font-semibold text-base focus:outline-none focus:bg-muted/50 rounded px-1 -mx-1 py-0.5 transition-colors"
                />
                {step.detail && (
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{step.detail}</p>
                )}
              </div>
              <CheckCircle2 size={18} className="text-muted-foreground/25 mt-1 flex-shrink-0" />
            </motion.div>
          ))}
        </div>

        <div className="mt-10 flex items-center justify-between gap-4 flex-wrap">
          <button
            onClick={() => downloadPlanAsMarkdown(plan)}
            className="flex items-center gap-2 px-5 py-3 rounded-full font-semibold border border-border bg-background hover:bg-muted transition-colors text-base text-muted-foreground hover:text-foreground"
          >
            <Download size={16} />
            Download plan
          </button>
          <button
            onClick={promote}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-7 py-3 rounded-full font-semibold hover:bg-primary/90 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 text-base"
          >
            <Play size={16} className="fill-current" />
            Promote to Agent
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
