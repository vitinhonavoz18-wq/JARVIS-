import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Brain, Trash2, Plus, NotebookPen, CheckSquare, CalendarDays, FolderKanban, Download } from 'lucide-react';
import { useApp, useRows } from '@/lib/app.tsx';
import { globalSearch, type SearchHit } from '@/core/agent/tools.ts';
import { formatRelativeDay } from '@/core/time.ts';
import { Button, Card, EmptyState, Input, PageHeader, Select, Switch, Badge, Spinner } from '@/components/ui/index.tsx';

const ICON = { note: NotebookPen, task: CheckSquare, event: CalendarDays, project: FolderKanban, memory: Brain };
const LABEL = { note: 'Nota', task: 'Tarefa', event: 'Compromisso', project: 'Projeto', memory: 'Memória' };
const CATS = ['tratamento', 'horarios', 'comunicacao', 'trabalho', 'projetos', 'notificacoes', 'rotinas', 'geral'];

export default function Knowledge() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const memories = useRows('user_memories', { order: [{ field: 'created_at', asc: false }] });
  const [newMem, setNewMem] = useState('');
  const [newCat, setNewCat] = useState('geral');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits(null);
    setLoading(true);
    const id = window.setTimeout(async () => {
      setHits(await globalSearch(app.toolCtx(), term, 30));
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, app.version]);

  const exportMem = () => {
    const blob = new Blob([JSON.stringify(memories.data ?? [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jarvis-memorias.json';
    a.click();
  };

  return (
    <div>
      <PageHeader title="Central de Conhecimento" subtitle="Pesquisa unificada e a memória que você autorizou o JARVIS a manter." />
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: Connectfly, reunião, vendas…" className="h-12 pl-12 text-base" aria-label="Pesquisar em tudo" autoFocus />
      </div>
      {loading && <div className="grid place-items-center py-6"><Spinner /></div>}
      {hits && !loading && (
        <Card className="mb-8 divide-y divide-line">
          {hits.length ? hits.map((h) => {
            const Icon = ICON[h.type];
            return (
              <Link key={h.type + h.id} to={h.link} className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02]">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{h.title}</p>
                  {h.excerpt && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{h.excerpt}</p>}
                </div>
                <div className="shrink-0 text-right"><Badge>{LABEL[h.type]}</Badge>{h.date && <p className="mt-1 text-[11px] text-muted">{formatRelativeDay(h.date, new Date(), app.prefs.timezone)}</p>}</div>
              </Link>
            );
          }) : <EmptyState icon={<Search className="h-5 w-5" />} title="Nada encontrado" text="Não há registros com esses termos. O JARVIS nunca inventa resultados." />}
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Brain className="h-5 w-5 text-violet" /> Memória pessoal</h2>
            <p className="text-sm text-muted">Somente preferências que você aprovou. Nada sensível é guardado automaticamente.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">Memória {app.prefs.memory_enabled ? 'ativa' : 'desativada'}</span>
            <Switch checked={app.prefs.memory_enabled} onCheckedChange={(v) => app.updatePrefs({ memory_enabled: v })} label="Ativar memória" />
            <Button variant="ghost" size="sm" onClick={exportMem}><Download className="h-4 w-4" /> Exportar</Button>
          </div>
        </div>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <Input value={newMem} onChange={(e) => setNewMem(e.target.value)} placeholder="Ex.: Prefiro reuniões de trabalho pela manhã" aria-label="Nova memória" />
          <Select value={newCat} onChange={(e) => setNewCat(e.target.value)} className="sm:w-44" aria-label="Categoria">{CATS.map((c) => <option key={c}>{c}</option>)}</Select>
          <Button variant="soft" disabled={newMem.trim().length < 3} onClick={async () => { await app.repo.table('user_memories').insert({ category: newCat, content: newMem.trim(), active: true, source: 'manual' }); setNewMem(''); }}><Plus className="h-4 w-4" /> Adicionar</Button>
        </div>
        {memories.data?.length ? (
          <ul className="space-y-2">
            {memories.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                <Switch checked={m.active} onCheckedChange={(v) => app.repo.table('user_memories').update(m.id, { active: v })} label={`Ativar memória: ${m.content}`} />
                <input defaultValue={m.content} onBlur={(e) => e.target.value.trim() !== m.content && e.target.value.trim().length >= 3 && app.repo.table('user_memories').update(m.id, { content: e.target.value.trim() })} className="flex-1 bg-transparent text-sm focus:outline-none" aria-label="Editar memória" />
                <Badge tone="violet">{m.category}</Badge>
                <button onClick={() => app.repo.table('user_memories').remove(m.id)} className="text-muted hover:text-danger cursor-pointer" aria-label="Excluir memória"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Nenhuma memória registrada. Diga: “Jarvis, lembre que prefiro reuniões pela manhã”.</p>}
      </Card>
    </div>
  );
}
