import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Pause, Play, CheckCircle2, Target, X } from 'lucide-react';
import { useApp, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useNow } from '@/lib/hooks.ts';
import { executeCall } from '@/core/agent/agent.ts';
import { focusSeconds } from '@/core/agent/insights.ts';
import { formatRelativeDay, formatDuration } from '@/core/time.ts';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';

export default function Focus() {
  const app = useApp();
  const { toast } = useJarvis();
  const now = useNow(1000);
  const active = useRows('focus_sessions', { in: { status: ['active', 'paused'] }, limit: 1 });
  const history = useRows('focus_sessions', { in: { status: ['completed', 'cancelled'] }, order: [{ field: 'started_at', asc: false }], limit: 12 });
  const projects = useRows('projects', { isNull: ['deleted_at'], eq: { status: 'active' } });
  const openTasks = useRows('tasks', { isNull: ['deleted_at'], in: { status: ['todo', 'in_progress'] }, order: [{ field: 'due_at' }], limit: 50 });
  const s = active.data?.[0];
  const subtasks = useRows('task_subtasks', { eq: { task_id: s?.task_id ?? '' }, order: [{ field: 'position' }] }, Boolean(s?.task_id));
  const [minutes, setMinutes] = useState(45);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const notified = useRef<string | null>(null);

  const elapsed = s ? focusSeconds(s, now) : 0;
  const total = (s?.planned_minutes ?? minutes) * 60;
  const remaining = Math.max(0, total - elapsed);
  const pct = s ? Math.min(1, elapsed / total) : 0;

  useEffect(() => {
    if (s && remaining === 0 && s.status === 'active' && notified.current !== s.id) {
      notified.current = s.id;
      toast({ title: 'Missão cumprida', body: `Você completou ${formatDuration(s.planned_minutes)} de foco.`, tone: 'reminder' });
    }
  }, [s, remaining, toast]);

  const start = async () => {
    const r = await executeCall(app.toolCtx('manual'), { tool: 'start_focus_session', input: { minutes, title: title || undefined, project: project || undefined, task: task || undefined } });
    if (!r.ok) toast({ title: 'Erro', body: r.message, tone: 'error' });
  };
  const pause = () => s && app.repo.table('focus_sessions').update(s.id, s.status === 'paused'
    ? { status: 'active', paused_at: null, paused_seconds: s.paused_seconds + Math.round((Date.now() - new Date(s.paused_at!).getTime()) / 1000) }
    : { status: 'paused', paused_at: new Date().toISOString() });
  const stop = async (status: 'completed' | 'cancelled') => {
    const r = await executeCall(app.toolCtx('manual'), { tool: 'stop_focus_session', input: { status } });
    toast({ title: r.message, tone: 'success' });
  };

  if (s) {
    const r = 140;
    const c = 2 * Math.PI * r;
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    return (
      <div className="fixed inset-0 z-[45] flex flex-col items-center justify-center bg-void/95 px-4 backdrop-blur-xl">
        <p className="label-tech">Mission Mode · {s.status === 'paused' ? 'pausado' : 'em foco'}</p>
        <h1 className="mt-2 max-w-xl text-center font-display text-2xl md:text-3xl font-semibold">{s.title}</h1>
        <motion.div className="relative my-8" animate={{ scale: s.status === 'paused' ? 0.97 : 1 }}>
          <svg width="320" height="320" viewBox="0 0 320 320" className="max-w-[80vw] h-auto" role="img" aria-label={`Restam ${mm} minutos e ${ss} segundos`}>
            <circle cx="160" cy="160" r={r} fill="none" stroke="rgb(120 160 255 / 0.1)" strokeWidth="6" />
            <circle cx="160" cy="160" r={r} fill="none" stroke="url(#fg)" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 160 160)" style={{ transition: 'stroke-dashoffset 1s linear', filter: 'drop-shadow(0 0 12px rgb(0 217 255 / .6))' }} />
            <defs><linearGradient id="fg" x1="0" x2="1"><stop offset="0" stopColor="#7467FF" /><stop offset="1" stopColor="#00D9FF" /></linearGradient></defs>
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className={cn('font-mono text-6xl tabular-nums', s.status === 'paused' && 'animate-pulse-soft')}>{mm}:{ss}</p>
              <p className="mt-1 text-sm text-muted">de {formatDuration(s.planned_minutes)}</p>
            </div>
          </div>
        </motion.div>
        {Boolean(subtasks.data?.length) && (
          <ul className="mb-6 w-full max-w-sm space-y-1.5">
            {subtasks.data!.map((st) => (
              <li key={st.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={st.done} onChange={() => app.repo.table('task_subtasks').update(st.id, { done: !st.done })} className="h-4 w-4 accent-cyan-400" />
                  <span className={cn(st.done && 'line-through text-muted')}>{st.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={pause}>{s.status === 'paused' ? <><Play className="h-4 w-4" /> Retomar</> : <><Pause className="h-4 w-4" /> Pausar</>}</Button>
          <Button onClick={() => stop('completed')}><CheckCircle2 className="h-4 w-4" /> Concluir sessão</Button>
          <Button variant="ghost" onClick={() => window.confirm('Cancelar esta sessão? O tempo não será contabilizado como concluído.') && stop('cancelled')}><X className="h-4 w-4" /> Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Mission Mode" subtitle="Uma tarefa por vez, sem distrações. O tempo de foco fica registrado." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card className="p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Missão"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="No que você vai focar?" /></Field></div>
            <Field label="Tarefa (opcional)">
              <Select value={task} onChange={(e) => setTask(e.target.value)}>
                <option value="">Nenhuma</option>
                {openTasks.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            </Field>
            <Field label="Projeto (opcional)">
              <Select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">Nenhum</option>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
          <p className="label-tech mt-6 mb-2">Duração</p>
          <div className="flex flex-wrap gap-2">
            {[15, 25, 45, 60, 90].map((m) => (
              <button key={m} onClick={() => setMinutes(m)} className={cn('rounded-xl border px-4 py-2 text-sm cursor-pointer', minutes === m ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-line text-muted hover:text-ink')}>{m} min</button>
            ))}
            <Input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(600, Number(e.target.value) || 1)))} className="w-24" aria-label="Minutos personalizados" />
          </div>
          <Button className="mt-6 w-full sm:w-auto" onClick={start}><Target className="h-4 w-4" /> Iniciar missão</Button>
          <p className="mt-3 text-xs text-muted">Também por voz: “Jarvis, iniciar modo foco por 45 minutos no projeto Connectfly”.</p>
        </Card>
        <Card className="p-5">
          <p className="label-tech mb-3">Sessões recentes</p>
          {history.data?.length ? (
            <ul className="space-y-2">
              {history.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{h.title}</span>
                  <span className={cn('shrink-0 text-xs', h.status === 'completed' ? 'text-success' : 'text-muted')}>
                    {formatDuration(Math.round(focusSeconds(h, now) / 60))} · {formatRelativeDay(h.started_at, now, app.prefs.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Nenhuma sessão registrada ainda.</p>}
        </Card>
      </div>
    </div>
  );
}
