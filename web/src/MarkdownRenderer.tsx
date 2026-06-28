import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Download } from 'lucide-react';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
  content: string;
}

function GeneratedImageBlock({ src, alt }: { src: string; alt: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = src.split('/').pop() ?? 'image.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <span className="group/img relative inline-block overflow-hidden rounded-xl border border-border not-prose">
      <img src={src} alt={alt} className="max-w-[512px] w-full object-contain block" loading="lazy" />
      <span className="pointer-events-none absolute inset-0 flex items-end justify-end p-3 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity duration-200">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-lg hover:bg-white transition-colors disabled:opacity-60"
        >
          {downloading
            ? <span className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-transparent inline-block" />
            : <Download size={12} />
          }
          Download
        </button>
      </span>
    </span>
  );
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-base dark:prose-invert max-w-none prose-p:leading-7 prose-li:leading-7 prose-pre:bg-transparent prose-pre:m-0 prose-pre:p-0 prose-pre:rounded-lg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          img({ src, alt }) {
            if (src?.startsWith('/api/generated-images/')) {
              return <GeneratedImageBlock src={src} alt={alt ?? ''} />;
            }
            return <img src={src} alt={alt} />;
          },
          code({ inline, className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            
            if (!inline && match) {
              return (
                <div className="markdown-code-block relative group rounded-lg overflow-hidden border border-border my-4 bg-[#f3f4f6] dark:bg-[#07111f] navy:bg-[#0a1525]">
                  <div className="flex items-center justify-between px-4 py-2 bg-[#e5e7eb] dark:bg-[#0b1728] navy:bg-[#162236] text-muted-foreground text-xs font-sans border-b border-border">
                    <span>{language}</span>
                    <button className="hover:text-foreground transition-colors" onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}>
                      Copy code
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <code className={`${className ?? ''} block bg-transparent p-4`} {...props}>
                      {children}
                    </code>
                  </div>
                </div>
              );
            }
            return (
              <code className="bg-muted px-1.5 py-0.5 rounded-md text-sm font-mono" {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
