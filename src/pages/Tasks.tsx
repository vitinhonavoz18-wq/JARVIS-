import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, CheckSquare, Search, Repeat, FolderKanban, GripVertical } from 'lucide-react';
import type { Task, TaskStatus } from '@/core/types.ts';
import { PRIORITY_WEIGHT } from '@/core/types.ts';
import { useApp, useRows } from '@/lib/app.tsx';
import { useNow } from '@/lib/hooks.ts';
import { completeTaskById } from '@/core/agent/tools.ts';
import { sortTasksSmart } from '@/core/agent/insights.ts';
import { addDaysLocal, dayRangeUtc, formatWhen, localDateOf } from '@/core/time.ts';
import { describeRule } from '@/core/agent/recurrence.ts';
import { Button, Card, EmptyState, Input, PageHeader, Segmented, Select, Spinner, Badge } from '@/components/ui/index.tsx';
import { PriorityBadge, TaskDialog } from '@/components/forms.tsx';
import { cn } from '@/lib/cn.ts';

type View = 'today' | 'tomorrow' | 'week' | 'pending' | 'overdue' | 'done' | 'kanban' | 'priority';
const VIEWS: { value: View; label: string }[] = [
  { value: 'today', label: 'Hoje' }, { value: 'tomorrow', label: 'Amanhã' }, { value: 'week', label: 'Semana' },
  { value: 'pending', label: 'Pendentes' }, { value: 'overdue', label: 'Atrasadas' }, { value: 'done', label: 'Concluídas' },
  { value: 'kanban', label: 'Kanban' }, { value: 'priority', label: 'Prioridades' },
];

