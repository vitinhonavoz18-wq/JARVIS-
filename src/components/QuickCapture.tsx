import { useEffect, useState } from 'react';
import { Mic, Sparkles, CheckSquare, NotebookPen, Lightbulb, CalendarPlus } from 'lucide-react';
import { useJarvis } from '@/lib/jarvis.tsx';
import { Button, Dialog, Textarea } from '@/components/ui/index.tsx';
import { listenOnce, voiceSupport } from '@/lib/voice.ts';
import { cn } from '@/lib/cn.ts';
import type { AgentOutput } from '@/core/agent/agent.ts';

type Kind = 'auto' | 'task' | 'note' | 'idea' | 'event';
const KINDS: { v: Kind; label: string; icon: typeof Sparkles }[] = [
  { v: 'auto', label: 'Automático', icon: Sparkles },
  { v: 'task', label: 'Tarefa', icon: CheckSquare },
  { v: 'note', label: 'Nota', icon: NotebookPen },
  { v: 'idea', label: 'Ideia', icon: Lightbulb },
  { v: 'event', label: 'Compromisso', icon: CalendarPlus },
];

/** Caixa de entrada universal: registre qualquer coisa em segundos. */
export function QuickCapture() {
  const { captureOpen, setCaptureOpen, send, busy, confirmProposal, cancelProposal, capturePrefill } = useJarvis();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('auto');
  const [result, setResult] = useState<AgentOutput | null>(null);
  const [rec, setRec] = useState(false);

  useEffect(() => {
    if (captureOpen) {
      setResult(null);
      setText(capturePrefill);
    }
  }, [captureOpen, capturePrefill]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    const prefix: Record<Kind, string> = { auto: '', task: 'crie a tarefa ', note: 'anote que ', idea: 'ideia: ', event: 'marque ' };
    const out = await send(prefix[kind] + t);
    setResult(out);
    if (out && !out.proposal && !out.state.pending && out.actions.every((a) => a.ok) && out.actions.length) {
      setText('');
      window.setTimeout(() => setCaptureOpen(false), 1600);
    }
  };

  const dictate = async () => {
    setRec(true);
    try {
      const said = await listenOnce({ onInterim: setText }).result;
      if (said) setText(said);
    } catch {
      /* erro já tratado pelo navegador */
    } finally {
      setRec(false);
    }
  };

  return (
    <Dialog open={captureOpen} onOpenChange={setCaptureOpen} title="Captura rápida" description="Escreva ou dite. O JARVIS identifica se é tarefa, nota, ideia ou compromisso.">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button key={k.v} onClick={() => setKind(k.v)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition cursor-pointer', kind === k.v ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-line text-muted hover:text-ink')}>
            <k.icon className="h-3.5 w-3.5" />
            {k.label}
          </button>
        ))}
      </div>
      <Textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="Ex.: preciso comprar um presente, estudar IA e tive uma ideia para meu aplicativo"
        aria-label="Texto da captura"
      />
      {result && (
        <div className={cn('mt-3 rounded-xl border p-3 text-sm whitespace-pre-line', result.error ? 'border-danger/40 bg-danger/5' : 'border-cyan/25 bg-cyan/5')}>
          {result.reply}
          {result.proposal && (
            <>
              <ul className="mt-2 space-y-1">
                {result.proposal.items.map((i, k) => (
                  <li key={k}>› {i}</li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm" loading={busy} onClick={async () => { await confirmProposal(); setCaptureOpen(false); }}>
                  Confirmar e salvar
                </Button>
                <Button size="sm" variant="outline" onClick={async () => { await cancelProposal(); setResult(null); }}>
                  Cancelar
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        {voiceSupport.recognition() ? (
          <Button variant="soft" onClick={dictate} disabled={rec}>
            <Mic className="h-4 w-4" /> {rec ? 'Ouvindo…' : 'Ditar'}
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={submit} loading={busy} disabled={!text.trim()}>
          Registrar <kbd className="hidden sm:inline font-mono text-[10px] opacity-70">Ctrl ↵</kbd>
        </Button>
      </div>
    </Dialog>
  );
}
