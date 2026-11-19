import { useEffect, useState } from 'react';
import { Plus, Trash2, History } from 'lucide-react';
import type { CalendarEvent, Priority, Task } from '@/core/types.ts';
import { PRIORITY_LABEL } from '@/core/types.ts';
import { executeCall } from '@/core/agent/agent.ts';
import { completeTaskById } from '@/core/agent/tools.ts';
import { buildRule, describeRule, parseRule } from '@/core/agent/recurrence.ts';
import { localIsoToUtc, toLocalIso, formatRelativeDay, formatTime } from '@/core/time.ts';
import { useApp, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { Button, Dialog, Field, Input, Select, Textarea, Badge } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function RecurrencePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const rule = parseRule(value);
  const mode = !rule ? 'none' : rule.freq === 'DAILY' ? 'daily' : rule.freq === 'MONTHLY' ? 'monthly' : 'weekly';
  return (
    <div className="space-y-2">
      <Select
        value={mode}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'none' ? null : v === 'daily' ? 'FREQ=DAILY' : v === 'monthly' ? 'FREQ=MONTHLY' : buildRule({ freq: 'WEEKLY', byDay: [1] }));
        }}
        aria-label="Repetição"
      >
        <option value="none">Não repete</option>
        <option value="daily">Todos os dias</option>
        <option value="weekly">Semanal (escolher dias)</option>
        <option value="monthly">Mensal</option>
      </Select>
      {mode === 'weekly' && (
        <div className="flex gap-1.5" role="group" aria-label="Dias da semana">
          {DAY_LABELS.map((d, i) => {
            const on = rule!.byDay.includes(i);
            return (
              <button
                type="button"
                key={i}
                aria-pressed={on}
                aria-label={['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][i]}
                onClick={() => {
                  const days = on ? rule!.byDay.filter((x) => x !== i) : [...rule!.byDay, i];
                  onChange(buildRule({ freq: 'WEEKLY', byDay: days.length ? days : [i] }));
                }}
                className={cn('h-8 w-8 rounded-lg border text-xs cursor-pointer', on ? 'border-cyan/50 bg-cyan/15 text-cyan' : 'border-line text-muted')}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Tarefas ----------------------------- */

export function TaskDialog({ open, onOpenChange, task, defaults }: { open: boolean; onOpenChange: (v: boolean) => void; task?: Task | null; defaults?: { project_id?: string; date?: string } }) {
  const app = useApp();
  const { toast } = useJarvis();
  const tz = app.prefs.timezone;
  const projects = useRows('projects', { isNull: ['deleted_at'], order: [{ field: 'name' }] });
  const subtasks = useRows('task_subtasks', { eq: { task_id: task?.id ?? '' }, order: [{ field: 'position' }] }, Boolean(task));
  const history = useRows('task_history', { eq: { task_id: task?.id ?? '' }, order: [{ field: 'created_at', asc: false }], limit: 20 }, Boolean(task) && app.mode === 'cloud');
  const [f, setF] = useState({ title: '', description: '', date: '', time: '', priority: 'medium' as Priority, category: '', project_id: '', recurrence: null as string | null, remind: '' });
  const [newSub, setNewSub] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const due = task?.due_at ? toLocalIso(task.due_at, tz) : '';
    setF({
      title: task?.title ?? '',
      description: task?.description ?? '',
      date: due ? due.slice(0, 10) : defaults?.date ?? '',
      time: due && !task?.all_day ? due.slice(11) : '',
      priority: task?.priority ?? 'medium',
      category: task?.category ?? '',
      project_id: task?.project_id ?? defaults?.project_id ?? '',
      recurrence: task?.recurrence ?? null,
      remind: '',
    });
  }, [open, task, defaults?.project_id, defaults?.date, tz]);

  const save = async () => {
    if (!f.title.trim()) return;
    setSaving(true);
    try {
      const ctx = app.toolCtx('manual');
      const due = f.date ? (f.time ? `${f.date}T${f.time}` : f.date) : undefined;
      if (!task) {
        const r = await executeCall(ctx, {
          tool: 'create_task',
          input: {
            title: f.title, description: f.description || undefined, due, priority: f.priority, category: f.category || undefined,
            project: f.project_id || undefined, recurrence: f.recurrence ?? undefined,
            remind_minutes_before: f.remind !== '' && f.time ? Number(f.remind) : undefined,
          },
        });
        toast({ title: r.ok ? 'Tarefa criada' : 'Erro', body: r.message, tone: r.ok ? 'success' : 'error' });
        if (r.ok) onOpenChange(false);
      } else {
        const patch: Partial<Task> = {
          title: f.title.trim(), description: f.description || null, priority: f.priority, category: f.category || null,
          project_id: f.project_id || null, recurrence: f.recurrence,
        };
        const nextDue = due ? localIsoToUtc(due, tz) : null;
        patch.due_at = nextDue?.date.toISOString() ?? null;
        patch.all_day = nextDue?.allDay ?? false;
        if (task.due_at && patch.due_at && patch.due_at !== task.due_at) {
          const delta = new Date(patch.due_at).getTime() - new Date(task.due_at).getTime();
          for (const r of await app.repo.table('reminders').list({ eq: { entity_id: task.id, status: 'pending' } })) {
            await app.repo.table('reminders').update(r.id, { remind_at: new Date(new Date(r.remind_at).getTime() + delta).toISOString() });
          }
        }
        await app.repo.table('tasks').update(task.id, patch);
        if (f.remind !== '' && patch.due_at && !patch.all_day) {
          await executeCall(ctx, { tool: 'create_reminder', input: { title: f.title, at: toLocalIso(new Date(new Date(patch.due_at).getTime() - Number(f.remind) * 60000), tz), entity_type: 'task', entity_id: task.id } });
        }
        toast({ title: 'Tarefa atualizada', tone: 'success' });
        onOpenChange(false);
      }
    } catch (e) {
      toast({ title: 'Não foi possível salvar', body: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const addSub = async () => {
    if (!task || !newSub.trim()) return;
    await app.repo.table('task_subtasks').insert({ task_id: task.id, title: newSub.trim(), position: subtasks.data?.length ?? 0, done: false });
    setNewSub('');
  };

  const remove = async () => {
    if (!task || !window.confirm(`Excluir a tarefa “${task.title}”? Ela irá para a lixeira.`)) return;
    await executeCall(app.toolCtx('manual'), { tool: 'delete_task', input: { task_id: task.id } }, { bypassConfirm: true });
    toast({ title: 'Tarefa excluída', tone: 'info' });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={task ? 'Editar tarefa' : 'Nova tarefa'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Título">
            <Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Enviar proposta ao cliente" />
          </Field>
        </div>
        <Field label="Data">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Horário (opcional)">
          <Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
        </Field>
        <Field label="Prioridade">
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Lembrete">
          <Select value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })} disabled={!f.time}>
            <option value="">{f.time ? 'Sem novo lembrete' : 'Defina um horário'}</option>
            <option value="0">Na hora</option>
            <option value="10">10 min antes</option>
            <option value="30">30 min antes</option>
            <option value="60">1 hora antes</option>
            <option value="1440">1 dia antes</option>
          </Select>
        </Field>
        <Field label="Categoria">
          <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Ex.: Trabalho, Pessoal, Saúde" />
        </Field>
        <Field label="Projeto">
          <Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">Nenhum</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Repetição" hint={f.recurrence ? describeRule(f.recurrence) : undefined}>
            <RecurrencePicker value={f.recurrence} onChange={(v) => setF({ ...f, recurrence: v })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Descrição">
            <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
      </div>

      {task && (
        <div className="mt-5">
          <p className="label-tech mb-2">Subtarefas</p>
          <ul className="space-y-1.5">
            {subtasks.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.done} onChange={() => app.repo.table('task_subtasks').update(s.id, { done: !s.done })} className="h-4 w-4 accent-cyan-400" aria-label={s.title} />
                <span className={cn('flex-1', s.done && 'line-through text-muted')}>{s.title}</span>
                <button onClick={() => app.repo.table('task_subtasks').remove(s.id)} className="text-muted hover:text-danger cursor-pointer" aria-label="Remover subtarefa">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder="Adicionar subtarefa" />
            <Button variant="soft" size="icon" onClick={addSub} aria-label="Adicionar subtarefa"><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {task && app.mode === 'cloud' && Boolean(history.data?.length) && (
        <details className="mt-5">
          <summary className="label-tech cursor-pointer flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Histórico de modificações</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {history.data!.map((h) => (
              <li key={h.id}>
                {formatRelativeDay(h.created_at, new Date(), tz)} {formatTime(h.created_at, tz)} — alterou {Object.keys(h.changes).join(', ')}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        {task ? (
          <Button variant="danger" onClick={remove}><Trash2 className="h-4 w-4" /> Excluir</Button>
        ) : <span />}
        <div className="flex gap-2">
          {task && task.status !== 'done' && (
            <Button variant="outline" onClick={async () => { const r = await completeTaskById(app.toolCtx('manual'), task); toast({ title: r.message, tone: 'success' }); onOpenChange(false); }}>
              Concluir
            </Button>
          )}
          <Button onClick={save} loading={saving} disabled={!f.title.trim()}>Salvar</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function PriorityBadge({ p }: { p: Priority }) {
  if (p === 'medium') return null;
  return <Badge tone={p === 'urgent' ? 'danger' : p === 'high' ? 'warn' : 'default'}>{PRIORITY_LABEL[p]}</Badge>;
}

/* ---------------------------- Compromissos ---------------------------- */

export function EventDialog({ open, onOpenChange, event, defaultDate }: { open: boolean; onOpenChange: (v: boolean) => void; event?: CalendarEvent | null; defaultDate?: string }) {
  const app = useApp();
  const { toast } = useJarvis();
  const tz = app.prefs.timezone;
  const [f, setF] = useState({ title: '', date: '', start: '09:00', end: '10:00', allDay: false, location: '', participants: '', description: '', recurrence: null as string | null, remind: '15' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (event) {
      const s = toLocalIso(event.start_at, tz);
      const e = toLocalIso(event.end_at, tz);
      setF({ title: event.title, date: s.slice(0, 10), start: s.slice(11), end: e.slice(11), allDay: event.all_day, location: event.location ?? '', participants: event.participants.join(', '), description: event.description ?? '', recurrence: event.recurrence, remind: '' });
    } else {
      setF({ title: '', date: defaultDate ?? toLocalIso(new Date(), tz).slice(0, 10), start: '09:00', end: '10:00', allDay: false, location: '', participants: '', description: '', recurrence: null, remind: String(app.prefs.default_reminder_minutes) });
    }
  }, [open, event, defaultDate, tz, app.prefs.default_reminder_minutes]);

  const save = async () => {
    if (!f.title.trim() || !f.date) return;
    setSaving(true);
    try {
      const participants = f.participants.split(',').map((x) => x.trim()).filter(Boolean);
      if (!event) {
        const r = await executeCall(app.toolCtx('manual'), {
          tool: 'create_event',
          input: {
            title: f.title, start: f.allDay ? f.date : `${f.date}T${f.start}`, end: f.allDay ? undefined : `${f.date}T${f.end}`, all_day: f.allDay,
            location: f.location || undefined, participants, description: f.description || undefined, recurrence: f.recurrence ?? undefined,
            remind_minutes_before: f.remind !== '' && !f.allDay ? Number(f.remind) : undefined,
          },
        });
        toast({ title: r.ok ? 'Compromisso salvo' : 'Erro', body: r.message, tone: r.ok ? 'success' : 'error' });
        if (r.ok) onOpenChange(false);
      } else {
        const start = localIsoToUtc(f.allDay ? f.date : `${f.date}T${f.start}`, tz).date;
        const end = f.allDay ? new Date(start.getTime() + 86400000) : localIsoToUtc(`${f.date}T${f.end}`, tz).date;
        if (end <= start) throw new Error('O término precisa ser depois do início.');
        const delta = start.getTime() - new Date(event.start_at).getTime();
        if (delta) {
          for (const r of await app.repo.table('reminders').list({ eq: { entity_id: event.id, status: 'pending' } })) {
            await app.repo.table('reminders').update(r.id, { remind_at: new Date(new Date(r.remind_at).getTime() + delta).toISOString() });
          }
        }
        await app.repo.table('calendar_events').update(event.id, {
          title: f.title.trim(), start_at: start.toISOString(), end_at: end.toISOString(), all_day: f.allDay, location: f.location || null,
          participants, description: f.description || null, recurrence: f.recurrence,
        });
        toast({ title: 'Compromisso atualizado', tone: 'success' });
        onOpenChange(false);
      }
    } catch (e) {
      toast({ title: 'Não foi possível salvar', body: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!event || !window.confirm(`Remover “${event.title}” da agenda?`)) return;
    await executeCall(app.toolCtx('manual'), { tool: 'delete_event', input: { event_id: event.id } }, { bypassConfirm: true });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={event ? 'Editar compromisso' : 'Novo compromisso'} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Título"><Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Reunião com a equipe" /></Field>
        </div>
        <Field label="Data"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-muted">
          <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} className="h-4 w-4 accent-cyan-400" /> Dia inteiro
        </label>
        {!f.allDay && (
          <>
            <Field label="Início"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field label="Término"><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          </>
        )}
        <Field label="Local ou link"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Participantes (separados por vírgula)"><Input value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} /></Field>
        <Field label="Lembrete">
          <Select value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })} disabled={f.allDay}>
            <option value="">{event ? 'Manter lembretes atuais' : 'Sem lembrete'}</option>
            <option value="0">Na hora</option>
            <option value="10">10 min antes</option>
            <option value="15">15 min antes</option>
            <option value="30">30 min antes</option>
            <option value="60">1 hora antes</option>
            <option value="1440">1 dia antes</option>
          </Select>
        </Field>
        <Field label="Repetição"><RecurrencePicker value={f.recurrence} onChange={(v) => setF({ ...f, recurrence: v })} /></Field>
        <div className="sm:col-span-2"><Field label="Descrição"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      </div>
      <div className="mt-6 flex items-center justify-between">
        {event ? <Button variant="danger" onClick={remove}><Trash2 className="h-4 w-4" /> Remover</Button> : <span />}
        <Button onClick={save} loading={saving} disabled={!f.title.trim()}>Salvar</Button>
      </div>
    </Dialog>
  );
}
