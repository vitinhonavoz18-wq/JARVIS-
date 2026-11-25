import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { runAgent, metaFrom, type AgentOutput, type Attachment } from '@/core/agent/agent.ts';
import type { Conversation, ConversationMessage, Reminder } from '@/core/types.ts';
import { MEMORY_LIMITS, memoryBlock } from '@/core/memory/engine.ts';
import { uuid } from '@/core/data/memoryRepo.ts';
import { useApp } from './app.tsx';
import { listenOnce, premiumVoiceAvailable, speak, stopSpeaking, voiceSupport, WakeWordListener, type ListenHandle } from './voice.ts';
import { startInAppReminderLoop, syncNativeLocalNotifications } from './notifications.ts';

export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'executing' | 'success' | 'error';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone?: 'info' | 'success' | 'error' | 'reminder';
}

interface JarvisState {
  core: CoreState;
  level: MutableRefObject<number>;
  interim: string;
  messages: ConversationMessage[];
  busy: boolean;
  conversationReady: boolean;
  /** Conversa privada: o JARVIS não cria memórias nem decisões, e ela fica fora das buscas. */
  privateConversation: boolean;
  setPrivateConversation(v: boolean): Promise<void>;
  send(text: string, opts?: { voice?: boolean; attachments?: Attachment[] }): Promise<AgentOutput | null>;
  confirmProposal(): Promise<void>;
  cancelProposal(): Promise<void>;
  startListening(): void;
  stopListening(): void;
  stopSpeaking(): void;
  listening: boolean;
  wakeActive: boolean;
  newConversation(): Promise<void>;
  toasts: Toast[];
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;
  captureOpen: boolean;
  setCaptureOpen(v: boolean): void;
  /** Abre a captura rápida já preenchida (ex.: texto compartilhado de outro app). */
  openCapture(text?: string): void;
  capturePrefill: string;
  paletteOpen: boolean;
  setPaletteOpen(v: boolean): void;
}

const Ctx = createContext<JarvisState | null>(null);
export function useJarvis() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useJarvis fora do provider');
  return v;
}

