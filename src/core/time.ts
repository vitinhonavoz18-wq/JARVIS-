/**
 * Utilitários de data/hora com fuso horário explícito.
 * Tudo que é salvo no banco é UTC (ISO). Tudo que o usuário vê/fala é no fuso dele.
 */
export const DEFAULT_TZ = 'America/Bahia';

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = domingo
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, tz: string = DEFAULT_TZ): ZonedParts {
  const parts = dtf(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WD[get('weekday')] ?? 0,
  };
}

/** Converte um horário "de parede" no fuso tz para um instante UTC. */
export function zonedToUtc(y: number, m: number, d: number, h = 0, min = 0, tz: string = DEFAULT_TZ): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let ts = guess;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(ts), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = asUtc - guess;
    if (diff === 0) break;
    ts -= diff;
  }
  return new Date(ts);
}

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export function localDateOf(date: Date, tz: string = DEFAULT_TZ): LocalDate {
  const p = zonedParts(date, tz);
  return { year: p.year, month: p.month, day: p.day };
}

export function addDaysLocal(ld: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(ld.year, ld.month - 1, ld.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function weekdayOfLocal(ld: LocalDate): number {
  return new Date(Date.UTC(ld.year, ld.month - 1, ld.day)).getUTCDay();
}

export function localDateKey(ld: LocalDate): string {
  return `${ld.year}-${String(ld.month).padStart(2, '0')}-${String(ld.day).padStart(2, '0')}`;
}

export function parseLocalDateKey(key: string): LocalDate {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function dayKey(date: Date | string, tz: string = DEFAULT_TZ): string {
  return localDateKey(localDateOf(new Date(date), tz));
}

/** Início (00:00) e fim (exclusivo, 00:00 do dia seguinte) de um dia local, em UTC. */
export function dayRangeUtc(ld: LocalDate, tz: string = DEFAULT_TZ): { start: Date; end: Date } {
  const next = addDaysLocal(ld, 1);
  return {
    start: zonedToUtc(ld.year, ld.month, ld.day, 0, 0, tz),
    end: zonedToUtc(next.year, next.month, next.day, 0, 0, tz),
  };
}

/** Converte "YYYY-MM-DDTHH:mm" ou "YYYY-MM-DD" (horário local do usuário) para UTC. */
export function localIsoToUtc(local: string, tz: string = DEFAULT_TZ): { date: Date; allDay: boolean } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(local.trim());
  if (!m) throw new Error(`Data inválida: ${local}`);
  // Se veio com fuso explícito (Z ou ±hh:mm), respeitamos o instante absoluto.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(local.trim()) && m[4]) {
    return { date: new Date(local), allDay: false };
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) return { date: zonedToUtc(y, mo, d, 0, 0, tz), allDay: true };
  return { date: zonedToUtc(y, mo, d, Number(m[4]), Number(m[5]), tz), allDay: false };
}

/** Formata um instante UTC como "YYYY-MM-DDTHH:mm" no fuso local. */
export function toLocalIso(date: Date | string, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(new Date(date), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export const WEEKDAYS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "9h", "9h30", "14h05" */
export function formatTimeSpoken(date: Date | string, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(new Date(date), tz);
  return p.minute === 0 ? `${p.hour}h` : `${p.hour}h${String(p.minute).padStart(2, '0')}`;
}

export function formatTime(date: Date | string, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(new Date(date), tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** "hoje", "amanhã", "ontem", "sexta-feira, 21 de novembro" */
export function formatRelativeDay(date: Date | string, now: Date, tz: string = DEFAULT_TZ): string {
  const target = localDateOf(new Date(date), tz);
  const today = localDateOf(now, tz);
  const diff = daysBetween(today, target);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  if (diff === 2) return 'depois de amanhã';
  const wd = WEEKDAYS_PT[weekdayOfLocal(target)];
  const base = `${wd}, ${target.day} de ${MONTHS_PT[target.month - 1]}`;
  return target.year !== today.year ? `${base} de ${target.year}` : base;
}

export function formatWhen(date: Date | string, allDay: boolean, now: Date, tz: string = DEFAULT_TZ): string {
  const day = formatRelativeDay(date, now, tz);
  if (allDay) return day;
  return `${day}, às ${formatTimeSpoken(date, tz)}`;
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

export function greetingFor(now: Date, tz: string = DEFAULT_TZ): string {
  const h = zonedParts(now, tz).hour;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
