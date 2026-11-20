import { useState, type FormEvent } from 'react';
import { Mic, MicOff, SendHorizonal, Square } from 'lucide-react';
import type { Attachment } from '@/core/agent/agent.ts';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useApp } from '@/lib/app.tsx';
import { voiceSupport } from '@/lib/voice.ts';
import { cn } from '@/lib/cn.ts';

export function CommandBar({ autoFocus, placeholder, className, onSent, attachments, leading }: { autoFocus?: boolean; placeholder?: string; className?: string; onSent?: () => void; attachments?: Attachment[]; leading?: React.ReactNode }) {
  const { send, busy, listening, startListening, stopListening, interim, core, stopSpeaking } = useJarvis();
  const { prefs } = useApp();
  const [text, setText] = useState('');
  const voiceOk = prefs.voice_enabled && (voiceSupport.recognition() || voiceSupport.recorder());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim() || (attachments?.length ? 'Analise o(s) arquivo(s) anexado(s) e destaque o que é importante.' : '');
    if (!t) return;
    setText('');
    await send(t, attachments?.length ? { attachments } : undefined);
    onSent?.();
  };

  return (
    <form onSubmit={submit} className={cn('glass glow-border flex items-center gap-2 rounded-2xl p-1.5 pl-4', leading && 'pl-1.5', className)}>
      {leading}
      <input
        value={listening ? interim : text}
        onChange={(e) => setText(e.target.value)}
        autoFocus={autoFocus}
        disabled={listening}
        placeholder={listening ? 'Ouvindo… fale naturalmente' : placeholder ?? 'Diga ou digite um comando — ex.: “academia amanhã às 9”'}
        aria-label="Comando para o JARVIS"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-muted/70 focus:outline-none focus-visible:outline-none"
      />
      {core === 'speaking' && (
        <button type="button" onClick={stopSpeaking} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:text-ink hover:bg-white/5 cursor-pointer" aria-label="Interromper fala">
          <Square className="h-4 w-4" />
        </button>
      )}
      {voiceOk && (
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          disabled={busy}
          className={cn(
            'relative grid h-10 w-10 place-items-center rounded-xl transition cursor-pointer disabled:opacity-40',
            listening ? 'bg-cyan text-void shadow-[0_0_24px_rgb(0_217_255/0.8)]' : 'bg-cyan/10 text-cyan hover:bg-cyan/20',
          )}
          aria-label={listening ? 'Parar de ouvir' : 'Falar com o JARVIS'}
          aria-pressed={listening}
        >
          {listening && <span className="absolute inset-0 rounded-xl animate-ping bg-cyan/40" />}
          {listening ? <MicOff className="relative h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
        </button>
      )}
      <button
        type="submit"
        disabled={busy || listening || (!text.trim() && !attachments?.length)}
        className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-r from-tech to-cyan text-void transition disabled:opacity-30 cursor-pointer"
        aria-label="Enviar comando"
      >
        <SendHorizonal className="h-4.5 w-4.5" />
      </button>
    </form>
  );
}