export function JarvisProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const { repo, prefs, status } = app;
  const [core, setCore] = useState<CoreState>('idle');
  const [interim, setInterim] = useState('');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturePrefill, setCapturePrefill] = useState('');
  const openCapture = useCallback((text = '') => {
    setCapturePrefill(text.slice(0, 5000));
    setCaptureOpen(true);
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const level = useRef(0);
  const listenRef = useRef<ListenHandle | null>(null);
  const wakeRef = useRef<WakeWordListener | null>(null);
  const convRef = useRef<Conversation | null>(null);
  convRef.current = conversation;

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = uuid();
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.tone === 'reminder' ? 15000 : 5000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((x) => x.filter((y) => y.id !== id)), []);

  const flash = useCallback((s: CoreState, ms = 1400) => {
    setCore(s);
    window.setTimeout(() => setCore((c) => (c === s ? 'idle' : c)), ms);
  }, []);

  // Carrega a conversa mais recente.
  useEffect(() => {
    if (status !== 'ready') return;
    let alive = true;
    (async () => {
      const convs = await repo.table('conversations').list({ order: [{ field: 'updated_at', asc: false }], limit: 1 });
      if (!alive) return;
      const conv = convs[0] ?? (await repo.table('conversations').insert({ title: 'Conversa principal', state: null }));
      const msgs = await repo.table('conversation_messages').list({ eq: { conversation_id: conv.id }, order: [{ field: 'created_at', asc: true }] });
      if (!alive) return;
      setConversation(conv);
      setMessages(msgs.slice(-80));
    })().catch(() => {
      if (alive) toast({ title: 'Falha ao carregar a conversa', body: 'Recarregue a página para tentar novamente.', tone: 'error' });
    });
    return () => {
      alive = false;
    };
  }, [status, repo, toast]);

  const newConversation = useCallback(async () => {
    const conv = await repo.table('conversations').insert({ title: 'Nova conversa', state: null });
    setConversation(conv);
    setMessages([]);
  }, [repo]);

  /** Só as memórias relevantes para a mensagem (top-k) + as essenciais (importância ≥ 4). Nunca a memória inteira. */
  const memories = useCallback(async (text: string) => {
    if (!prefs.memory_enabled) return [];
    const [hits, essential] = await Promise.all([
      repo.searchMemories(text, MEMORY_LIMITS.topK).catch(() => []),
      repo.table('user_memories').list({ eq: { active: true }, gte: { importance: 4 }, order: [{ field: 'updated_at', asc: false }], limit: 3 }).catch(() => []),
    ]);
    const seen = new Set<string>();
    const all = [...essential.filter((m) => !m.superseded_by), ...hits].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    return memoryBlock(all);
  }, [repo, prefs.memory_enabled]);

  const send = useCallback(
    async (text: string, opts: { voice?: boolean; attachments?: Attachment[] } = {}) => {
      const clean = text.trim();
      if (!clean || busy) return null;
      const conv = convRef.current;
      if (!conv) return null;
      setBusy(true);
      setCore('thinking');
      stopSpeaking();
      try {
        const label = opts.attachments?.length ? `${clean}\n📎 ${opts.attachments.map((a) => a.name).join(', ')}` : clean;
        const userMsg = await repo.table('conversation_messages').insert({ conversation_id: conv.id, role: 'user', content: label.slice(0, 20000), meta: null });
        setMessages((m) => [...m, userMsg]);
        const history = messages.slice(-10).map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
        const out = await runAgent({
          text: clean,
          ctx: { ...app.toolCtx(opts.voice ? 'voice' : 'ai'), conversationId: conv.id, privateConversation: Boolean(conv.private) },
          state: conv.state,
          history,
          llm: app.llm,
          memories: await memories(clean),
          requestId: userMsg.id,
          conversationId: conv.id,
          attachments: opts.attachments,
          style: (await repo.table('ai_settings').list({ limit: 1 }).catch(() => []))[0]?.response_style,
        });
        const asst = await repo.table('conversation_messages').insert({ conversation_id: conv.id, role: 'assistant', content: out.reply.slice(0, 20000), meta: metaFrom(out) });
        setMessages((m) => [...m, asst]);
        const updated = await repo.table('conversations').update(conv.id, { state: out.state, title: conv.title === 'Nova conversa' ? clean.slice(0, 60) : conv.title });
        setConversation(updated);
        if (out.error) flash('error', 2500);
        else if (out.actions.some((a) => a.ok)) flash('success');
        else setCore('idle');
        if (opts.voice && prefs.tts_enabled && (voiceSupport.tts() || premiumVoiceAvailable())) {
          setCore('speaking');
          await speak(out.reply, { rate: prefs.tts_rate, voice: prefs.tts_voice, onBoundary: () => (level.current = 0.4 + Math.random() * 0.5) });
          level.current = 0;
          setCore((c) => (c === 'speaking' ? 'idle' : c));
        }
        syncNativeLocalNotifications(repo).catch(() => {});
        return out;
      } catch (e) {
        flash('error', 2500);
        toast({ title: 'Não foi possível concluir', body: e instanceof Error ? e.message : String(e), tone: 'error' });
        return null;
      } finally {
        setBusy(false);
        wakeRef.current?.resume();
      }
    },
    [busy, repo, messages, app, memories, prefs.tts_enabled, prefs.tts_rate, prefs.tts_voice, flash, toast],
  );

  const confirmProposal = useCallback(async () => {
    await send('Sim, pode executar.');
  }, [send]);
  const cancelProposal = useCallback(async () => {
    await send('Não, cancele.');
  }, [send]);

  const startListening = useCallback(() => {
    if (listenRef.current) return;
    stopSpeaking();
    wakeRef.current?.pause();
    setListening(true);
    setCore('listening');
    setInterim('');
    const h = listenOnce({ onInterim: setInterim, onLevel: (v) => (level.current = v) });
    listenRef.current = h;
    h.result
      .then(async (text) => {
        listenRef.current = null;
        setListening(false);
        setInterim('');
        if (text) await send(text, { voice: true });
        else {
          setCore('idle');
          wakeRef.current?.resume();
        }
      })
      .catch((e) => {
        listenRef.current = null;
        setListening(false);
        flash('error', 2500);
        toast({ title: 'Microfone', body: e instanceof Error ? e.message : String(e), tone: 'error' });
        wakeRef.current?.resume();
      });
  }, [send, flash, toast]);

  const stopListening = useCallback(() => listenRef.current?.stop(), []);

  // Palavra de ativação (somente com permissão e app aberto).
  useEffect(() => {
    if (status !== 'ready' || !prefs.voice_enabled || !prefs.wake_word_enabled) return;
    const w = new WakeWordListener(
      (rest) => {
        if (rest.split(/\s+/).length >= 2) send(rest, { voice: true });
        else startListening();
      },
      setWakeActive,
    );
    if (!w.supported) return;
    wakeRef.current = w;
    w.start();
    return () => {
      w.stop();
      wakeRef.current = null;
    };
  }, [status, prefs.voice_enabled, prefs.wake_word_enabled, send, startListening]);

  // Lembretes com o app aberto.
  useEffect(() => {
    if (status !== 'ready') return;
    const stop = startInAppReminderLoop(repo, (r: Reminder) => {
      toast({ title: `⏰ ${r.title}`, body: r.body ?? undefined, tone: 'reminder' });
    });
    syncNativeLocalNotifications(repo).catch(() => {});
    return stop;
  }, [status, repo, toast]);

  // Atalhos de teclado globais.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        openCapture();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        startListening();
      } else if (e.key === 'Escape') {
        stopSpeaking();
        listenRef.current?.abort();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startListening, openCapture]);

  const value = useMemo<JarvisState>(
    () => ({
      core, level, interim, messages, busy, conversationReady: Boolean(conversation), send,
      privateConversation: Boolean(conversation?.private),
      setPrivateConversation: async (v: boolean) => {
        const conv = convRef.current;
        if (!conv) return;
        try {
          setConversation(await repo.table('conversations').update(conv.id, { private: v }));
          toast({ title: v ? 'Conversa privada ativada' : 'Conversa privada desativada', body: v ? 'Nada desta conversa vira memória, e ela não aparece nas buscas.' : 'O JARVIS volta a poder aprender com esta conversa (com sua autorização).' });
        } catch (e) {
          toast({ title: 'Não foi possível alterar', body: e instanceof Error ? e.message : String(e), tone: 'error' });
        }
      }, confirmProposal, cancelProposal, startListening, stopListening,
      stopSpeaking: () => {
        stopSpeaking();
        setCore('idle');
      },
      listening, wakeActive, newConversation, toasts, toast, dismissToast, captureOpen, setCaptureOpen, openCapture, capturePrefill, paletteOpen, setPaletteOpen,
    }),
    [core, interim, messages, conversation, repo, busy, send, confirmProposal, cancelProposal, startListening, stopListening, listening, wakeActive, newConversation, toasts, toast, dismissToast, captureOpen, openCapture, capturePrefill, paletteOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
