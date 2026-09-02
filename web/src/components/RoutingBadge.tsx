import { cn } from '../lib/utils';
import { intentMeta } from '../lib/intentMeta';
import type { RoutingDecision, RoutingSource } from '../lib/types';

interface RoutingBadgeProps {
  routing: RoutingDecision;
  className?: string;
}

// §18.5.4 / §18.8: the badge names *why* this route was chosen, not just what was chosen —
// "you selected" (Composer mode button) vs "model decided" (tool-call on free-text chat) vs the
// legacy zero-cost regex fast-path.
const sourceLabel: Record<RoutingSource, string> = {
  'ui-affordance': 'you selected',
  'tool-call': 'model decided',
  'fast-path': 'fast-path',
};

/**
 * Displays intent label + why it was chosen + model name + provider (when non-ollama).
 * Fades in 200ms after mount. Appears below the user message, above the assistant reply.
 */
export function RoutingBadge({ routing, className }: RoutingBadgeProps) {
  const meta = intentMeta[routing.intent];
  if (!meta) return null;

  const showProvider = routing.provider !== 'ollama';
  // A source may be absent on older/cached events; fall back to the boolean flags it replaced.
  const source: RoutingSource = routing.source ?? (routing.manualOverrideApplied ? 'ui-affordance' : routing.wasFastPath ? 'fast-path' : 'tool-call');

  const title = [
    `Route: ${routing.reason}`,
    `${routing.classificationMs}ms`,
    routing.overrideRejectedReason ? `requested mode rejected: ${routing.overrideRejectedReason}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        'animate-in fade-in duration-200',
        meta.badgeColor,
        className,
      )}
      title={title}
    >
      <span>{meta.icon}</span>
      <span>{meta.label}</span>
      <span className="opacity-50">·</span>
      <span className="opacity-70">{sourceLabel[source]}</span>
      <span className="opacity-50">·</span>
      <span className="font-mono text-[0.7rem]">{routing.model}</span>
      {showProvider && (
        <>
          <span className="opacity-50">·</span>
          <span>{routing.provider}</span>
        </>
      )}
    </div>
  );
}
