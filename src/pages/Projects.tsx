import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, FolderKanban, ArrowLeft, Wand2, Target, CalendarRange, NotebookPen } from 'lucide-react';
import type { Project, ProjectStatus, Priority, Task } from '@/core/types.ts';
import { PRIORITY_LABEL } from '@/core/types.ts';
import { useApp, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { executeCall } from '@/core/agent/agent.ts';
import { DEFAULT_PHASES, completeTaskById } from '@/core/agent/tools.ts';
import { formatWhen } from '@/core/time.ts';
import { Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Segmented, Select, Textarea, Badge, Spinner } from '@/components/ui/index.tsx';
import { PriorityBadge, TaskDialog } from '@/components/forms.tsx';
import { cn } from '@/lib/cn.ts';
import { Link } from 'react-router-dom';

const STATUS: Record<ProjectStatus, string> = { planning: 'Planejamento', active: 'Ativo', paused: 'Pausado', done: 'Concluído', archived: 'Arquivado' };

export default function Projects() {
  const projects = useRows('projects', { isNull: ['deleted_at'], order: [{ field: 'updated_at', asc: false }] });
  const tasks = useRows('tasks', { isNull: ['deleted_at'], notNull: ['project_id'] });
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('id'));
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (params.get('novo') === '1') {
      setCreating(true);
      params.delete('novo');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    if (params.get('id')) {
      setSelected(params.get('id'));
      params.delete('id');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const progress = (p: Project) => {
    const t = (tasks.data ?? []).filter((x) => x.project_id === p.id && x.status !== 'cancelled');
    return { total: t.length, done: t.filter((x) => x.status === 'done').length };
  };

  const current = projects.data?.find((p) => p.id === selected);
  if (current) return <ProjectDetail project={current} onBack={() => setSelected(null)} />;

  return (
    <div>
      <PageHeader title="Projetos e Missões" subtitle="Objetivos maiores, divididos em etapas reais." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Novo projeto</Button>} />
      {projects.isLoading ? <div className="grid place-items-center py-20"><Spinner /></div> : projects.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.data.map((p) => {
            const pr = progress(p);
            const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
            return (
              <Card key={p.id} interactive className="cursor-pointer p-5" onClick={() => setSelected(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                  <Badge tone={p.status === 'active' ? 'cyan' : p.status === 'done' ? 'success' : 'default'}>{STATUS[p.status]}</Badge>
                </div>
                {p.objective && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.objective}</p>}
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-muted"><span>{pr.done}/{pr.total} tarefas</span><span>{pct}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-graphite"><div className="h-full rounded-full bg-gradient-to-r from-tech to-cyan transition-all" style={{ width: `${pct}%` }} /></div>
                </div>
                <div className="mt-3 flex gap-2"><PriorityBadge p={p.priority} />{p.due_date && <Badge>prazo {p.due_date.split('-').reverse().join('/')}</Badge>}</div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><EmptyState icon={<FolderKanban className="h-5 w-5" />} title="Nenhum projeto ainda" text="Diga “Jarvis, crie um projeto chamado Nova Landing Page” ou transforme uma ideia em projeto." action={<Button variant="soft" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Criar projeto</Button>} /></Card>
      )}
      <ProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function ProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (v: boolean) => void; project?: Project }) {
  const app = useApp();
  const { toast } = useJarvis();
  const [f, setF] = useState({ name: '', description: '', objective: '', priority: 'medium' as Priority, due_date: '', status: 'active' as ProjectStatus });
  useEffect(() => {
    if (open) setF({ name: project?.name ?? '', description: project?.description ?? '', objective: project?.objective ?? '', priority: project?.priority ?? 'medium', due_date: project?.due_date ?? '', status: project?.status ?? 'active' });
  }, [open, project]);
  const save = async () => {
    if (!f.name.trim()) return;
    if (project) {
      await app.repo.table('projects').update(project.id, { ...f, description: f.description || null, objective: f.objective || null, due_date: f.due_date || null });
    } else {
      const r = await executeCall(app.toolCtx('manual'), { tool: 'create_project', input: { name: f.name, description: f.description || undefined, objective: f.objective || undefined, priority: f.priority, due_date: f.due_date || undefined } });
      toast({ title: r.message, tone: r.ok ? 'success' : 'error' });
    }
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={project ? 'Editar projeto' : 'Novo projeto'}>
      <div className="space-y-4">
        <Field label="Nome"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Objetivo"><Input value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} placeholder="O que define o sucesso deste projeto?" /></Field>
        <Field label="Descrição"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prioridade"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
          <Field label="Prazo"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        {project && <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>{(Object.keys(STATUS) as ProjectStatus[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</Select></Field>}
        <div className="flex justify-end"><Button onClick={save} disabled={!f.name.trim()}>Salvar</Button></div>
      </div>
    </Dialog>
  );
}

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const app = useApp();
  const { toast } = useJarvis();
  const tz = app.prefs.timezone;
  const tasks = useRows('tasks', { eq: { project_id: project.id }, isNull: ['deleted_at'], order: [{ field: 'position' }] });
  const notes = useRows('notes', { eq: { project_id: project.id }, isNull: ['deleted_at'] });
  const focus = useRows('focus_sessions', { eq: { project_id: project.id } });
  const [view, setView] = useState<'list' | 'board' | 'timeline'>('list');
  const [editing, setEditing] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [phases, setPhases] = useState(DEFAULT_PHASES.join('\n'));

  const list = (tasks.data ?? []).filter((t) => t.status !== 'cancelled');
  const done = list.filter((t) => t.status === 'done').length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  const focusMin = Math.round((focus.data ?? []).reduce((a, s) => a + (s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000 - s.paused_seconds : 0), 0) / 60);
  const byDue = useMemo(() => [...list].sort((a, b) => (a.due_at ?? 'z').localeCompare(b.due_at ?? 'z')), [list]);

  const applyPlan = async () => {
    const items = phases.split('\n').map((s) => s.trim()).filter(Boolean);
    const r = await executeCall(app.toolCtx('manual'), { tool: 'add_project_tasks', input: { project: project.id, tasks: items.map((title) => ({ title })) } }, { bypassConfirm: true });
    toast({ title: r.message, tone: r.ok ? 'success' : 'error' });
    setPlanOpen(false);
  };

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-3"><ArrowLeft className="h-4 w-4" /> Projetos</Button>
      <PageHeader
        title={project.name}
        subtitle={project.objective ?? project.description ?? undefined}
        actions={<>
          <Button variant="outline" onClick={() => setPlanOpen(true)}><Wand2 className="h-4 w-4" /> Organizar em etapas</Button>
          <Button variant="ghost" onClick={() => setEditing(true)}>Editar</Button>
          <Button onClick={() => setNewTask(true)}><Plus className="h-4 w-4" /> Tarefa</Button>
        </>}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="label-tech">Progresso</p><p className="mt-1 font-display text-2xl">{pct}%</p><div className="mt-2 h-1.5 rounded-full bg-graphite"><div className="h-full rounded-full bg-gradient-to-r from-tech to-cyan" style={{ width: `${pct}%` }} /></div></Card>
        <Card className="p-4"><p className="label-tech">Tarefas</p><p className="mt-1 font-display text-2xl">{done}/{list.length}</p></Card>
        <Card className="p-4"><p className="label-tech">Foco dedicado</p><p className="mt-1 font-display text-2xl">{focusMin} min</p></Card>
        <Card className="p-4"><p className="label-tech">Status</p><p className="mt-1 font-display text-xl">{STATUS[project.status]}</p><PriorityBadge p={project.priority} /></Card>
      </div>
      <Segmented className="mb-4" value={view} onChange={setView} options={[{ value: 'list', label: 'Lista' }, { value: 'board', label: 'Quadro' }, { value: 'timeline', label: 'Cronograma' }]} />
      {!list.length ? (
        <Card><EmptyState icon={<Target className="h-5 w-5" />} title="Sem tarefas ainda" text="Use “Organizar em etapas” para gerar a estrutura e aprovar antes de salvar." /></Card>
      ) : view === 'board' ? (
        <div className="grid gap-3 md:grid-cols-3">
          {(['todo', 'in_progress', 'done'] as const).map((s) => (
            <Card key={s} className="p-3">
              <p className="label-tech mb-2">{s === 'todo' ? 'A fazer' : s === 'in_progress' ? 'Em andamento' : 'Concluído'}</p>
              <div className="space-y-2">{list.filter((t) => t.status === s).map((t) => <button key={t.id} onClick={() => setTask(t)} className="block w-full rounded-xl border border-line bg-void/50 p-2.5 text-left text-sm hover:border-cyan/40 cursor-pointer">{t.title}</button>)}</div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="divide-y divide-line">
          {(view === 'timeline' ? byDue : list).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => (t.status === 'done' ? app.repo.table('tasks').update(t.id, { status: 'todo', completed_at: null }) : completeTaskById(app.toolCtx('manual'), t))} className={cn('h-5 w-5 rounded-md border cursor-pointer', t.status === 'done' ? 'border-success bg-success/20' : 'border-cyan/50')} aria-label={`Alternar ${t.title}`} />
              <button onClick={() => setTask(t)} className={cn('flex-1 text-left text-sm cursor-pointer', t.status === 'done' && 'line-through text-muted')}>{t.title}</button>
              {view === 'timeline' && <span className="inline-flex items-center gap-1 text-xs text-muted"><CalendarRange className="h-3 w-3" />{t.due_at ? formatWhen(t.due_at, t.all_day, new Date(), tz) : 'sem prazo'}</span>}
              <PriorityBadge p={t.priority} />
            </div>
          ))}
        </Card>
      )}
      {Boolean(notes.data?.length) && (
        <Card className="mt-5 p-4">
          <p className="label-tech mb-2">Anotações do projeto</p>
          {notes.data!.map((n) => <Link key={n.id} to={`/notas?id=${n.id}`} className="flex items-center gap-2 py-1 text-sm hover:text-cyan"><NotebookPen className="h-3.5 w-3.5" /> {n.title || 'Sem título'}</Link>)}
        </Card>
      )}
      <ProjectDialog open={editing} onOpenChange={setEditing} project={project} />
      <TaskDialog open={newTask} onOpenChange={setNewTask} defaults={{ project_id: project.id }} />
      <TaskDialog open={Boolean(task)} onOpenChange={(v) => !v && setTask(null)} task={task} />
      <Dialog open={planOpen} onOpenChange={setPlanOpen} title="Organizar em etapas" description="Revise as etapas sugeridas (uma por linha). Nada é salvo até você aprovar.">
        <Textarea rows={8} value={phases} onChange={(e) => setPhases(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setPlanOpen(false)}>Cancelar</Button><Button onClick={applyPlan}>Aprovar e criar tarefas</Button></div>
      </Dialog>
    </div>
  );
}
