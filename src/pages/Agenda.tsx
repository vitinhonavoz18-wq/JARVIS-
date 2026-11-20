import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, CalendarDays, MapPin, Repeat, Users, Bell } from 'lucide-react';
import type { CalendarEvent, Task } from '@/core/types.ts';
import { useApp, useDerived, useRows } from '@/lib/app.tsx';
import { useNow } from '@/lib/hooks.ts';
import { loadEventsInRange, type EventInstance } from '@/core/agent/insights.ts';
import { addDaysLocal, dayRangeUtc, localDateKey, localDateOf, MONTHS_PT, WEEKDAYS_SHORT_PT, weekdayOfLocal, formatTimeSpoken, formatRelativeDay, zonedParts, toLocalIso, type LocalDate, formatWhen } from '@/core/time.ts';
import { describeRule } from '@/core/agent/recurrence.ts';
import { Button, Card, EmptyState, PageHeader, Segmented, Spinner, Badge } from '@/components/ui/index.tsx';
import { EventDialog, TaskDialog } from '@/components/forms.tsx';
import { cn } from '@/lib/cn.ts';

type View = 'day' | 'week' | 'month' | 'upcoming';

export default function Agenda() {
  const app = useApp();
  const tz = app.prefs.timezone;
  const now = useNow(60_000);
  const today = localDateOf(now, tz);
  const [view, setView] = useState<View>('week');
  const [cursor, setCursor] = useState<LocalDate>(today);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [params, setParams] = useSearchParams();

  const { from, to } = useMemo(() => {
    if (view === 'day') return { from: cursor, to: cursor };
    if (view === 'week') {
      const wd = weekdayOfLocal(cursor);
      const f = addDaysLocal(cursor, -((wd + 6) % 7));
      return { from: f, to: addDaysLocal(f, 6) };
    }
    if (view === 'month') {
      const first = { year: cursor.year, month: cursor.month, day: 1 };
      const f = addDaysLocal(first, -((weekdayOfLocal(first) + 6) % 7));
      return { from: f, to: addDaysLocal(f, 41) };
    }
    return { from: today, to: addDaysLocal(today, 30) };
  }, [view, cursor, today]);

  const events = useDerived(['events', localDateKey(from), localDateKey(to), app.version], (repo) => loadEventsInRange(repo, from, to, tz));
  const tasks = useRows('tasks', { isNull: ['deleted_at'], gte: { due_at: dayRangeUtc(from, tz).start.toISOString() }, lt: { due_at: dayRangeUtc(to, tz).end.toISOString() } });
  const reminders = useRows('reminders', { eq: { status: 'pending' }, gte: { remind_at: now.toISOString() }, order: [{ field: 'remind_at' }], limit: 20 });

  useEffect(() => {
    if (params.get('novo') === '1') {
      setCreating(localDateKey(localDateOf(new Date(), tz)));
      params.delete('novo');
      setParams(params, { replace: true });
    }
  }, [params, setParams, tz]);

  useEffect(() => {
    const id = params.get('id');
    if (!id) return;
    app.repo.table('calendar_events').get(id).then((ev) => {
      if (ev) {
        setCursor(localDateOf(new Date(ev.start_at), tz));
        setEditing(ev);
      }
    });
    params.delete('id');
    setParams(params, { replace: true });
  }, [params, setParams, app.repo, tz]);

  const shift = (dir: number) => {
    if (view === 'day') setCursor(addDaysLocal(cursor, dir));
    else if (view === 'week') setCursor(addDaysLocal(cursor, dir * 7));
    else if (view === 'month') {
      const m = cursor.month + dir;
      setCursor({ year: cursor.year + Math.floor((m - 1) / 12), month: ((m - 1 + 12) % 12) + 1, day: 1 });
    }
  };

  const byDay = (d: LocalDate) => {
    const key = localDateKey(d);
    return {
      events: (events.data ?? []).filter((e) => localDateKey(localDateOf(e.start, tz)) === key || (e.event.all_day && e.start <= dayRangeUtc(d, tz).start && e.end > dayRangeUtc(d, tz).start)),
      tasks: (tasks.data ?? []).filter((t) => t.due_at && localDateKey(localDateOf(new Date(t.due_at), tz)) === key && t.status !== 'cancelled'),
    };
  };

  const title =
    view === 'month' ? `${MONTHS_PT[cursor.month - 1]} ${cursor.year}` :
    view === 'week' ? `${from.day}/${from.month} – ${to.day}/${to.month}` :
    view === 'day' ? formatRelativeDay(dayRangeUtc(cursor, tz).start.toISOString(), now, tz) : 'Próximos 30 dias';

  return (
    <div>
      <PageHeader title="Agenda" subtitle="Seus compromissos, tarefas com horário e lembretes." actions={<Button onClick={() => setCreating(localDateKey(cursor))}><Plus className="h-4 w-4" /> Novo compromisso</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={view} onChange={setView} options={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mês' }, { value: 'upcoming', label: 'Linha do tempo' }]} />
        {view !== 'upcoming' && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(today)}>Hoje</Button>
            <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Próximo"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
        <h2 className="font-display text-lg capitalize">{title}</h2>
      </div>

      {events.isLoading ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : view === 'month' ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d} className="label-tech px-2 py-2 text-center">{WEEKDAYS_SHORT_PT[d]}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => addDaysLocal(from, i)).map((d) => {
              const { events: ev, tasks: tk } = byDay(d);
              const isToday = localDateKey(d) === localDateKey(today);
              return (
                <button key={localDateKey(d)} onClick={() => { setCursor(d); setView('day'); }} className={cn('min-h-[84px] border-b border-r border-line p-1.5 text-left align-top hover:bg-white/[0.03] cursor-pointer', d.month !== cursor.month && 'opacity-40')}>
                  <span className={cn('inline-grid h-6 w-6 place-items-center rounded-full text-xs', isToday && 'bg-cyan text-void font-semibold')}>{d.day}</span>
                  <div className="mt-1 space-y-0.5">
                    {ev.slice(0, 2).map((e) => <p key={e.key} className="truncate rounded bg-cyan/15 px-1 text-[10px] text-cyan">{e.event.title}</p>)}
                    {tk.slice(0, 1).map((t) => <p key={t.id} className="truncate rounded bg-violet/15 px-1 text-[10px] text-violet">{t.title}</p>)}
                    {ev.length + tk.length > 3 && <p className="text-[10px] text-muted">+{ev.length + tk.length - 3}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      ) : view === 'week' ? (
        <div className="grid gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDaysLocal(from, i)).map((d) => {
            const { events: ev, tasks: tk } = byDay(d);
            const isToday = localDateKey(d) === localDateKey(today);
            return (
              <Card key={localDateKey(d)} className={cn('p-3 min-h-[140px]', isToday && 'border-cyan/40')}>
                <button onClick={() => { setCursor(d); setView('day'); }} className="mb-2 flex w-full items-baseline justify-between cursor-pointer">
                  <span className="label-tech">{WEEKDAYS_SHORT_PT[weekdayOfLocal(d)]}</span>
                  <span className={cn('font-display text-lg', isToday && 'text-cyan')}>{d.day}</span>
                </button>
                <div className="space-y-1.5">
                  {ev.map((e) => <EventChip key={e.key} inst={e} tz={tz} onClick={() => setEditing(e.event)} />)}
                  {tk.map((t) => (
                    <button key={t.id} onClick={() => setEditingTask(t)} className={cn('block w-full truncate rounded-lg border border-violet/25 bg-violet/10 px-2 py-1 text-left text-xs cursor-pointer', t.status === 'done' && 'line-through opacity-60')}>
                      {!t.all_day && t.due_at && <span className="font-mono text-[10px] text-violet">{formatTimeSpoken(t.due_at, tz)} </span>}{t.title}
                    </button>
                  ))}
                  {!ev.length && !tk.length && <button onClick={() => setCreating(localDateKey(d))} className="w-full rounded-lg border border-dashed border-line py-2 text-[11px] text-muted hover:text-cyan cursor-pointer">+ adicionar</button>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : view === 'day' ? (
        <DayView day={cursor} data={byDay(cursor)} tz={tz} now={now} onEvent={setEditing} onTask={setEditingTask} onCreate={() => setCreating(localDateKey(cursor))} />
      ) : (
        <Upcoming events={events.data ?? []} tasks={(tasks.data ?? []).filter((t) => t.status !== 'done')} tz={tz} now={now} onEvent={setEditing} onTask={setEditingTask} />
      )}

      {Boolean(reminders.data?.length) && (
        <Card className="mt-6 p-4">
          <p className="label-tech mb-3 flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" /> Próximos lembretes programados</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {reminders.data!.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                <span className="truncate">{r.title}</span>
                <span className="shrink-0 text-xs text-muted">{formatWhen(r.remind_at, false, now, tz)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <EventDialog open={creating !== null} onOpenChange={(v) => !v && setCreating(null)} defaultDate={creating ?? undefined} />
      <EventDialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)} event={editing} />
      <TaskDialog open={Boolean(editingTask)} onOpenChange={(v) => !v && setEditingTask(null)} task={editingTask} />
    </div>
  );
}

function EventChip({ inst, tz, onClick }: { inst: EventInstance; tz: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full rounded-lg border border-cyan/25 bg-cyan/10 px-2 py-1 text-left text-xs hover:border-cyan/50 cursor-pointer">
      <span className="font-mono text-[10px] text-cyan">{inst.event.all_day ? 'dia todo' : formatTimeSpoken(inst.start, tz)}</span>
      <span className="block truncate">{inst.event.title}</span>
    </button>
  );
}

function DayView({ day, data, tz, now, onEvent, onTask, onCreate }: { day: LocalDate; data: { events: EventInstance[]; tasks: Task[] }; tz: string; now: Date; onEvent: (e: CalendarEvent) => void; onTask: (t: Task) => void; onCreate: () => void }) {
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const isToday = localDateKey(day) === localDateKey(localDateOf(now, tz));
  const nowP = zonedParts(now, tz);
  const allDay = data.events.filter((e) => e.event.all_day);
  return (
    <Card className="p-4">
      {allDay.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">{allDay.map((e) => <Badge key={e.key} tone="cyan">{e.event.title} · dia todo</Badge>)}</div>
      )}
      {!data.events.length && !data.tasks.length && (
        <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Dia livre" text="Nenhum compromisso ou tarefa registrado para este dia." action={<Button variant="soft" onClick={onCreate}><Plus className="h-4 w-4" /> Adicionar</Button>} />
      )}
      <div className="relative">
        {hours.map((h) => {
          const evs = data.events.filter((e) => !e.event.all_day && zonedParts(e.start, tz).hour === h);
          const tks = data.tasks.filter((t) => t.due_at && !t.all_day && zonedParts(new Date(t.due_at), tz).hour === h);
          return (
            <div key={h} className="relative flex min-h-[48px] border-t border-line/60">
              <span className="w-14 shrink-0 pt-1 font-mono text-[11px] text-muted">{String(h).padStart(2, '0')}:00</span>
              <div className="flex-1 space-y-1 py-1">
                {evs.map((e) => (
                  <button key={e.key} onClick={() => onEvent(e.event)} className="block w-full rounded-xl border border-cyan/30 bg-cyan/10 px-3 py-2 text-left hover:border-cyan/60 cursor-pointer">
                    <p className="text-sm font-medium">{e.event.title}</p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>{formatTimeSpoken(e.start, tz)}–{formatTimeSpoken(e.end, tz)}</span>
                      {e.event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{e.event.location}</span>}
                      {e.event.participants.length > 0 && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{e.event.participants.join(', ')}</span>}
                      {e.event.recurrence && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{describeRule(e.event.recurrence)}</span>}
                    </p>
                  </button>
                ))}
                {tks.map((t) => (
                  <button key={t.id} onClick={() => onTask(t)} className={cn('block w-full rounded-xl border border-violet/30 bg-violet/10 px-3 py-1.5 text-left text-sm cursor-pointer', t.status === 'done' && 'line-through opacity-60')}>
                    <span className="font-mono text-[11px] text-violet">{formatTimeSpoken(t.due_at!, tz)}</span> {t.title}
                  </button>
                ))}
              </div>
              {isToday && nowP.hour === h && (
                <div className="pointer-events-none absolute left-12 right-0 h-px bg-danger shadow-[0_0_8px_var(--color-danger)]" style={{ top: `${(nowP.minute / 60) * 100}%` }} aria-hidden />
              )}
            </div>
          );
        })}
      </div>
      {data.tasks.some((t) => t.all_day) && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="label-tech mb-2">Tarefas do dia (sem horário)</p>
          {data.tasks.filter((t) => t.all_day).map((t) => <button key={t.id} onClick={() => onTask(t)} className="block text-sm hover:text-cyan cursor-pointer">• {t.title}</button>)}
        </div>
      )}
    </Card>
  );
}

function Upcoming({ events, tasks, tz, now, onEvent, onTask }: { events: EventInstance[]; tasks: Task[]; tz: string; now: Date; onEvent: (e: CalendarEvent) => void; onTask: (t: Task) => void }) {
  const items = [
    ...events.filter((e) => e.end >= now).map((e) => ({ key: e.key, at: e.start, el: <EventChip inst={e} tz={tz} onClick={() => onEvent(e.event)} /> })),
    ...tasks.filter((t) => t.due_at && new Date(t.due_at) >= now).map((t) => ({ key: t.id, at: new Date(t.due_at!), el: <button onClick={() => onTask(t)} className="block w-full rounded-lg border border-violet/25 bg-violet/10 px-2 py-1 text-left text-xs cursor-pointer">{t.all_day ? '' : <span className="font-mono text-[10px] text-violet">{formatTimeSpoken(t.due_at!, tz)} </span>}{t.title}</button> })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!items.length) return <Card><EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nada nos próximos 30 dias" text="Seus próximos compromissos aparecerão aqui." /></Card>;
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const k = toLocalIso(it.at, tz).slice(0, 10);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([k, list]) => (
        <div key={k} className="grid gap-2 md:grid-cols-[160px_1fr]">
          <p className="pt-1 text-sm capitalize text-muted">{formatRelativeDay(list[0].at, now, tz)}</p>
          <div className="space-y-1.5">{list.map((i) => <div key={i.key}>{i.el}</div>)}</div>
        </div>
      ))}
    </div>
  );
}
