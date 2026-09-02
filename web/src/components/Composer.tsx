import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Bot, LayoutList, MessageCircle, ArrowUp, Square, X, Mic, MicOff, Plus, ImageIcon, FileText, Clock, Volume2, VolumeX, Loader2, ExternalLink, Check, Copy, ChevronDown as ChevronDownIcon, Zap, Code2, Network, LayoutTemplate } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { api } from '../lib/api';
import type { AgentKind, ChatAttachment, Mode } from '../lib/types';
import { ModelSelector } from './ModelSelector';

// §18.5.4: explicit Composer affordances for the three specialist routes that make sense to pick
// up front (Vision is implied by attaching an image instead — see submit()). Selecting one of
// these sends manualRouteOverride with the next message, which the backend treats as the primary
// routing signal (§18.5.4) rather than a fallback the model has to guess from free text.
const routeOverrides: { kind: Extract<AgentKind, 'coding' | 'architecture' | 'imageGeneration'>; label: string; icon: typeof Code2 }[] = [
  { kind: 'coding', label: 'Code', icon: Code2 },
  { kind: 'architecture', label: 'Architecture', icon: Network },
  { kind: 'imageGeneration', label: 'Infographic', icon: LayoutTemplate },
];

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

type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'denied' | 'error' | 'insecure';

// ── WAV conversion for whisper.cpp compatibility ───────────────────────────
// whisper.cpp natively expects 16kHz mono PCM WAV. Browsers record webm/mp4,
// so we decode via AudioContext and re-encode to WAV before sending.
async function blobToWav(blob: Blob): Promise<Blob> {
  let arrayBuffer: ArrayBuffer;
  let decoded: AudioBuffer;
  try {
    arrayBuffer = await blob.arrayBuffer();
    const tmpCtx = new AudioContext();
    decoded = await tmpCtx.decodeAudioData(arrayBuffer);
    await tmpCtx.close();
  } catch {
    return blob; // decoding failed — send original and let the server error surface
  }
  const sampleRate = 16000;
  const numFrames = Math.ceil(decoded.duration * sampleRate);
  if (numFrames === 0) return blob;
  const offlineCtx = new OfflineAudioContext(1, numFrames, sampleRate);
  const src = offlineCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offlineCtx.destination);
  src.start(0);
  const resampled = await offlineCtx.startRendering();
  return encodeWav(resampled.getChannelData(0), sampleRate);
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

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

