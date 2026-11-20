import type { Repo } from '../data/repo.ts';
import type { CalendarEvent, FocusSession, Routine, RoutineLog, Task } from '../types.ts';
import { PRIORITY_WEIGHT } from '../types.ts';
import {
  addDaysLocal, dayRangeUtc, localDateKey, localDateOf, parseLocalDateKey, weekdayOfLocal, zonedParts, zonedToUtc,
  type LocalDate,
} from '../time.ts';
import { expandOccurrences } from './recurrence.ts';

export interface EventInstance {
  event: CalendarEvent;
  start: Date;
  end: Date;
  key: string;
}

/** Expande eventos (inclusive recorrentes) dentro de um intervalo de dias locais. */
export function eventInstances(events: CalendarEvent[], from: LocalDate, to: LocalDate, tz: string): EventInstance[] {
  const out: EventInstance[] = [];
  const rangeStart = dayRangeUtc(from, tz).start.getTime();
  const rangeEnd = dayRangeUtc(to, tz).end.getTime();
  for (const ev of events) {
    if (ev.deleted_at) continue;
    const s = new Date(ev.start_at);
    const e = new Date(ev.end_at);
    if (!ev.recurrence) {
      if (s.getTime() < rangeEnd && e.getTime() > rangeStart - (s.getTime() === e.getTime() ? 1 : 0)) {
        out.push({ event: ev, start: s, end: e, key: ev.id });
      }
      continue;
    }
    const anchor = localDateOf(s, tz);
    const p = zonedParts(s, tz);
    const dur = e.getTime() - s.getTime();
    for (const d of expandOccurrences(ev.recurrence, anchor, from, to, ev.recurrence_exdates ?? [])) {
      const st = zonedToUtc(d.year, d.month, d.day, p.hour, p.minute, tz);
      out.push({ event: ev, start: st, end: new Date(st.getTime() + dur), key: `${ev.id}:${localDateKey(d)}` });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function loadEventsInRange(repo: Repo, from: LocalDate, to: LocalDate, tz: string): Promise<EventInstance[]> {
  const { start } = dayRangeUtc(from, tz);
  const { end } = dayRangeUtc(to, tz);
  const t = repo.table('calendar_events');
  const [single, recurring] = await Promise.all([
    t.list({ lt: { start_at: end.toISOString() }, gte: { end_at: start.toISOString() }, isNull: ['deleted_at', 'recurrence'] }),
    t.list({ notNull: ['recurrence'], isNull: ['deleted_at'], lt: { start_at: end.toISOString() } }),
  ]);
  return eventInstances([...single, ...recurring], from, to, tz);
}

export function sortTasksSmart(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority];
    const pb = PRIORITY_WEIGHT[b.priority];
    if (pa !== pb) return pb - pa;
    if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
    if (a.due_at) return -1;
    if (b.due_at) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export async function tasksForDay(repo: Repo, day: LocalDate, tz: string): Promise<Task[]> {
  const { start, end } = dayRangeUtc(day, tz);
  return repo.table('tasks').list({
    gte: { due_at: start.toISOString() },
    lt: { due_at: end.toISOString() },
    isNull: ['deleted_at'],
    order: [{ field: 'due_at', asc: true }],
  });
}

export async function overdueTasks(repo: Repo, now: Date, tz: string): Promise<Task[]> {
  const { start } = dayRangeUtc(localDateOf(now, tz), tz);
  const rows = await repo.table('tasks').list({
    lt: { due_at: start.toISOString() },
    in: { status: ['todo', 'in_progress'] },
    isNull: ['deleted_at'],
    order: [{ field: 'due_at', asc: true }],
  });
  return rows;
}

export interface RoutineProgress {
  routine: Routine;
  planned: number;
  done: number;
  doneToday: boolean;
  scheduledToday: boolean;
}

export function weekBounds(day: LocalDate): { from: LocalDate; to: LocalDate } {
  // Semana de segunda a domingo.
  const wd = weekdayOfLocal(day);
  const from = addDaysLocal(day, -((wd + 6) % 7));
  return { from, to: addDaysLocal(from, 6) };
}

export async function routineProgress(repo: Repo, day: LocalDate): Promise<RoutineProgress[]> {
  const routines = (await repo.table('routines').list({ eq: { active: true } })) as Routine[];
  if (!routines.length) return [];
  const { from, to } = weekBounds(day);
  const logs = (await repo.table('routine_logs').list({
    gte: { date: localDateKey(from) },
    lte: { date: localDateKey(to) },
  })) as RoutineLog[];
  const todayKey = localDateKey(day);
  const wd = weekdayOfLocal(day);
  return routines.map((r) => {
    const mine = logs.filter((l) => l.routine_id === r.id);
    return {
      routine: r,
      planned: r.days.length || r.target_per_week,
      done: new Set(mine.map((l) => l.date)).size,
      doneToday: mine.some((l) => l.date === todayKey),
      scheduledToday: r.days.includes(wd),
    };
  });
}

export function focusSeconds(s: FocusSession, now: Date): number {
  const end = s.ended_at ? new Date(s.ended_at) : s.paused_at ? new Date(s.paused_at) : now;
  return Math.max(0, Math.round((end.getTime() - new Date(s.started_at).getTime()) / 1000) - (s.paused_seconds ?? 0));
}

export async function focusMinutesInRange(repo: Repo, from: LocalDate, to: LocalDate, tz: string, now: Date): Promise<number> {
  const rows = await repo.table('focus_sessions').list({
    gte: { started_at: dayRangeUtc(from, tz).start.toISOString() },
    lt: { started_at: dayRangeUtc(to, tz).end.toISOString() },
  });
  return Math.round(rows.filter((s) => s.status !== 'cancelled').reduce((acc, s) => acc + focusSeconds(s, now), 0) / 60);
}

export interface DaySnapshot {
  date: string;
  events: EventInstance[];
  tasks: Task[];
  pendingTasks: Task[];
  doneTasks: Task[];
  overdue: Task[];
  routines: RoutineProgress[];
  focusMinutes: number;
  freeSlots: { start: Date; end: Date }[];
}

/** Calcula horários livres entre 08h e 20h, descontando eventos. */
export function computeFreeSlots(day: LocalDate, events: EventInstance[], tz: string, now: Date): { start: Date; end: Date }[] {
  const dayStart = zonedToUtc(day.year, day.month, day.day, 8, 0, tz).getTime();
  const dayEnd = zonedToUtc(day.year, day.month, day.day, 20, 0, tz).getTime();
  let cursor = Math.max(dayStart, now.getTime());
  const slots: { start: Date; end: Date }[] = [];
  const busy = events.filter((e) => !e.event.all_day).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const b of busy) {
    const bs = b.start.getTime();
    const be = b.end.getTime();
    const slotEnd = Math.min(bs, dayEnd);
    if (slotEnd - cursor >= 30 * 60000) slots.push({ start: new Date(cursor), end: new Date(slotEnd) });
    cursor = Math.max(cursor, be);
    if (cursor >= dayEnd) break;
  }
  if (dayEnd - cursor >= 30 * 60000) slots.push({ start: new Date(cursor), end: new Date(dayEnd) });
  return slots.filter((s) => s.end > s.start);
}

export async function daySnapshot(repo: Repo, dateKey: string, tz: string, now: Date): Promise<DaySnapshot> {
  const day = parseLocalDateKey(dateKey);
  const [events, tasks, overdue, routines, focusMinutes] = await Promise.all([
    loadEventsInRange(repo, day, day, tz),
    tasksForDay(repo, day, tz),
    localDateKey(localDateOf(now, tz)) === dateKey ? overdueTasks(repo, now, tz) : Promise.resolve([] as Task[]),
    routineProgress(repo, day),
    focusMinutesInRange(repo, day, day, tz, now),
  ]);
  const live = tasks.filter((t) => t.status !== 'cancelled');
  return {
    date: dateKey,
    events,
    tasks: live,
    pendingTasks: sortTasksSmart(live.filter((t) => t.status !== 'done')),
    doneTasks: live.filter((t) => t.status === 'done'),
    overdue,
    routines,
    focusMinutes,
    freeSlots: computeFreeSlots(day, events, tz, now),
  };
}
