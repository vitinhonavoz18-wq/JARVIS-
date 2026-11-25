import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Sparkles, Cpu, Paperclip, X, EyeOff } from 'lucide-react';
import type { Attachment } from '@/core/agent/agent.ts';
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
  const [files, setFiles] = useState<Attachment[]>([]);
  const { toast } = j;

  const addFiles = async (list: FileList | null) => {
    const accepted = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/(plain|csv|markdown))$/;
    for (const f of Array.from(list ?? []).slice(0, 4 - files.length)) {
      if (!accepted.test(f.type)) { toast({ title: 'Tipo não suportado', body: `${f.name}: use imagem, PDF ou texto.`, tone: 'error' }); continue; }
      if (f.size > 10 * 1024 * 1024) { toast({ title: 'Arquivo muito grande', body: `${f.name}: limite de 10 MB.`, tone: 'error' }); continue; }
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(f); });
      setFiles((x) => [...x, { kind: f.type.startsWith('image/') ? 'image' : 'file', name: f.name, mime: f.type, data }]);
    }
  };

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [j.messages.length, j.busy]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('voz') === '1') j.startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col">
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
              {j.privateConversation && <Badge tone="warn"><EyeOff className="h-3 w-3" /> Privada: sem novas memórias</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" aria-pressed={j.privateConversation} onClick={() => j.setPrivateConversation(!j.privateConversation)}><EyeOff className="h-4 w-4" /> {j.privateConversation ? 'Sair do modo privado' : 'Conversa privada'}</Button>
          <Button variant="ghost" size="sm" onClick={j.newConversation}><MessageSquarePlus className="h-4 w-4" /> Nova conversa</Button>
        </div>
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

      <div className="sticky bottom-[calc(var(--nav-h)+var(--safe-bottom)+0.5rem)] lg:bottom-4 z-content">
        {j.listening && <p className="mb-2 text-center text-sm text-cyan">{j.interim || 'Ouvindo…'}</p>}
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => <span key={i} className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs">📎 {f.name}<button onClick={() => setFiles(files.filter((_, k) => k !== i))} aria-label={`Remover ${f.name}`} className="cursor-pointer"><X className="h-3 w-3" /></button></span>)}
            {!aiAvailable && <span className="text-xs text-warn">A análise de arquivos exige a IA avançada no servidor.</span>}
          </div>
        )}
        <CommandBar
          autoFocus
          attachments={files}
          onSent={() => setFiles([])}
          leading={
            <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-ink" aria-label="Anexar arquivo" title="Anexar imagem, PDF ou texto">
              <Paperclip className="h-4.5 w-4.5" />
              <input type="file" className="sr-only" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,text/markdown" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
          }
        />
      </div>
    </div>
  );
}
