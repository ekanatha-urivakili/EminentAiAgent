import { useState } from 'react';
import { Download, Copy, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ImageGenStage } from '../lib/types';

interface GeneratedImageProps {
  url?: string;
  fluxPrompt?: string;
  stage?: ImageGenStage;
  className?: string;
}

/**
 * Renders either a progress spinner (while generating) or the final PNG
 * with Download, Copy URL, and expandable Flux prompt.
 */
export function GeneratedImage({ url, fluxPrompt, stage, className }: GeneratedImageProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!url) return;
    if (!url.startsWith('/api/generated-images/')) return;
    await navigator.clipboard.writeText(`${window.location.origin}${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const stageLabel: Record<ImageGenStage, string> = {
    translating: 'Translating prompt…',
    generating: 'Generating image (this may take 30–120s)…',
    saving: 'Saving image…',
  };

  // Show spinner while generating
  if (!url) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span>{stage ? stageLabel[stage] : 'Preparing…'}</span>
      </div>
    );
  }

  // Only allow relative /api/generated-images/... paths (guard against javascript: XSS)
  const safeUrl = url.startsWith('/api/generated-images/') ? url : '';

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
      {/* Image */}
      {safeUrl ? (
        <img
          src={safeUrl}
          alt="AI-generated"
          className="max-w-[512px] w-full object-contain block"
          loading="lazy"
        />
      ) : (
        <div className="p-4 text-xs text-destructive">Invalid image URL</div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-t border-border">
        <a
          href={safeUrl || '#'}
          download
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Download size={13} />
          Download
        </a>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          {copied ? 'Copied!' : 'Copy URL'}
        </button>
        {fluxPrompt && (
          <>
            <div className="w-px h-4 bg-border" />
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Flux prompt
            </button>
          </>
        )}
      </div>

      {/* Expandable Flux prompt */}
      {expanded && fluxPrompt && (
        <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/20 border-t border-border font-mono leading-relaxed">
          {fluxPrompt}
        </div>
      )}
    </div>
  );
}
