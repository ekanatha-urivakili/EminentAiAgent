import { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Flame,
  GitBranch,
  RefreshCw,
  Share2,
  ThumbsDown,
  ThumbsUp,
  User,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { ChatMsg, ChatSource } from '../lib/types';

type Feedback = 'liked' | 'disliked' | undefined;
type ExportFormat = 'pdf' | 'markdown' | 'docx' | 'txt';

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

export function ChatMessage({ message }: { message: ChatMsg }) {
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [exportOpen, setExportOpen] = useState(false);
  const regenerate = useStore((s) => s.regenerate);
  const forkConversation = useStore((s) => s.forkConversation);
  const isStreaming = useStore((s) => s.isStreaming);
  const isUser = message.role === 'user';
  const sources = useMemo(() => extractSources(message), [message]);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fork = async () => {
    if (forking) return;
    setForking(true);
    try { await forkConversation(message.id); }
    finally { setForking(false); }
  };

  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'EminentAI response', text: message.content });
      return;
    }
    await copy();
  };

  const exportMessage = (format: ExportFormat) => {
    setExportOpen(false);
    if (format === 'pdf') {
      const win = window.open('', '_blank');
      if (!win) return;
      win.document.write(`<!doctype html><html><head><title>EminentAI response</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55;max-width:760px;margin:48px auto;padding:0 24px;white-space:pre-wrap;color:#111}</style></head><body>${escapeXml(message.content)}</body></html>`);
      win.document.close();
      win.focus();
      win.print();
      return;
    }

    if (format === 'docx') {
      downloadBlob(safeFileName(message.id, 'docx'), makeDocx(message.content));
      return;
    }

    const extension = format === 'markdown' ? 'md' : 'txt';
    const type = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    downloadBlob(safeFileName(message.id, extension), new Blob([message.content], { type }));
  };

  return (
    <div className={cn('py-4 sm:py-5 w-full flex group', isUser ? 'justify-end' : 'justify-start bg-muted/30')}>
      <div className={cn('max-w-3xl w-full px-3 sm:px-4 flex gap-2 sm:gap-4', isUser && 'flex-row-reverse')}>
        <div
          className={cn(
            'w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white mt-0.5 ring-2 ring-background shadow-sm',
            isUser ? 'bg-blue-600' : 'bg-gradient-to-br from-orange-400 to-rose-500',
          )}
        >
          {isUser ? <User size={15} /> : <Flame size={15} />}
        </div>

        <div
          className={cn(
            'min-w-0 max-w-[calc(100%-2.25rem)] sm:max-w-[min(42rem,calc(100%-3rem))] pt-1 text-sm md:text-[15px] leading-relaxed flex flex-col',
            isUser && 'items-end',
          )}
        >
          {isUser ? (
            <>
              {message.attachments && message.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {message.attachments.map((attachment, index) => (
                    <img
                      key={`${attachment.name}-${index}`}
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="max-h-56 sm:max-h-64 max-w-full rounded-xl border border-border object-contain"
                    />
                  ))}
                </div>
              )}
              {message.content && <div className="whitespace-pre-wrap break-words">{message.content}</div>}
            </>
          ) : (
            <>
              <MarkdownRenderer content={message.content} />
              {message.streaming && (
                <span className="inline-block w-2 h-4 bg-foreground/70 animate-pulse rounded-sm mt-1" />
              )}
            </>
          )}

          {!message.streaming && message.content && (
            <>
              {!isUser && sources.length > 0 && (
                <div className="mt-4 rounded-xl border border-border bg-background/70 p-3 text-left">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Sources</div>
                  <div className="flex flex-wrap gap-2">
                    {sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full sm:max-w-[240px] items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <ExternalLink size={13} />
                        <span className="truncate">{source.title ?? source.url}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className={cn(
                'flex flex-wrap items-center gap-1 mt-3 text-muted-foreground transition-opacity',
                isUser && 'opacity-0 group-hover:opacity-100',
                isUser && 'justify-end',
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
                      onClick={() => setFeedback(feedback === 'liked' ? undefined : 'liked')}
                      className={cn(
                        'p-1.5 hover:bg-muted hover:text-foreground rounded-md transition-colors',
                        feedback === 'liked' && 'text-emerald-500',
                      )}
                      title="Like"
                    >
                      <ThumbsUp size={14} />
                    </button>
                    <button
                      onClick={() => setFeedback(feedback === 'disliked' ? undefined : 'disliked')}
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
                        <div className="absolute bottom-full right-0 mb-2 w-44 rounded-xl border border-border bg-popover p-1.5 shadow-xl z-20 text-left">
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
                  <span className="text-[11px] font-mono ml-2">{message.model}</span>
                )}
                {!isUser && message.tokensOut != null && (
                  <span className="text-[11px] ml-1">· {message.tokensOut} tok</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
