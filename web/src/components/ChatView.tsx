import { MessageCircle, Sparkles, Shield, Cpu, GitBranch, Zap, ZapOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { ChatMessage } from './ChatMessage';

const suggestions = [
  { icon: Sparkles, text: 'Explain how async/await works in C#' },
  { icon: Cpu, text: 'Write a binary search in TypeScript with tests' },
  { icon: Shield, text: 'Review this code for security issues' },
];

/** Tab strip shown when the active conversation has more than one branch. */
function BranchSwitcher() {
  const branches = useStore((s) => s.branches);
  const activeBranchId = useStore((s) => s.activeBranchId);
  const switchBranch = useStore((s) => s.switchBranch);

  if (branches.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/30 overflow-x-auto custom-scrollbar">
      <GitBranch size={13} className="text-muted-foreground flex-shrink-0 mr-1" />
      {branches.map((b, i) => (
        <button
          key={b.id}
          onClick={() => switchBranch(b.id)}
          className={cn(
            'flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors border',
            b.id === activeBranchId
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground',
          )}
        >
          {b.parentBranchId ? `Fork ${i + 1}` : `Branch ${i + 1}`}
          <span className="ml-1 opacity-60">({b.messages.filter(m => m.role === 'user' || m.role === 'assistant').length} msgs)</span>
        </button>
      ))}
    </div>
  );
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]+`/g, '')        // inline code
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/>\s*/g, '')
    .trim();
}

export function ChatView() {
  const messages = useStore((s) => s.messages);
  const isStreaming = useStore((s) => s.isStreaming);
  const sendMessage = useStore((s) => s.sendMessage);
  const voiceModeEnabled = useStore((s) => s.voiceModeEnabled);
  const smartModeEnabled = useStore((s) => s.smartModeEnabled);
  const toggleSmartMode = useStore((s) => s.toggleSmartMode);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSpokenIdRef = useRef<string | null>(null);
  const userScrolledUpRef = useRef(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Lazily attach scroll listener once the scroll container is available
    if (!scrollContainerRef.current && bottomRef.current) {
      const container = bottomRef.current.closest<HTMLElement>('.custom-scrollbar');
      if (container) {
        scrollContainerRef.current = container;
        const onScroll = () => {
          const { scrollTop, scrollHeight, clientHeight } = container;
          userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 80;
        };
        container.addEventListener('scroll', onScroll, { passive: true });
      }
    }

    // Always scroll to bottom when user sends a message; respect position during streaming
    const lastMessage = messages.at(-1);
    if (lastMessage?.role === 'user') {
      userScrolledUpRef.current = false;
    }
    if (!userScrolledUpRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // TTS: speak the last assistant message when streaming finishes
  useEffect(() => {
    if (!voiceModeEnabled || isStreaming) return;
    const last = messages.at(-1);
    if (!last || last.role !== 'assistant') return;
    if (lastSpokenIdRef.current === last.id) return;
    lastSpokenIdRef.current = last.id;
    const text = stripMarkdown(last.content).slice(0, 2500);
    if (!text) return;
    window.speechSynthesis?.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.lang = navigator.language || 'en-US';
    window.speechSynthesis?.speak(utterance);
  }, [voiceModeEnabled, isStreaming, messages]);

  const SmartModeOffBanner = !smartModeEnabled ? (
    <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-2.5 text-sm">
      <ZapOff size={15} className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="flex-1 text-amber-800 dark:text-amber-300">
        <strong>Auto (smart routing) is off.</strong> Image generation, code routing, and vision won't work.
      </span>
      <button
        onClick={toggleSmartMode}
        className="flex-shrink-0 flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
      >
        <Zap size={12} />
        Turn on
      </button>
    </div>
  ) : null;

  if (messages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <BranchSwitcher />
        {SmartModeOffBanner}
        <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] px-3 sm:px-4 pb-48 sm:pb-32">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-lg mb-6">
            <MessageCircle size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">What can I help with?</h1>
          <p className="text-muted-foreground text-sm mb-8 text-center max-w-md">
            Private, local-first AI. Your prompts never leave your machine.
          </p>
          <div className="grid gap-3 sm:grid-cols-3 max-w-3xl w-full">
            {suggestions.map(({ icon: Icon, text }) => (
              <button
                key={text}
                onClick={() => void sendMessage(text)}
                className="flex flex-col items-start gap-2 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all text-left text-sm"
              >
                <Icon size={16} className="text-muted-foreground" />
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <BranchSwitcher />
      {SmartModeOffBanner}
      <div className="pb-72 sm:pb-56">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