function WhisperGuide({
  open,
  onToggle,
  onStart,
  starting,
  startMessage,
}: {
  open: boolean;
  onToggle: () => void;
  onStart: () => void;
  starting: boolean;
  startMessage?: string;
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-500/10 transition-colors">
        <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">
          Whisper server not running — voice input requires whisper.cpp on backend host (port 8082)
        </div>
        <ChevronDownIcon size={16} className={cn('text-amber-500 transition-transform flex-shrink-0 ml-2', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-amber-500/20">
          <p className="text-sm text-muted-foreground mt-3">
            EminentAi uses <strong>whisper.cpp</strong> — a fast, open-source local speech recognition server.
            The backend proxies your requests to it. No cloud calls, no data leaves your machine.
          </p>

          <div className="rounded-lg border border-amber-500/20 bg-background/70 p-3 space-y-2">
            <button
              onClick={onStart}
              disabled={starting}
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {starting ? 'Starting Whisper...' : 'Start Whisper'}
            </button>
            <p className="text-xs text-muted-foreground">
              Uses your local <code className="bg-muted px-1 rounded">whisper-server</code> and starts it on <code className="bg-muted px-1 rounded">127.0.0.1:8082</code>.
            </p>
            {startMessage && <p className="text-xs text-muted-foreground">{startMessage}</p>}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">macOS — Homebrew (easiest)</p>
            <CmdLine cmd="brew install whisper-cpp" />
            <CmdLine cmd='whisper-server -m "$(brew --prefix)/share/whisper-cpp/models/ggml-base.en.bin" --host 127.0.0.1 --port 8082' />
            <p className="text-xs text-muted-foreground">If the model file is missing, download it first:</p>
            <CmdLine cmd="whisper-cpp-download-ggml-model base.en" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Linux / macOS — build from source</p>
            <CmdLine cmd="git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp" />
            <CmdLine cmd="make -j && bash models/download-ggml-model.sh base.en" />
            <CmdLine cmd="./build/bin/whisper-server -m models/ggml-base.en.bin --host 127.0.0.1 --port 8082" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Windows</p>
            <a href="https://github.com/ggerganov/whisper.cpp/releases" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink size={12} /> Download pre-built binary from GitHub releases
            </a>
            <CmdLine cmd="whisper-server.exe -m models/ggml-base.en.bin --host 127.0.0.1 --port 8082" />
          </div>

          <div className="rounded-md bg-muted/60 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p><strong>Available models</strong> (larger = more accurate, slower):</p>
            <p><code className="bg-muted px-1 rounded">tiny.en</code> ~75 MB · fastest &nbsp;|&nbsp;
               <code className="bg-muted px-1 rounded">base.en</code> ~150 MB · recommended &nbsp;|&nbsp;
               <code className="bg-muted px-1 rounded">small.en</code> ~500 MB · best accuracy</p>
            <p className="mt-1">Replace <code className="bg-muted px-1 rounded">base.en</code> with any of the above in the commands.</p>
          </div>

          <p className="text-xs text-muted-foreground">
            Once the server is running on the <strong>backend host</strong>, click the mic button to start recording.
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
  // §18.5.4: the explicitly-selected route for the NEXT message only — one-shot, like a
  // slash-command, not a persistent mode. undefined = plain chat, resolved server-side via tool-calling.
  const [pendingOverride, setPendingOverride] = useState<AgentKind | undefined>(undefined);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [showWhisperGuide, setShowWhisperGuide] = useState(false);
  const [startingWhisper, setStartingWhisper] = useState(false);
  const [whisperStartMessage, setWhisperStartMessage] = useState<string>();
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
  const sendSmartMessage = useStore((s) => s.sendSmartMessage);
  const smartModeEnabled = useStore((s) => s.smartModeEnabled);
  const toggleSmartMode = useStore((s) => s.toggleSmartMode);
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

  const startWhisper = async () => {
    setStartingWhisper(true);
    setWhisperStartMessage(undefined);
    try {
      const result = await api.startWhisper();
      setWhisperStartMessage(result.message);
      if (result.running) {
        setVoiceStatus('idle');
        setShowWhisperGuide(false);
      }
    } catch (err) {
      setWhisperStartMessage((err as Error).message);
    } finally {
      setStartingWhisper(false);
    }
  };

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

  // ── TTS Warm-up (needed for iOS/Safari) ──────────────────────────────────
  const warmUpVoice = () => {
    if (!voiceModeEnabled || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  };

  // ── Voice STT via whisper.cpp ──────────────────────────────────────────
  const toggleVoice = async () => {
    if (voiceStatus === 'recording') {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setVoiceStatus('insecure');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceStatus('insecure');
      return;
    }

    warmUpVoice();

    setVoiceStatus('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceStatus('denied');
      return;
    }

    audioChunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : undefined;
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setVoiceStatus('error');
      setWhisperStartMessage('Could not initialize audio recorder.');
      setShowWhisperGuide(true);
      return;
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (audioChunksRef.current.length === 0) {
        setVoiceStatus('error');
        setWhisperStartMessage('No audio captured. Check microphone input.');
        setShowWhisperGuide(true);
        return;
      }
      setVoiceStatus('transcribing');
      try {
        const raw = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        // Convert to 16kHz mono WAV — the only format whisper.cpp reliably accepts
        const wav = await blobToWav(raw);
        const text = await api.transcribeAudio(wav, 'audio.wav');
        setInput((prev) => (prev ? `${prev} ${text}` : text));
        setVoiceStatus('idle');
        setShowWhisperGuide(false);
        setTimeout(() => textareaRef.current?.focus(), 50);
      } catch (err) {
        setWhisperStartMessage((err as Error).message);
        setShowWhisperGuide(true);
        setVoiceStatus('error');
      }
    };

    recorder.start(250); // 250 ms timeslice so ondataavailable fires progressively
    setVoiceStatus('recording');
  };

  const submit = () => {
    let text = input.trim();
    if (!text && attachments.length === 0 && textAttachments.length === 0) return;
    if (busy || !selectedModel) return;
    if (textAttachments.length > 0) text += textAttachments.map((a) => `\n\n<file name="${a.name}">\n${a.content}\n</file>`).join('');
    if (!text.trim() && attachments.length === 0) return;
    
    // Warm up voice on send if enabled
    warmUpVoice();
    
    // Stop TTS on new user message
    window.speechSynthesis?.cancel();
    const sentAttachments = attachments;
    // §18.5.4: an attached image implies Vision — the same "route by UI affordance, not by
    // classifying free text" reasoning as the explicit mode buttons — unless a mode button was
    // already picked (a mode button always wins over the attachment-implies-Vision default).
    const override = pendingOverride ?? (sentAttachments.length > 0 ? 'vision' : undefined);
    setInput(''); setAttachments([]); setTextAttachments([]); setPendingOverride(undefined);
    if (mode === 'Chat') {
      // A route override only means anything through the smart-chat endpoint, so picking one
      // (or attaching an image) uses it even when the Auto toggle itself is off.
      void ((smartModeEnabled || override)
        ? sendSmartMessage(text, sentAttachments, override)
        : sendMessageWithAttachments(text, sentAttachments));
    }
    else if (mode === 'Plan') void createPlan(text);
    else void startAgent(text, undefined, sentAttachments);
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

            {/* Smart-mode toggle — routes to specialist agent automatically */}
            <button
              onClick={toggleSmartMode}
              title={smartModeEnabled ? 'Smart routing ON — click to disable' : 'Smart routing OFF — click to enable'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors border',
                smartModeEnabled
                  ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30 hover:bg-orange-500/20'
                  : 'bg-background/60 text-muted-foreground border-border hover:bg-muted',
              )}
            >
              <Zap size={14} className={smartModeEnabled ? 'text-orange-500' : ''} />
              <span className="hidden sm:inline">Auto</span>
            </button>

            {/* §18.5.4: explicit route buttons — the primary way to signal intent for a message,
                cheaper and more reliable than asking the model to infer it from free text. One-shot:
                selecting a route applies to the next send only (see pendingOverride). */}
            {mode === 'Chat' && routeOverrides.map(({ kind, label, icon: Icon }) => {
              const active = pendingOverride === kind;
              return (
                <button
                  key={kind}
                  onClick={() => setPendingOverride((prev) => (prev === kind ? undefined : kind))}
                  title={active ? `${label} mode selected — click to cancel` : `Answer as ${label}`}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors border',
                    active
                      ? 'bg-primary/10 text-primary border-primary/40 hover:bg-primary/20'
                      : 'bg-background/60 text-muted-foreground border-border hover:bg-muted',
                  )}
                >
                  <Icon size={14} />
                  <span className="hidden md:inline">{label}</span>
                </button>
              );
            })}

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
                onClick={() => { toggleVoiceMode(); window.speechSynthesis?.cancel(); warmUpVoice(); }}
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
            : voiceStatus === 'transcribing' ? 'Transcribing via backend…'
            : voiceStatus === 'denied' ? 'Microphone permission denied. Allow access in browser settings.'
            : voiceStatus === 'insecure' ? 'Microphone requires a secure context (HTTPS) or localhost.'
            : voiceStatus === 'error' ? 'Could not reach whisper server. See setup guide below.'
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
              <WhisperGuide
                open={showWhisperGuide}
                onToggle={() => setShowWhisperGuide((v) => !v)}
                onStart={() => void startWhisper()}
                starting={startingWhisper}
                startMessage={whisperStartMessage}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
