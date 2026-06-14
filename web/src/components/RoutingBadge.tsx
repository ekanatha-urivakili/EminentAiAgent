import { cn } from '../lib/utils';
import { intentMeta } from '../lib/intentMeta';
import type { RoutingDecision } from '../lib/types';

interface RoutingBadgeProps {
  routing: RoutingDecision;
  className?: string;
}

/**
 * Displays intent label + model name + provider (when non-ollama).
 * Fades in 200ms after mount. Appears below the user message, above the assistant reply.
 */
export function RoutingBadge({ routing, className }: RoutingBadgeProps) {
  const meta = intentMeta[routing.intent];
  if (!meta) return null;

  const showProvider = routing.provider !== 'ollama';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        'animate-in fade-in duration-200',
        meta.badgeColor,
        className,
      )}
      title={`Route: ${routing.reason} · ${routing.classificationMs}ms${routing.wasFastPath ? ' (fast-path)' : ''}`}
    >
      <span>{meta.icon}</span>
      <span>{meta.label}</span>
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
