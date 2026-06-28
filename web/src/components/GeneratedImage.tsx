import { useState } from 'react';
import { Download, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ImageGenStage } from '../lib/types';

interface GeneratedImageProps {
  url?: string;
  fluxPrompt?: string;
  stage?: ImageGenStage;
  className?: string;
}

export function GeneratedImage({ url, fluxPrompt, stage, className }: GeneratedImageProps) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const safeUrl = url?.startsWith('/api/generated-images/') ? url : '';

  const handleDownload = async () => {
    if (!safeUrl || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(safeUrl);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = safeUrl.split('/').pop() ?? 'image.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } finally {
      setDownloading(false);
    }
  };

  if (!url) {
    const stageLabel: Partial<Record<ImageGenStage, string>> = {
      generating: 'Generating image (30–120 s)…',
      saving: 'Saving image…',
    };
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span>{stage ? (stageLabel[stage] ?? 'Preparing…') : 'Preparing…'}</span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Image with hover-overlay download */}
      <div className="group/img relative overflow-hidden rounded-xl border border-border">
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

        {safeUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-3 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity duration-200">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-lg hover:bg-white transition-colors disabled:opacity-60"
            >
              {downloading
                ? <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-transparent" />
                : <Download size={12} />
              }
              Download
            </button>
          </div>
        )}
      </div>

      {/* Expandable prompt */}
      {fluxPrompt && (
        <div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            Prompt
          </button>
          {expanded && (
            <div className="mt-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] font-mono text-muted-foreground leading-relaxed">
              {fluxPrompt}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
