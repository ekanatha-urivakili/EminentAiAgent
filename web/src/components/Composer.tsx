import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Bot, LayoutList, MessageCircle, ArrowUp, Square, X, Mic, MicOff, Plus, ImageIcon, FileText, Clock, Volume2, VolumeX, Loader2, ExternalLink, Check, Copy, ChevronDown as ChevronDownIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { api } from '../lib/api';
import type { ChatAttachment, Mode } from '../lib/types';
import { ModelSelector } from './ModelSelector';

const modeMeta: Record<Mode, { icon: typeof Bot; color: string; hint: string }> = {
  Chat: { icon: MessageCircle, color: 'text-blue-500', hint: 'General discussion' },
  Plan: { icon: LayoutList, color: 'text-amber-500', hint: 'Read-only, step-by-step plan' },
  Agent: { icon: Bot, color: 'text-emerald-500', hint: 'Autonomous tools + approvals' },
};

const MAX_RECENT = 10;
const MAX_STORE_BYTES = 200 * 1024;

interface RecentFile {
  name: string;
  type: string;
  size: number;
  lastUsed: string;
  dataUrl?: string;
  content?: string;
}

function loadRecent(): RecentFile[] {
  try { return JSON.parse(localStorage.getItem('eminentai.recentFiles') ?? '[]'); } catch { return []; }
}
function saveRecent(files: RecentFile[]) {
  localStorage.setItem('eminentai.recentFiles', JSON.stringify(files.slice(0, MAX_RECENT)));
}
function addToRecent(name: string, type: string, size: number, dataUrl?: string, content?: string) {
  const prev = loadRecent().filter((f) => f.name !== name);
  saveRecent([{ name, type, size, lastUsed: new Date().toISOString(), dataUrl: size <= MAX_STORE_BYTES ? dataUrl : undefined, content: size <= MAX_STORE_BYTES ? content : undefined }, ...prev]);
}
function fileTypeIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon size={14} />;
  return <FileText size={14} />;
}

type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'denied' | 'error';

// ── Whisper install guide ──────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="flex-shrink-0 p-1 rounded hover:bg-muted-foreground/20 transition-colors">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} className="text-muted-foreground" />}
    </button>
  );
}
function CmdLine({ cmd }: { cmd: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/70 border border-border px-2.5 py-1.5 font-mono text-xs">
      <span className="select-all break-all">{cmd}</span>
      <CopyBtn text={cmd} />
    </div>
  );
}

function WhisperGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-500/10 transition-colors">
        <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">
          Whisper server not running — voice input requires whisper.cpp on localhost:8082
        </div>
        <ChevronDownIcon size={16} className={cn('text-amber-500 transition-transform flex-shrink-0 ml-2', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-amber-500/20">
          <p className="text-sm text-muted-foreground mt-3">
            EminentAi uses <strong>whisper.cpp</strong> — a fast, open-source local speech recognition server.
            No cloud calls, no API keys. Pick any install method:
          </p>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">macOS — Homebrew (easiest)</p>
            <CmdLine cmd="brew install whisper-cpp" />
            <CmdLine cmd='whisper-server -m "$(brew --prefix)/share/whisper-cpp/models/ggml-base.en.bin" -p 8082' />
            <p className="text-xs text-muted-foreground">If the model file is missing, download it first:</p>
            <CmdLine cmd="whisper-cpp-download-ggml-model base.en" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Linux / macOS — build from source</p>
            <CmdLine cmd="git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp" />
            <CmdLine cmd="make -j && bash models/download-ggml-model.sh base.en" />
            <CmdLine cmd="./build/bin/whisper-server -m models/ggml-base.en.bin -p 8082" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Windows</p>
            <a href="https://github.com/ggerganov/whisper.cpp/releases" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink size={12} /> Download pre-built binary from GitHub releases
            </a>
            <CmdLine cmd="whisper-server.exe -m models/ggml-base.en.bin -p 8082" />
          </div>

          <div className="rounded-md bg-muted/60 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p><strong>Available models</strong> (larger = more accurate, slower):</p>
            <p><code className="bg-muted px-1 rounded">tiny.en</code> ~75 MB · fastest &nbsp;|&nbsp;
               <code className="bg-muted px-1 rounded">base.en</code> ~150 MB · recommended &nbsp;|&nbsp;
               <code className="bg-muted px-1 rounded">small.en</code> ~500 MB · best accuracy</p>
            <p className="mt-1">Replace <code className="bg-muted px-1 rounded">base.en</code> with any of the above in the commands.</p>
          </div>

          <p className="text-xs text-muted-foreground">
            Once the server is running, click the mic button to start recording. Whisper transcribes locally — no data leaves your machine.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Composer ──────────────────────────────────────────────────────────
export function Composer() {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [textAttachments, setTextAttachments] = useState<{ name: string; content: string }[]>([]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [showWhisperGuide, setShowWhisperGuide] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecent());

  const modeMenuRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const sendMessageWithAttachments = useStore((s) => s.sendMessageWithAttachments);
  const createPlan = useStore((s) => s.createPlan);
  const startAgent = useStore((s) => s.startAgent);
  const isStreaming = useStore((s) => s.isStreaming);
  const stopStreaming = useStore((s) => s.stopStreaming);
  const agentStatus = useStore((s) => s.agent.status);
  const cancelAgent = useStore((s) => s.cancelAgent);
  const selectedModel = useStore((s) => s.selectedModel);
  const voiceModeEnabled = useStore((s) => s.voiceModeEnabled);
  const toggleVoiceMode = useStore((s) => s.toggleVoiceMode);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) setModeMenuOpen(false);
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) setPlusMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input, attachments]);

  // Stop any in-progress recording when unmounting
  useEffect(() => () => { mediaRecorderRef.current?.stop(); }, []);

  const busy = isStreaming || agentStatus === 'running' || agentStatus === 'waiting_approval';

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const attachFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const otherFiles = files.filter((f) => !f.type.startsWith('image/'));
    const newImages = await Promise.all(
      imageFiles.map(async (file) => {
        const dataUrl = await readFileAsDataUrl(file);
        addToRecent(file.name, file.type, file.size, dataUrl);
        return { name: file.name, contentType: file.type, dataUrl, dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
      }),
    );
    const newText = await Promise.all(
      otherFiles.map(async (file) => {
        const content = await file.text();
        addToRecent(file.name, file.type, file.size, undefined, content);
        return { name: file.name, content };
      }),
    );
    setAttachments((prev) => [...prev, ...newImages]);
    setTextAttachments((prev) => [...prev, ...newText]);
    setRecentFiles(loadRecent());
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    await attachFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const attachRecentFile = (f: RecentFile) => {
    setPlusMenuOpen(false);
    if (f.type.startsWith('image/') && f.dataUrl) {
      setAttachments((prev) => [...prev, { name: f.name, contentType: f.type, dataUrl: f.dataUrl!, dataBase64: f.dataUrl!.slice(f.dataUrl!.indexOf(',') + 1) }]);
    } else if (f.content !== undefined) {
      setTextAttachments((prev) => [...prev, { name: f.name, content: f.content! }]);
    } else {
      fileInputRef.current?.click();
    }
  };

  const removeAttachment = (i: number) => setAttachments((prev) => prev.filter((_, j) => j !== i));
  const removeTextAttachment = (i: number) => setTextAttachments((prev) => prev.filter((_, j) => j !== i));

  // ── Voice STT via whisper.cpp ──────────────────────────────────────────
  const toggleVoice = async () => {
    // Stop if already recording
    if (voiceStatus === 'recording') {
      mediaRecorderRef.current?.stop();
      return;
    }

    // Request mic permission
    setVoiceStatus('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceStatus('denied');
      return;
    }

    audioChunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setVoiceStatus('transcribing');
      try {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const text = await api.transcribeAudio(blob);
        setInput((prev) => (prev ? `${prev} ${text}` : text));
        setVoiceStatus('idle');
        setShowWhisperGuide(false);
        // Auto-focus textarea after transcription
        setTimeout(() => textareaRef.current?.focus(), 50);
      } catch {
        setVoiceStatus('error');
      }
    };

    recorder.start();
    setVoiceStatus('recording');
  };

  const submit = () => {
    let text = input.trim();
    if (!text && attachments.length === 0 && textAttachments.length === 0) return;
    if (busy || !selectedModel) return;
    if (textAttachments.length > 0) text += textAttachments.map((a) => `\n\n<file name="${a.name}">\n${a.content}\n</file>`).join('');
    if (!text.trim() && attachments.length === 0) return;
    // Stop TTS on new user message
    window.speechSynthesis?.cancel();
    setInput(''); setAttachments([]); setTextAttachments([]);
    if (mode === 'Chat') void sendMessageWithAttachments(text, attachments);
    else if (mode === 'Plan') void createPlan(text);
    else void startAgent(text);
  };

  const stop = () => { if (mode === 'Agent') void cancelAgent(); else stopStreaming(); };

  const ModeIcon = modeMeta[mode].icon;
  const placeholder = mode === 'Chat' ? 'Message EminentAi…' : mode === 'Plan' ? 'Describe a goal to plan…' : 'Give the agent a goal…';

  const micLabel = voiceStatus === 'recording' ? 'Stop recording'
    : voiceStatus === 'transcribing' ? 'Transcribing…'
    : 'Voice input (whisper.cpp)';

  return (
    <div className="absolute bottom-0 w-full bg-gradient-to-t from-background via-background/95 to-transparent pt-8 sm:pt-10 pb-3 sm:pb-5 px-3 sm:px-6 flex justify-center z-20">
      <div className="max-w-3xl w-full space-y-2">

        <div className="relative rounded-3xl border border-input bg-card shadow-lg shadow-black/5 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all flex flex-col">

          {(attachments.length > 0 || textAttachments.length > 0) && (
            <div className="px-5 pt-3 pb-1 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <div key={`${a.name}-${i}`} className="relative group">
                  <img src={a.dataUrl} alt={a.name} className="h-20 w-20 rounded-xl border border-border object-cover" />
                  <button onClick={() => removeAttachment(i)} className="absolute -right-2 -top-2 bg-background border border-border rounded-full p-1 shadow-sm opacity-90 hover:opacity-100"><X size={14} /></button>
                </div>
              ))}
              {textAttachments.map((a, i) => (
                <div key={`${a.name}-${i}`} className="flex items-center gap-1.5 bg-muted text-foreground text-sm px-2.5 py-1.5 rounded-lg border border-border">
                  <span className="font-medium max-w-[120px] truncate">{a.name}</span>
                  <button onClick={() => removeTextAttachment(i)} className="text-muted-foreground hover:text-foreground transition-colors"><X size={15} /></button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={placeholder}
            rows={1}
            className={cn(
              'w-full bg-transparent rounded-3xl pl-4 sm:pl-5 pr-32 pb-24 sm:pb-12 focus:outline-none resize-none max-h-48 overflow-y-auto custom-scrollbar text-base leading-6 font-medium',
              attachments.length > 0 ? 'pt-2' : 'pt-4',
            )}
            style={{ minHeight: '112px' }}
          />

          <div className="absolute left-3 right-32 bottom-2.5 z-10 flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* "+" attachment */}
            <div ref={plusMenuRef} className="relative">
              <button
                onClick={() => setPlusMenuOpen((v) => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border bg-background/60"
                title="Attach"
              >
                <Plus size={18} />
              </button>
              <AnimatePresence>
                {plusMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                    transition={{ duration: 0.13 }}
                    className="absolute bottom-full left-0 mb-2 w-72 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl overflow-hidden py-1.5"
                  >
                    <button
                      onClick={() => { setPlusMenuOpen(false); fileInputRef.current?.click(); }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-left hover:bg-muted transition-colors"
                    >
                      <ImageIcon size={17} className="text-muted-foreground" />
                      <span className="font-medium">Add files or photos</span>
                    </button>
                    {recentFiles.length > 0 && (
                      <>
                        <div className="mx-3 my-1.5 border-t border-border" />
                        <div className="px-4 py-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <Clock size={12} /> Recent
                        </div>
                        {recentFiles.map((f) => (
                          <button
                            key={f.name + f.lastUsed}
                            onClick={() => attachRecentFile(f)}
                            className="flex items-center gap-2.5 w-full px-4 py-3 text-sm text-left hover:bg-muted transition-colors"
                          >
                            <span className="text-muted-foreground flex-shrink-0">{fileTypeIcon(f.type)}</span>
                            <span className="truncate flex-1">{f.name}</span>
                            <span className="text-xs text-muted-foreground flex-shrink-0">{new Date(f.lastUsed).toLocaleDateString()}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} />

            <ModelSelector compact />

            {/* Mode selector */}
            <div ref={modeMenuRef} className="relative">
              <button
                onClick={() => setModeMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-full hover:bg-muted text-sm font-medium transition-colors border border-border bg-background/60"
              >
                <ModeIcon size={15} className={modeMeta[mode].color} />
                <span>{mode}</span>
                <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', modeMenuOpen && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {modeMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                    transition={{ duration: 0.13 }}
                    className="absolute bottom-full left-0 mb-2 w-64 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl overflow-hidden py-1.5"
                  >
                    {(Object.keys(modeMeta) as Mode[]).map((m) => {
                      const Icon = modeMeta[m].icon;
                      return (
                        <button
                          key={m}
                          onClick={() => { setMode(m); setModeMenuOpen(false); }}
                          className="flex items-center gap-3 w-full px-4 py-3 text-sm text-left hover:bg-muted transition-colors relative"
                        >
                          {mode === m && <motion.div layoutId="activeMode" className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />}
                          <Icon size={17} className={modeMeta[m].color} />
                          <div className="flex flex-col">
                            <span className="font-medium leading-none mb-1.5">{m}</span>
                            <span className="text-xs text-muted-foreground leading-none">{modeMeta[m].hint}</span>
                          </div>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>

          {busy ? (
            <button onClick={stop} className="absolute right-3 bottom-3 flex items-center justify-center w-10 h-10 rounded-full bg-foreground text-background shadow-md hover:scale-105 transition-all" title="Stop">
              <Square size={15} className="fill-current" />
            </button>
          ) : (
            <div className="absolute right-3 bottom-3 z-10 flex items-center gap-1.5">
              <button
                onClick={() => void toggleVoice()}
                disabled={voiceStatus === 'transcribing' || voiceStatus === 'requesting'}
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                  voiceStatus === 'recording'
                    ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                    : voiceStatus === 'transcribing' || voiceStatus === 'requesting'
                    ? 'text-muted-foreground'
                    : 'text-foreground hover:bg-muted',
                )}
                title={micLabel}
              >
                {voiceStatus === 'recording' && (
                  <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
                )}
                {voiceStatus === 'transcribing' || voiceStatus === 'requesting'
                  ? <Loader2 size={20} className="animate-spin" />
                  : voiceStatus === 'recording'
                  ? <MicOff size={20} />
                  : <Mic size={20} />
                }
              </button>

              <button
                onClick={() => { toggleVoiceMode(); window.speechSynthesis?.cancel(); }}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-md transition-all hover:scale-105',
                  voiceModeEnabled && 'ring-2 ring-primary/30',
                )}
                title={voiceModeEnabled ? 'Voice mode on — AI responses are spoken aloud' : 'Enable voice mode — AI speaks responses'}
              >
                {voiceModeEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
              </button>

              {(input.trim() || attachments.length > 0 || textAttachments.length > 0) && (
                <button
                  onClick={submit}
                  disabled={!selectedModel}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-md transition-all hover:scale-105 disabled:opacity-50"
                  title="Send"
                >
                  <ArrowUp size={19} strokeWidth={2.5} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="text-center text-xs text-muted-foreground tracking-wide opacity-70">
          {voiceStatus === 'requesting' ? 'Requesting microphone access…'
            : voiceStatus === 'recording' ? 'Recording… click mic again to stop and transcribe'
            : voiceStatus === 'transcribing' ? 'Transcribing with Whisper…'
            : voiceStatus === 'denied' ? 'Microphone permission denied. Allow access in browser settings.'
            : voiceStatus === 'error' ? 'Could not reach whisper.cpp server. See setup guide below.'
            : voiceModeEnabled ? 'Voice mode on — AI responses will be read aloud.'
            : mode === 'Agent' ? 'Write actions always require your approval.'
            : 'EminentAi runs entirely on this machine. Your data stays local.'}
        </div>

        {/* Whisper install guide — shown below the input so it never overlaps chat messages */}
        <AnimatePresence>
          {voiceStatus === 'error' && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              <WhisperGuide open={showWhisperGuide} onToggle={() => setShowWhisperGuide((v) => !v)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
