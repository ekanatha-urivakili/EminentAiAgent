import { CheckCircle2, ArrowRight, Play, LayoutList, Loader2, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '../state/store';

export function PlanView() {
  const plan = useStore((s) => s.plan);
  const loading = useStore((s) => s.planLoading);
  const error = useStore((s) => s.planError);
  const updatePlanStep = useStore((s) => s.updatePlanStep);
  const promote = useStore((s) => s.promotePlanToAgent);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-sm">Drafting a plan…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-4">
        <AlertTriangle size={28} className="text-amber-500" />
        <p className="text-sm text-muted-foreground text-center max-w-md">{error}</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 pb-32">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mb-6">
          <LayoutList size={26} className="text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Plan mode</h1>
        <p className="text-muted-foreground text-sm text-center max-w-md">
          Describe a goal below. EminentAi drafts an editable, numbered plan —
          read-only, no tools executed — which you can promote to Agent mode.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-8 pb-48 px-4 w-full">
      <div className="max-w-3xl w-full">
        <div className="mb-7">
          <h2 className="text-2xl font-bold tracking-tight mb-1.5">Execution plan</h2>
          <p className="text-muted-foreground text-sm">
            Goal: <span className="text-foreground">{plan.goal}</span>
          </p>
        </div>

        <div className="space-y-3">
          {plan.steps.map((step, index) => (
            <motion.div
              key={step.ordinal}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
              className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card shadow-sm group hover:border-primary/40 transition-colors"
            >
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground mt-0.5">
                {step.ordinal}
              </div>
              <div className="flex-1 min-w-0">
                <input
                  value={step.title}
                  onChange={(e) => updatePlanStep(step.ordinal, e.target.value)}
                  className="w-full bg-transparent font-medium text-sm focus:outline-none focus:bg-muted/50 rounded px-1 -mx-1 py-0.5 transition-colors"
                />
                {step.detail && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.detail}</p>
                )}
              </div>
              <CheckCircle2 size={16} className="text-muted-foreground/25 mt-1 flex-shrink-0" />
            </motion.div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={promote}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-full font-medium hover:bg-primary/90 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 text-sm"
          >
            <Play size={15} className="fill-current" />
            Promote to Agent
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