export default function Tasks() {
  const app = useApp();
  const tz = app.prefs.timezone;
  const now = useNow(60_000);
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>((params.get('view') as View) || 'today');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [projectId, setProjectId] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const all = useRows('tasks', { isNull: ['deleted_at'], order: [{ field: 'due_at' }] });
  const projects = useRows('projects', { isNull: ['deleted_at'] });

  useEffect(() => {
    if (params.get('novo') === '1') {
      setCreating(true);
      params.delete('novo');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    const id = params.get('id');
    if (id && all.data) {
      const t = all.data.find((x) => x.id === id);
      if (t) setEditing(t);
      params.delete('id');
      setParams(params, { replace: true });
    }
  }, [params, all.data, setParams]);

  const categories = useMemo(() => [...new Set((all.data ?? []).map((t) => t.category).filter(Boolean))] as string[], [all.data]);

  const filtered = useMemo(() => {
    const today = localDateOf(now, tz);
    const range = (from: number, to: number) => ({ start: dayRangeUtc(addDaysLocal(today, from), tz).start, end: dayRangeUtc(addDaysLocal(today, to), tz).end });
    let rows = (all.data ?? []).filter((t) => t.status !== 'cancelled');
    if (q) rows = rows.filter((t) => `${t.title} ${t.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
    if (category) rows = rows.filter((t) => t.category === category);
    if (projectId) rows = rows.filter((t) => t.project_id === projectId);
    const inR = (t: Task, r: { start: Date; end: Date }) => t.due_at && new Date(t.due_at) >= r.start && new Date(t.due_at) < r.end;
    switch (view) {
      case 'today': return rows.filter((t) => inR(t, range(0, 0)));
      case 'tomorrow': return rows.filter((t) => inR(t, range(1, 1)));
      case 'week': return rows.filter((t) => inR(t, range(0, 6)));
      case 'pending': return sortTasksSmart(rows.filter((t) => t.status !== 'done'));
      case 'overdue': return rows.filter((t) => t.status !== 'done' && t.due_at && new Date(t.due_at) < range(0, 0).start);
      case 'done': return rows.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
      case 'priority': return rows.filter((t) => t.status !== 'done').sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || (a.due_at ?? 'z').localeCompare(b.due_at ?? 'z'));
      default: return rows;
    }
  }, [all.data, view, q, category, projectId, now, tz]);

  const projectName = (id: string | null) => projects.data?.find((p) => p.id === id)?.name;

  return (
    <div>
      <PageHeader title="Tarefas" subtitle="Organize, priorize e conclua — por aqui ou por voz." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova tarefa</Button>} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented value={view} onChange={(v) => setView(v)} options={VIEWS} />
        <div className="flex flex-1 flex-wrap gap-2 lg:justify-end">
          <div className="relative min-w-[180px] flex-1 lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar tarefas" className="pl-9" aria-label="Filtrar tarefas" />
          </div>
          {categories.length > 0 && (
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Categoria">
              <option value="">Todas as categorias</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
          {Boolean(projects.data?.length) && (
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-auto" aria-label="Projeto">
              <option value="">Todos os projetos</option>
              {projects.data!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </div>
      </div>

      {all.isLoading ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : view === 'kanban' ? (
        <Kanban tasks={(all.data ?? []).filter((t) => t.status !== 'cancelled' && (!projectId || t.project_id === projectId) && (!q || t.title.toLowerCase().includes(q.toLowerCase())))} onOpen={setEditing} />
      ) : filtered.length ? (
        <Card className="divide-y divide-line">
          {filtered.map((t) => (
            <TaskRow key={t.id} task={t} tz={tz} now={now} project={projectName(t.project_id)} onOpen={() => setEditing(t)} />
          ))}
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<CheckSquare className="h-5 w-5" />}
            title={view === 'done' ? 'Nada concluído ainda' : 'Nenhuma tarefa aqui'}
            text={view === 'today' ? 'Diga “Jarvis, academia amanhã às 9” ou crie uma tarefa.' : 'Ajuste a visão ou os filtros para ver outras tarefas.'}
            action={<Button variant="soft" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Criar tarefa</Button>}
          />
        </Card>
      )}

      <TaskDialog open={creating} onOpenChange={setCreating} />
      <TaskDialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)} task={editing} />
    </div>
  );
}

function TaskRow({ task, tz, now, project, onOpen }: { task: Task; tz: string; now: Date; project?: string; onOpen: () => void }) {
  const app = useApp();
  const overdue = task.status !== 'done' && task.due_at && new Date(task.due_at) < now;
  return (
    <div className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]">
      <button
        onClick={() => (task.status === 'done' ? app.repo.table('tasks').update(task.id, { status: 'todo', completed_at: null }) : completeTaskById(app.toolCtx('manual'), task))}
        className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md border transition cursor-pointer', task.status === 'done' ? 'border-success bg-success/20 text-success' : 'border-cyan/50 hover:bg-cyan/15')}
        aria-label={task.status === 'done' ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
      >
        {task.status === 'done' && <span className="text-xs">✓</span>}
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left cursor-pointer">
        <p className={cn('truncate text-sm', task.status === 'done' && 'line-through text-muted')}>{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {task.due_at && <span className={cn(overdue && 'text-warn')}>{formatWhen(task.due_at, task.all_day, now, tz)}</span>}
          {task.recurrence && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{describeRule(task.recurrence)}</span>}
          {project && <span className="inline-flex items-center gap-1"><FolderKanban className="h-3 w-3" />{project}</span>}
          {task.category && <span>#{task.category}</span>}
          {task.status === 'in_progress' && <Badge tone="cyan">em andamento</Badge>}
        </div>
      </button>
      <PriorityBadge p={task.priority} />
    </div>
  );
}

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'A fazer' },
  { status: 'in_progress', label: 'Em andamento' },
  { status: 'done', label: 'Concluído' },
];

function Kanban({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const app = useApp();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const move = async (id: string, status: TaskStatus) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    if (status === 'done') await completeTaskById(app.toolCtx('manual'), t);
    else await app.repo.table('tasks').update(id, { status, completed_at: null });
  };
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map((c) => {
        const items = sortTasksSmart(tasks.filter((t) => t.status === c.status)).slice(0, c.status === 'done' ? 30 : 200);
        return (
          <div
            key={c.status}
            onDragOver={(e) => { e.preventDefault(); setOver(c.status); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData('text/plain'), c.status); }}
            className={cn('glass rounded-2xl p-3 min-h-[200px] transition', over === c.status && 'border-cyan/60 bg-cyan/5')}
            aria-label={`Coluna ${c.label}`}
          >
            <p className="label-tech mb-3 flex justify-between px-1">{c.label}<span>{items.length}</span></p>
            <div className="space-y-2">
              {items.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                  className="group flex items-start gap-2 rounded-xl border border-line bg-void/50 p-3 text-sm hover:border-cyan/40 cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted/50" />
                  <button onClick={() => onOpen(t)} className="flex-1 text-left cursor-pointer">
                    <p className={cn(t.status === 'done' && 'line-through text-muted')}>{t.title}</p>
                    <div className="mt-1.5 flex items-center gap-2"><PriorityBadge p={t.priority} /></div>
                  </button>
                  {/* Alternativa acessível ao arrastar */}
                  <select
                    value={t.status}
                    onChange={(e) => move(t.id, e.target.value as TaskStatus)}
                    className="bg-transparent text-[11px] text-muted opacity-60 group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Mover ${t.title}`}
                  >
                    {COLUMNS.map((x) => <option key={x.status} value={x.status}>{x.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
