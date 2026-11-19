import { addDaysLocal, daysBetween, weekdayOfLocal, type LocalDate } from '../time.ts';

/** RRULE simplificada (subconjunto do RFC 5545): FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY, UNTIL. */
export interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  byDay: number[]; // 0=dom
  until?: string; // YYYY-MM-DD
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function parseRule(rule: string | null | undefined): Rule | null {
  if (!rule) return null;
  const parts = Object.fromEntries(
    rule.replace(/^RRULE:/, '').split(';').map((p) => {
      const [k, v] = p.split('=');
      return [k.toUpperCase(), v];
    }),
  );
  const freq = parts.FREQ as Rule['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) return null;
  const byDay = parts.BYDAY ? parts.BYDAY.split(',').map((c: string) => DAY_CODES.indexOf(c)).filter((n: number) => n >= 0) : [];
  const u = parts.UNTIL?.replace(/-/g, '');
  const until = u ? `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}` : undefined;
  return { freq, interval: Math.max(1, Number(parts.INTERVAL ?? 1)), byDay: byDay.sort(), until };
}

export function buildRule(r: Partial<Rule> & { freq: Rule['freq'] }): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval && r.interval > 1) out.push(`INTERVAL=${r.interval}`);
  if (r.byDay?.length) out.push(`BYDAY=${[...r.byDay].sort().map((d) => DAY_CODES[d]).join(',')}`);
  if (r.until) out.push(`UNTIL=${r.until.replace(/-/g, '')}`);
  return out.join(';');
}

function key(ld: LocalDate) {
  return `${ld.year}-${String(ld.month).padStart(2, '0')}-${String(ld.day).padStart(2, '0')}`;
}

function occursOn(rule: Rule, anchor: LocalDate, d: LocalDate): boolean {
  const diff = daysBetween(anchor, d);
  if (diff < 0) return false;
  if (rule.until && key(d) > rule.until) return false;
  switch (rule.freq) {
    case 'DAILY':
      return diff % rule.interval === 0;
    case 'WEEKLY': {
      const days = rule.byDay.length ? rule.byDay : [weekdayOfLocal(anchor)];
      if (!days.includes(weekdayOfLocal(d))) return false;
      const weekIndex = Math.floor((diff + weekdayOfLocal(anchor)) / 7);
      return weekIndex % rule.interval === 0;
    }
    case 'MONTHLY': {
      const months = (d.year - anchor.year) * 12 + (d.month - anchor.month);
      return d.day === anchor.day && months % rule.interval === 0;
    }
  }
}

/** Próxima ocorrência estritamente depois de `after`. */
export function nextOccurrence(ruleStr: string, anchor: LocalDate, after: LocalDate): LocalDate | null {
  const rule = parseRule(ruleStr);
  if (!rule) return null;
  let d = addDaysLocal(after, 1);
  for (let i = 0; i < 800; i++) {
    if (occursOn(rule, anchor, d)) return d;
    if (rule.until && key(d) > rule.until) return null;
    d = addDaysLocal(d, 1);
  }
  return null;
}

/** Todas as ocorrências entre from e to (inclusive), respeitando exceções. */
export function expandOccurrences(
  ruleStr: string,
  anchor: LocalDate,
  from: LocalDate,
  to: LocalDate,
  exdates: string[] = [],
): LocalDate[] {
  const rule = parseRule(ruleStr);
  if (!rule) return [];
  const out: LocalDate[] = [];
  let d = daysBetween(anchor, from) > 0 ? from : anchor;
  for (let i = 0; i < 1000 && daysBetween(d, to) >= 0; i++) {
    if (occursOn(rule, anchor, d) && !exdates.includes(key(d))) out.push(d);
    d = addDaysLocal(d, 1);
  }
  return out;
}

export function describeRule(ruleStr: string | null | undefined): string {
  const r = parseRule(ruleStr);
  if (!r) return '';
  if (r.freq === 'DAILY') return r.interval > 1 ? `a cada ${r.interval} dias` : 'todos os dias';
  if (r.freq === 'MONTHLY') return r.interval > 1 ? `a cada ${r.interval} meses` : 'todo mês';
  if (!r.byDay.length) return r.interval > 1 ? `a cada ${r.interval} semanas` : 'toda semana';
  if (r.byDay.length === 5 && [1, 2, 3, 4, 5].every((d) => r.byDay.includes(d))) return 'de segunda a sexta';
  const names = r.byDay.map((d) => DAY_NAMES[d]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0];
  return `toda ${list}`;
}
