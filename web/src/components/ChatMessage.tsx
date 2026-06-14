import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Flame,
  GitBranch,
  ListChecks,
  RefreshCw,
  Search,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ChatMsg, ChatSource } from '../lib/types';
import { RoutingBadge } from './RoutingBadge';
import { GeneratedImage } from './GeneratedImage';

type Feedback = 'liked' | 'disliked' | undefined;
type ExportFormat = 'pdf' | 'markdown' | 'docx' | 'txt';
type ActionStatus = 'Copied' | 'Liked' | 'Disliked' | 'Shared' | 'Exported' | 'Unavailable' | undefined;
const COLLAPSE_TEXT_LENGTH = 420;
const COLLAPSE_LINE_COUNT = 3;

const thinkingSteps = [
  { label: 'Reading your prompt', detail: 'Identifying the language, intent, and context.', icon: Search },
  { label: 'Planning the answer', detail: 'Choosing the clearest structure before writing.', icon: BrainCircuit },
  { label: 'Checking edge cases', detail: 'Looking for details that could change the explanation.', icon: ListChecks },
  { label: 'Composing response', detail: 'Turning the reasoning into a useful answer.', icon: Flame },
];

const sourceUrlPattern = /https?:\/\/[^\s)\]>"]+/g;
const markdownLinkPattern = /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g;

function extractSources(message: ChatMsg): ChatSource[] {
  const explicit = message.sources ?? [];
  const markdownLinks = [...message.content.matchAll(markdownLinkPattern)];
  const urls = message.content.match(sourceUrlPattern) ?? [];
  const byUrl = new Map<string, ChatSource>();

  for (const source of explicit) byUrl.set(source.url, source);
  for (const match of markdownLinks) {
    const title = match[1]?.trim();
    const cleanUrl = cleanSourceUrl(match[2] ?? '');
    if (cleanUrl && !byUrl.has(cleanUrl)) {
      byUrl.set(cleanUrl, { url: cleanUrl, title: title || sourceTitle(cleanUrl) });
    }
  }
  for (const url of urls) {
    const cleanUrl = cleanSourceUrl(url);
    if (!byUrl.has(cleanUrl)) {
      byUrl.set(cleanUrl, { url: cleanUrl, title: sourceTitle(cleanUrl) });
    }
  }

  return [...byUrl.values()];
}

function cleanSourceUrl(url: string) {
  return url.replace(/[.,;:!?]+$/, '');
}

function sourceTitle(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function safeFileName(id: string, extension: string) {
  return `eminentai-response-${id.replace(/[^a-z0-9_-]/gi, '') || 'message'}.${extension}`;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function makeZip(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const checksum = crc32(contentBytes);
    const local: number[] = [];

    writeUint32(local, 0x04034b50);
    writeUint16(local, 20);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint32(local, checksum);
    writeUint32(local, contentBytes.length);
    writeUint32(local, contentBytes.length);
    writeUint16(local, nameBytes.length);
    writeUint16(local, 0);

    chunks.push(new Uint8Array(local), nameBytes, contentBytes);

    const header: number[] = [];
    writeUint32(header, 0x02014b50);
    writeUint16(header, 20);
    writeUint16(header, 20);
    writeUint16(header, 0);
    writeUint16(header, 0);
    writeUint16(header, 0);
    writeUint16(header, 0);
    writeUint32(header, checksum);
    writeUint32(header, contentBytes.length);
    writeUint32(header, contentBytes.length);
    writeUint16(header, nameBytes.length);
    writeUint16(header, 0);
    writeUint16(header, 0);
    writeUint16(header, 0);
    writeUint16(header, 0);
    writeUint32(header, 0);
    writeUint32(header, offset);
    central.push(new Uint8Array(header), nameBytes);

    offset += local.length + nameBytes.length + contentBytes.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end: number[] = [];
  writeUint32(end, 0x06054b50);
  writeUint16(end, 0);
  writeUint16(end, 0);
  writeUint16(end, files.length);
  writeUint16(end, files.length);
  writeUint32(end, centralSize);
  writeUint32(end, offset);
  writeUint16(end, 0);

  const zipBytes = new Uint8Array([...chunks, ...central, new Uint8Array(end)].flatMap((chunk) => [...chunk]));
  return new Blob([zipBytes.buffer.slice(0)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function makeDocx(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph.replace(/\n/g, ' '))}</w:t></w:r></w:p>`)
    .join('');

  return makeZip([
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`,
    },
  ]);
}

