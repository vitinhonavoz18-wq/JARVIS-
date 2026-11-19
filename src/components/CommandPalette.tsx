import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CheckSquare, NotebookPen, CalendarDays, FolderKanban, Brain, CornerDownLeft } from 'lucide-react';
import * as RDialog from '@radix-ui/react-dialog';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useApp } from '@/lib/app.tsx';
import { globalSearch, type SearchHit } from '@/core/agent/tools.ts';
import { formatRelativeDay } from '@/core/time.ts';
import { NAV } from '@/components/layout/AppShell.tsx';
import { cn } from '@/lib/cn.ts';

const ICON = { note: NotebookPen, task: CheckSquare, event: CalendarDays, project: FolderKanban, memory: Brain };
const LABEL = { note: 'Nota', task: 'Tarefa', event: 'Compromisso', project: 'Projeto', memory: 'Memória' };

/** Pesquisa global (Ctrl K) em notas, tarefas, agenda, projetos e memórias. */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, send } = useJarvis();
  const app = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!paletteOpen) {
      setQ('');
      setHits([]);
    }
  }, [paletteOpen]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const id = window.setTimeout(async () => {
      try {
        setHits(await globalSearch(app.toolCtx(), term, 12));
        setSel(0);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, app.version]);

  const navMatches = q ? NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())) : NAV.slice(0, 6);
  type Item = { key: string; go: () => void; hit?: SearchHit; nav?: (typeof NAV)[number] };
  const items: Item[] = [
    ...hits.map((h) => ({ key: h.type + h.id, go: () => void navigate(h.link), hit: h })),
    ...navMatches.map((n) => ({ key: n.to, go: () => void navigate(n.to), nav: n })),
  ];

  const choose = (i: number) => {
    items[i]?.go();
    setPaletteOpen(false);
  };

  return (
    <RDialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-void/70 backdrop-blur-sm" />
        <RDialog.Content className="glass fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl shadow-2xl shadow-black/50">
          <RDialog.Title className="sr-only">Pesquisa global</RDialog.Title>
          <RDialog.Description className="sr-only">Pesquise em notas, tarefas, agenda, projetos e memórias</RDialog.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="h-4.5 w-4.5 text-cyan" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (items.length) choose(sel);
                  else if (q.trim()) { send(q); navigate('/conversar'); setPaletteOpen(false); }
                }
              }}
              placeholder="Pesquisar notas, tarefas, compromissos, projetos…"
              className="h-14 flex-1 bg-transparent text-[15px] focus:outline-none"
              aria-label="Pesquisa global"
            />
            {loading && <span className="label-tech">buscando…</span>}
          </div>
          <ul className="max-h-[55vh] overflow-y-auto scroll-thin p-2" role="listbox">
            {q.trim().length >= 2 && !loading && !hits.length && (
              <li className="px-3 py-6 text-center text-sm text-muted">
                Nada encontrado nos seus registros. <span className="text-cyan">Enter</span> envia como comando ao JARVIS.
              </li>
            )}
            {items.map((it, i) => {
              const Icon = it.hit ? ICON[it.hit.type] : it.nav!.icon;
              return (
                <li key={it.key} role="option" aria-selected={i === sel}>
                  <button onMouseEnter={() => setSel(i)} onClick={() => choose(i)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left cursor-pointer', i === sel ? 'bg-cyan/10' : 'hover:bg-white/[0.03]')}>
                    <Icon className="h-4 w-4 shrink-0 text-cyan" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{it.hit ? it.hit.title : `Ir para ${it.nav!.label}`}</p>
                      {it.hit && (
                        <p className="truncate text-xs text-muted">
                          {LABEL[it.hit.type]}
                          {it.hit.date ? ` · ${formatRelativeDay(it.hit.date, new Date(), app.prefs.timezone)}` : ''}
                          {it.hit.excerpt ? ` · ${it.hit.excerpt}` : ''}
                        </p>
                      )}
                    </div>
                    {i === sel && <CornerDownLeft className="h-3.5 w-3.5 text-muted" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
