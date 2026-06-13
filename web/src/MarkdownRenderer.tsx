import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-pre:bg-transparent prose-pre:m-0 prose-pre:p-0 prose-pre:rounded-lg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          code({ inline, className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            
            if (!inline && match) {
              return (
                <div className="markdown-code-block relative group rounded-lg overflow-hidden border border-border my-4 bg-[#f3f4f6] dark:bg-[#07111f]">
                  <div className="flex items-center justify-between px-4 py-2 bg-[#e5e7eb] dark:bg-[#0b1728] text-muted-foreground text-xs font-sans border-b border-border">
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
