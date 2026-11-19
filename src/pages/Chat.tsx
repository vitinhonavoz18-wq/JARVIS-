import { useEffect, useRef } from 'react';
import { MessageSquarePlus, Sparkles, Cpu } from 'lucide-react';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useApp } from '@/lib/app.tsx';
import { JarvisCore } from '@/components/core/JarvisCore.tsx';
import { CommandBar } from '@/components/CommandBar.tsx';
import { ChatMessage } from '@/components/ChatMessage.tsx';
import { Badge, Button } from '@/components/ui/index.tsx';
import { HELP_TEXT } from '@/core/agent/nlu.ts';

export default function Chat() {
  const j = useJarvis();
  const { aiAvailable, mode, prefs } = useApp();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [j.messages.length, j.busy]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('voz') === '1') j.startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <JarvisCore state={j.core} level={j.level} size={64} showLabel={false} />
          <div>
            <h1 className="font-display text-xl font-semibold">Conversar com {prefs.assistant_name}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="cyan"><Cpu className="h-3 w-3" /> Comandos locais ativos</Badge>
              {aiAvailable ? (
                <Badge tone="violet"><Sparkles className="h-3 w-3" /> IA avançada conectada</Badge>
              ) : (
                <Badge tone="warn">IA avançada {mode === 'local' ? 'indisponível no Modo Local' : 'não configurada no servidor'}</Badge>
              )}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={j.newConversation}><MessageSquarePlus className="h-4 w-4" /> Nova conversa</Button>
      </div>

      <div className="flex-1 space-y-3 pb-4" aria-live="polite">
        {!j.messages.length && (
          <div className="glass rounded-2xl p-5 text-sm text-muted whitespace-pre-line">
            <p className="mb-2 font-display text-base text-ink">Como posso ajudar?</p>
            {HELP_TEXT}
          </div>
        )}
        {j.messages.map((m, i) => (
          <ChatMessage key={m.id} msg={m} isLast={i === j.messages.length - 1} />
        ))}
        {j.busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse-soft" style={{ animationDelay: `${i * 0.2}s` }} />)}
            </span>
            processando…
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="sticky bottom-[calc(4.5rem+var(--safe-bottom))] lg:bottom-4 z-20">
        {j.listening && <p className="mb-2 text-center text-sm text-cyan">{j.interim || 'Ouvindo…'}</p>}
        <CommandBar autoFocus />
      </div>
    </div>
  );
}