function ThinkingIndicator({ hasContent }: { hasContent: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (hasContent) return undefined;
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % thinkingSteps.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [hasContent]);

  const current = hasContent
    ? { label: 'Writing response', detail: 'Streaming tokens into the answer.', icon: Flame }
    : thinkingSteps[step];
  const Icon = current.icon;

  if (hasContent) {
    return (
      <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span>{current.label}</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl rounded-2xl border border-border bg-background/85 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-sm">
          <Icon size={17} />
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium leading-tight">{current.label}</p>
            <div className="flex items-center gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/75 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50" />
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{current.detail}</p>
          <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
            {thinkingSteps.map((item, index) => (
              <div
                key={item.label}
                className={cn(
                  'h-1.5 rounded-full transition-colors duration-300',
                  index <= step ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserText({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = content.length > COLLAPSE_TEXT_LENGTH || content.split('\n').length > COLLAPSE_LINE_COUNT;

  return (
    <div className="w-full text-left">
      <div
        className={cn(
          'whitespace-pre-wrap break-words',
          shouldCollapse && !expanded && 'line-clamp-3',
        )}
      >
        {content}
      </div>
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-sm font-medium text-primary hover:text-primary/80"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function ImagePreview({
  src,
  alt,
  onOpen,
}: {
  src: string;
  alt: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="max-w-full rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
      title="Open image"
    >
      <img
        src={src}
        alt={alt}
        className="max-h-56 sm:max-h-64 max-w-full rounded-xl object-contain"
      />
    </button>
  );
}

export function ChatMessage({ message }: { message: ChatMsg }) {
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [exportOpen, setExportOpen] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus>();
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string }>();
  const regenerate = useStore((s) => s.regenerate);
  const forkConversation = useStore((s) => s.forkConversation);
  const isStreaming = useStore((s) => s.isStreaming);
  const isUser = message.role === 'user';
  const hasAssistantContent = !isUser && message.content.trim().length > 0;
  const sources = useMemo(() => extractSources(message), [message]);

  const showStatus = (status: ActionStatus) => {
    setActionStatus(status);
    window.setTimeout(() => setActionStatus(undefined), 1600);
  };

  const copy = async () => {
    try {
      await copyText(message.content);
      setCopied(true);
      showStatus('Copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      showStatus('Unavailable');
    }
  };

  const fork = async () => {
    if (forking) return;
    setForking(true);
    try { await forkConversation(message.id); }
    finally { setForking(false); }
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'EminentAi response', text: message.content });
        showStatus('Shared');
        return;
      }
      await copy();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') await copy();
    }
  };

  const exportMessage = (format: ExportFormat) => {
    setExportOpen(false);
    if (format === 'pdf') {
      const win = window.open('', '_blank');
      if (!win) {
        showStatus('Unavailable');
        return;
      }
      win.document.write(`<!doctype html><html><head><title>EminentAi response</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55;max-width:760px;margin:48px auto;padding:0 24px;white-space:pre-wrap;color:#111}</style></head><body>${escapeXml(message.content)}</body></html>`);
      win.document.close();
      win.focus();
      win.print();
      showStatus('Exported');
      return;
    }

    if (format === 'docx') {
      downloadBlob(safeFileName(message.id, 'docx'), makeDocx(message.content));
      showStatus('Exported');
      return;
    }

    const extension = format === 'markdown' ? 'md' : 'txt';
    const type = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    downloadBlob(safeFileName(message.id, extension), new Blob([message.content], { type }));
    showStatus('Exported');
  };

  return (
    <div className={cn('py-6 w-full flex group', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('w-full flex gap-3 sm:gap-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
        {!isUser && (
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white mt-1 ring-2 ring-background shadow-sm bg-gradient-to-br from-orange-400 to-rose-500">
            <Flame size={16} />
          </div>
        )}

        <div
          className={cn(
            'min-w-0 flex flex-col',
            isUser ? 'items-end max-w-[85%] sm:max-w-[75%]' : 'items-start flex-1 max-w-full',
          )}
        >
          {isUser ? (
            <div className="rounded-2xl bg-muted px-4 py-2.5 text-foreground shadow-sm">
              {message.attachments && message.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 justify-end">
                  {message.attachments.map((attachment, index) => (
                    <ImagePreview
                      key={`${attachment.name}-${index}`}
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      onOpen={() => setPreviewImage({ src: attachment.dataUrl, alt: attachment.name })}
                    />
                  ))}
                </div>
              )}
              {message.content && <UserText content={message.content} />}
            </div>
          ) : (
            <>
              {/* Routing badge — shown when smart chat was used */}
              {message.routingDecision && (
                <div className="mb-1.5">
                  <RoutingBadge routing={message.routingDecision} />
                </div>
              )}

              {/* Generated image (image gen agent) */}
              {(message.generatedImageUrl || message.imageGenStage) && (
                <GeneratedImage
                  url={message.generatedImageUrl}
                  fluxPrompt={message.generatedFluxPrompt}
                  stage={message.imageGenStage}
                  className="mb-2"
                />
              )}

              <div className="w-full pt-1.5 prose prose-slate dark:prose-invert navy:prose-invert max-w-none">
                {hasAssistantContent && <MarkdownRenderer content={message.content} />}
                {message.streaming && <ThinkingIndicator hasContent={hasAssistantContent} />}
              </div>
            </>
          )}

          {!message.streaming && message.content && (
            <div className={cn(
              'flex flex-wrap items-center gap-1 mt-2 text-muted-foreground transition-opacity',
              isUser ? 'opacity-0 group-hover:opacity-100' : 'opacity-100',
              isUser ? 'justify-end pr-2' : 'justify-start',
            )}>
              <button
                onClick={() => void copy()}
                className="p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors"
                title="Copy"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              </button>

              {!isUser && (
                <>
                  <button
                    onClick={() => {
                      const nextFeedback = feedback === 'liked' ? undefined : 'liked';
                      setFeedback(nextFeedback);
                      showStatus(nextFeedback ? 'Liked' : undefined);
                    }}
                    className={cn(
                      'p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors',
                      feedback === 'liked' && 'text-emerald-500',
                    )}
                    title="Like"
                  >
                    <ThumbsUp size={14} />
                  </button>
                  <button
                    onClick={() => {
                      const nextFeedback = feedback === 'disliked' ? undefined : 'disliked';
                      setFeedback(nextFeedback);
                      showStatus(nextFeedback ? 'Disliked' : undefined);
                    }}
                    className={cn(
                      'p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors',
                      feedback === 'disliked' && 'text-red-500',
                    )}
                    title="Dislike"
                  >
                    <ThumbsDown size={14} />
                  </button>
                  <button
                    onClick={() => void regenerate(message.id)}
                    disabled={isStreaming}
                    className="p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors disabled:opacity-40"
                    title="Regenerate"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={() => void share()}
                    className="p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors"
                    title="Share"
                  >
                    <Share2 size={14} />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setExportOpen((open) => !open)}
                      className="p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors"
                      title="Export"
                    >
                      <Download size={14} />
                    </button>
                    {exportOpen && (
                      <div className="absolute bottom-full left-0 mb-2 w-44 rounded-xl border border-border bg-popover p-1.5 shadow-xl z-20 text-left">
                        <button onClick={() => exportMessage('pdf')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted">
                          <FileDown size={14} />
                          PDF
                        </button>
                        <button onClick={() => exportMessage('markdown')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted">
                          <FileText size={14} />
                          Markdown
                        </button>
                        <button onClick={() => exportMessage('docx')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted">
                          <FileText size={14} />
                          DOCX
                        </button>
                        <button onClick={() => exportMessage('txt')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted">
                          <FileText size={14} />
                          TXT
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {isUser && message.id && !message.id.startsWith('u_') && (
                <button
                  onClick={() => void fork()}
                  disabled={forking || isStreaming}
                  className="p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors disabled:opacity-40"
                  title="Fork branch from here"
                >
                  <GitBranch size={14} className={forking ? 'animate-pulse' : ''} />
                </button>
              )}

              {!isUser && message.model && (
                <span className="text-[11px] font-mono ml-2 opacity-70">{message.model}</span>
              )}
              {!isUser && actionStatus && (
                <span className="text-[11px] font-medium ml-1" aria-live="polite">{actionStatus}</span>
              )}
            </div>
          )}

          {!isUser && sources.length > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-left w-full max-w-2xl">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Search size={12} />
                Sources
              </div>
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-[200px] items-center gap-2 rounded-lg border border-border bg-background/50 px-2.5 py-1 text-xs hover:bg-background hover:text-primary transition-colors shadow-sm"
                  >
                    <ExternalLink size={11} className="flex-shrink-0" />
                    <span className="truncate">{source.title ?? source.url}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
          onClick={() => setPreviewImage(undefined)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-background/80 px-3 py-1.5 text-sm shadow-sm border border-border"
            onClick={() => setPreviewImage(undefined)}
          >
            Close
          </button>
          <img
            src={previewImage.src}
            alt={previewImage.alt}
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
