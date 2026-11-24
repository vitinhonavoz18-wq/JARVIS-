/**
 * Interpretador determinístico de comandos em português do Brasil.
 * Resolve os comandos mais comuns localmente (rápido, gratuito e previsível).
 * O que ele não entende com segurança é encaminhado para o modelo de IA.
 */
import { normalizeText } from '../data/repo.ts';
import { parseCalcRequest } from '../calc/index.ts';
import type { PendingClarification, ToolCall } from '../types.ts';
import { addDaysLocal, localDateKey, localDateOf, weekdayOfLocal, zonedParts, type LocalDate } from '../time.ts';
import { buildRule } from './recurrence.ts';

export interface ParseCtx {
  now: Date;
  tz: string;
}

export interface Temporal {
  date?: LocalDate;
  time?: { h: number; m: number };
  durationMin?: number;
  remindBeforeMin?: number;
  recurrence?: string;
  recurDays?: number[];
  weekRange?: 'this' | 'next';
  rest: string;
}

export type SpecialAction =
  | { action: 'run_automation'; query: string }
  | { action: 'plan_day'; date?: string }
  | { action: 'project_query'; project: string; text: string }
  | { action: 'create_automation'; goal: string }
  | { action: 'suggest_postpone'; date: string }
  | { action: 'note_to_project'; query?: string }
  | { action: 'plan_project'; project?: string }
  | { action: 'complete'; query: string; date?: string }
  | { action: 'delete'; kind: 'task' | 'event' | 'any'; query: string; date?: string }
  | { action: 'remind_existing'; query: string; date?: string; time?: string; before: number; dateExplicit: boolean }
  | { action: 'stop_focus' };

export type ParseResult =
  | { kind: 'calls'; calls: ToolCall[]; confirm?: boolean; summary?: string; items?: string[] }
  | { kind: 'clarify'; pending: PendingClarification }
  | { kind: 'reply'; reply: string }
  | { kind: 'special'; special: SpecialAction }
  | { kind: 'unknown' };

/* ------------------------------------------------------------------ */
/* Números e quantidades                                               */
/* ------------------------------------------------------------------ */

const NUM_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, vinte: 20, trinta: 30,
  'quarenta e cinco': 45, quarenta: 40, cinquenta: 50, noventa: 90,
};
const NUMW = '(?:\\d+|quarenta e cinco|uma|um|duas|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|vinte|trinta|quarenta|cinquenta|noventa)';
const HOURW = '(?:\\d{1,2}|uma|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)';
const AMOUNT = `(?:meia\\s+hora|${NUMW}\\s*(?:horas?|hrs?|h)(?:\\s*e\\s*meia|\\s*(?:e\\s*)?\\d{1,2}(?:\\s*min(?:utos?)?)?)?|${NUMW}\\s*(?:minutos?|mins?|min))`;
const L = '(?<![\\p{L}\\d])';
const R = '(?![\\p{L}\\d])';
const WD = '(?:segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)';
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTH_RE = '(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';

function num(s: string): number {
  const k = normalizeText(s);
  if (/^\d+$/.test(k)) return Number(k);
  return NUM_WORDS[k] ?? NaN;
}

export function parseAmount(s: string): number {
  const t = normalizeText(s);
  if (/meia\s+hora/.test(t)) return 30;
  const h = new RegExp(`(${NUMW.replace('tr[eê]s', 'tres')})\\s*(?:horas?|hrs?|h)`).exec(t);
  if (h) {
    let total = num(h[1]) * 60;
    if (/e\s*meia/.test(t)) total += 30;
    const extra = /(?:horas?|hrs?|h)\s*(?:e\s*)?(\d{1,2})/.exec(t);
    if (extra) total += Number(extra[1]);
    return total;
  }
  const m = new RegExp(`(${NUMW.replace('tr[eê]s', 'tres')})\\s*(?:minutos?|mins?|min)`).exec(t);
  return m ? num(m[1]) : NaN;
}

function wdIndex(s: string): number {
  const k = normalizeText(s).replace(/-?\s*feiras?$/, '').replace(/s$/, '');
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].indexOf(k);
}

/* ------------------------------------------------------------------ */
/* Extração temporal                                                   */
/* ------------------------------------------------------------------ */

export function extractTemporal(text: string, ctx: ParseCtx): Temporal {
  let s = ` ${text} `;
  const out: Temporal = { rest: '' };
  const today = localDateOf(ctx.now, ctx.tz);
  const cut = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const m = re.exec(s);
    if (m && fn(m) !== false) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  };

  // 1. Antecedência do lembrete: "me avise meia hora antes", "uma hora antes"
  cut(
    new RegExp(`,?\\s*(?:e\\s+)?(?:(?:me\\s+)?(?:avis[ea]r?|lembr[ea]r?|notifi(?:que|car?))(?:-me)?\\s+(?:com\\s+)?)?(${AMOUNT})\\s+(?:antes|de\\s+anteced[êe]ncia)${R}`, 'iu'),
    (m) => {
      out.remindBeforeMin = parseAmount(m[1]);
    },
  );
  cut(/,?\s*(?:e\s+)?me\s+avis[ea]\s+na\s+hora(?![\p{L}])/iu, () => {
    out.remindBeforeMin = 0;
  });

  // 2. Duração
  cut(new RegExp(`,?\\s*(?:(?:com\\s+)?dura[çc][ãa]o\\s+de|(?:por|durante))\\s+(${AMOUNT})${R}`, 'iu'), (m) => {
    out.durationMin = parseAmount(m[1]);
  });

  // 3. Recorrência
  cut(new RegExp(`${L}(?:de\\s+segunda\\s+a\\s+sexta|tod[oa]s?\\s+(?:os\\s+)?dias?\\s+[úu]teis|em\\s+dias\\s+[úu]teis)${R}`, 'iu'), () => {
    out.recurDays = [1, 2, 3, 4, 5];
    out.recurrence = buildRule({ freq: 'WEEKLY', byDay: out.recurDays });
  });
  if (!out.recurrence) {
    cut(new RegExp(`${L}(?:tod[oa]s?\\s+(?:os\\s+)?dias|todo\\s+dia|diariamente)${R}`, 'iu'), () => {
      out.recurrence = buildRule({ freq: 'DAILY' });
    });
  }
  if (!out.recurrence) {
    const WDP = `${WD}s?(?:-feiras?|\\s+feiras?)?`;
    cut(new RegExp(`${L}tod[oa]s?\\s+(?:as\\s+|os\\s+)?(${WDP}(?:\\s*(?:,|e)\\s*(?:a\\s+|o\\s+|as\\s+|os\\s+)?${WDP})*)${R}`, 'iu'), (m) => {
      const days = [...m[1].matchAll(new RegExp(WD, 'giu'))].map((x) => wdIndex(x[0])).filter((d) => d >= 0);
      out.recurDays = [...new Set(days)].sort();
      out.recurrence = buildRule({ freq: 'WEEKLY', byDay: out.recurDays });
    });
  }
  if (!out.recurrence) {
    cut(new RegExp(`${L}(?:toda\\s+semana|semanalmente)${R}`, 'iu'), () => {
      out.recurrence = 'FREQ=WEEKLY';
    });
    cut(new RegExp(`${L}(?:todo\\s+m[êe]s|mensalmente)${R}`, 'iu'), () => {
      out.recurrence = 'FREQ=MONTHLY';
    });
  }

  // 4. Relativo: "daqui a 30 minutos", "em 2 horas"
  cut(new RegExp(`${L}(?:daqui\\s+a|em|dentro\\s+de)\\s+(${AMOUNT})${R}`, 'iu'), (m) => {
    const mins = parseAmount(m[1]);
    if (!Number.isFinite(mins)) return false;
    const at = new Date(ctx.now.getTime() + mins * 60000);
    const p = zonedParts(at, ctx.tz);
    out.date = { year: p.year, month: p.month, day: p.day };
    out.time = { h: p.hour, m: p.minute };
  });

  // 5. Palavras de dia
  cut(new RegExp(`${L}depois\\s+de\\s+amanh[ãa]${R}`, 'iu'), () => {
    out.date = addDaysLocal(today, 2);
  });
  cut(new RegExp(`${L}anteontem${R}`, 'iu'), () => {
    out.date = addDaysLocal(today, -2);
  });
  if (!out.date) cut(new RegExp(`${L}amanh[ãa]${R}`, 'iu'), () => { out.date = addDaysLocal(today, 1); });
  if (!out.date) cut(new RegExp(`${L}hoje${R}`, 'iu'), () => { out.date = today; });
  if (!out.date) cut(new RegExp(`${L}ontem${R}`, 'iu'), () => { out.date = addDaysLocal(today, -1); });

  // 6. Semana
  cut(new RegExp(`${L}(?:(?:n?a\\s+)?pr[óo]xima\\s+semana|(?:n?a\\s+)?semana\\s+que\\s+vem)${R}`, 'iu'), () => {
    out.weekRange = 'next';
  });
  cut(new RegExp(`${L}(?:(?:n?esta|n?essa)\\s+semana|da\\s+semana|na\\s+semana)${R}`, 'iu'), () => {
    out.weekRange = 'this';
  });

  // 7. Dia da semana
  if (!out.date && !out.recurDays) {
    cut(
      new RegExp(
        `${L}(?:(?:n[ao]|nest[ae]|ness[ae]|est[ae]|ess[ae])\\s+)?(pr[óo]xim[ao]\\s+)?(${WD})(-feira|\\s+feira)?(\\s+que\\s+vem|\\s+da\\s+semana\\s+que\\s+vem)?(?=\\s*(?:$|[,.;!?]|[àa]s?\\s|às|ao\\s|de\\s+manh|à\\s+tarde|a\\s+tarde|à\\s+noite|a\\s+noite|\\d|para|pra|com|e\\s|me\\s|que\\s|pela|meio))`,
        'iu',
      ),
      (m) => {
        const target = wdIndex(m[2]);
        const wd = weekdayOfLocal(today);
        let diff = (target - wd + 7) % 7;
        if (diff === 0) diff = 7;
        if (m[4] && /semana que vem/i.test(m[4]) && diff < 7 - wd) diff += 7;
        out.date = addDaysLocal(today, diff);
      },
    );
  }

  // 8. Datas explícitas
  if (!out.date) {
    cut(new RegExp(`${L}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${R}`, 'iu'), (m) => {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return false;
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : today.year;
      if (!m[3] && localDateKey({ year: y, month: mo, day: d }) < localDateKey(today)) y++;
      out.date = { year: y, month: mo, day: d };
    });
  }
  if (!out.date) {
    cut(new RegExp(`${L}(?:(?:no\\s+)?dia\\s+)?(\\d{1,2})\\s+de\\s+${MONTH_RE}(?:\\s+de\\s+(\\d{4}))?${R}`, 'iu'), (m) => {
      const mo = MONTHS.indexOf(normalizeText(m[2])) + 1;
      let y = m[3] ? Number(m[3]) : today.year;
      if (!m[3] && localDateKey({ year: y, month: mo, day: Number(m[1]) }) < localDateKey(today)) y++;
      out.date = { year: y, month: mo, day: Number(m[1]) };
    });
  }
  if (!out.date) {
    cut(new RegExp(`${L}(?:n?o\\s+)?dia\\s+(\\d{1,2})${R}`, 'iu'), (m) => {
      const d = Number(m[1]);
      if (d < 1 || d > 31) return false;
      let mo = today.month;
      let y = today.year;
      if (d < today.day) {
        mo++;
        if (mo > 12) {
          mo = 1;
          y++;
        }
      }
      out.date = { year: y, month: mo, day: d };
    });
  }

  // 9. Horário
  if (!out.time) {
    cut(new RegExp(`${L}(?:[àa]o?\\s+|ao\\s+)?meio[-\\s]dia(\\s+e\\s+meia)?${R}`, 'iu'), (m) => {
      out.time = { h: 12, m: m[1] ? 30 : 0 };
    });
  }
  if (!out.time) {
    cut(new RegExp(`${L}(?:[àa]\\s+)?meia[-\\s]noite${R}`, 'iu'), () => {
      out.time = { h: 0, m: 0 };
    });
  }
  if (!out.time) {
    const re = new RegExp(
      `${L}(?:(?:[àa]s|as|pelas|por\\s+volta\\s+das|[àa])\\s+(${HOURW})(?:\\s*(?:h|:)\\s*(\\d{2}))?(?:\\s*(?:h|hs|horas?|hrs?))?|(\\d{1,2})\\s*(?:h|:)\\s*(\\d{2})?(?:\\s*(?:hs|horas?))?)(\\s+e\\s+meia)?(?:\\s+(?:da|de|à|a|pela)\\s+(manh[ãa]|tarde|noite|madrugada))?${R}`,
      'iu',
    );
    cut(re, (m) => {
      const hRaw = m[1] ?? m[3];
      let h = num(hRaw);
      let min = Number(m[2] ?? m[4] ?? 0);
      if (!Number.isFinite(h) || h > 23 || min > 59) return false;
      if (m[5]) min = 30;
      const period = m[6] ? normalizeText(m[6]) : '';
      if ((period === 'tarde' || period === 'noite') && h < 12) h += 12;
      if (period === 'manha' && h === 12) h = 0;
      out.time = { h, m: min };
    });
  }
  // Período solto ("de manhã") apenas é removido do título.
  cut(new RegExp(`${L}(?:de\\s+manh[ãa]|pela\\s+manh[ãa]|[àa]\\s+tarde|de\\s+tarde|[àa]\\s+noite|de\\s+noite)${R}`, 'iu'), () => {});

  out.rest = s.replace(/\s+/g, ' ').trim();
  return out;
}

/* ------------------------------------------------------------------ */
/* Limpeza de títulos                                                  */
/* ------------------------------------------------------------------ */

const FILLER_START = /^(?:para|pra|pro|de|da|do|das|dos|no|na|nos|nas|em|às|as|à|a|o|os|e|que|um|uma|sobre|com|lá|la|aí|ai)\s+/iu;
const FILLER_END = /\s+(?:para|pra|pro|de|da|do|no|na|em|às|as|à|a|o|e|que|com|me|lá|la|marcad[ao]|agendad[ao]|por favor)$/iu;

export function cleanTitle(s: string): string {
  let t = s.replace(/\s+/g, ' ').replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '').trim();
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(FILLER_START, '').replace(FILLER_END, '').replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '').trim();
  }
  t = t.replace(/\s+,/g, ',');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function stripWakeWord(text: string): string {
  return text.replace(/^\s*(?:ok|ei|hey|ol[áa]|oi|e\s+a[ií])?[\s,]*jarvis[\s,.:!-]*/iu, '').trim();
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toLocalDT = (d: LocalDate, t?: { h: number; m: number }) =>
  t ? `${localDateKey(d)}T${pad(t.h)}:${pad(t.m)}` : localDateKey(d);
const toTime = (t: { h: number; m: number }) => `${pad(t.h)}:${pad(t.m)}`;

function isFutureToday(t: { h: number; m: number }, ctx: ParseCtx) {
  const p = zonedParts(ctx.now, ctx.tz);
  return t.h * 60 + t.m > p.hour * 60 + p.minute;
}

function guessTags(original: string): string[] {
  const stop = new Set(['Jarvis', 'Quero', 'Preciso', 'Tive', 'Anote', 'Ideia', 'Nota', 'Eu', 'Para', 'Isso', 'Uma', 'Um', 'O', 'A', 'E', 'Me', 'Crie', 'Registre']);
  const tags = [...original.matchAll(/(?<![\p{L}])([A-ZÁÉÍÓÚÂÊÔÃÕ][\p{L}\d]{2,}(?:[A-Z][\p{L}\d]+)*)/gu)]
    .map((m) => m[1])
    .filter((w) => !stop.has(w));
  return [...new Set(tags)].slice(0, 5);
}

function guessMemoryCategory(n: string): string {
  if (/(me chame|pode me chamar|meu nome|tratamento)/.test(n)) return 'tratamento';
  if (/(manha|tarde|noite|horario|cedo|madrugada|\dh)/.test(n)) return 'horarios';
  if (/(notifica|aviso|lembrete)/.test(n)) return 'notificacoes';
  if (/(trabalho|reunio|reuniao|cliente|empresa)/.test(n)) return 'trabalho';
  if (/(respost|fale|falar|comunica|curt|objetiv)/.test(n)) return 'comunicacao';
  if (/(projeto)/.test(n)) return 'projetos';
  return 'geral';
}

export const HELP_TEXT = `Posso, por exemplo:
• “Academia amanhã às 9, me avise meia hora antes”
• “Me lembre de ligar para o cliente às 15h”
• “Marque reunião com João sexta às 11h, duração de uma hora”
• “Anote que preciso estudar novas estratégias de vendas”
• “O que tenho para amanhã?”
• “Altere a academia de amanhã para 7h”
• “Crie uma tarefa de treino toda segunda, quarta e sexta às 7h”
• “Quais ideias eu já registrei sobre a Connectfly?”
• “Iniciar modo foco por 45 minutos no projeto Connectfly”
• “Bom dia” — para o briefing do dia`;

/* ------------------------------------------------------------------ */
/* Classificação de intenção                                           */
/* ------------------------------------------------------------------ */

const COMPLETE_VERBS = '(?:conclua|concluir|conclu[ií]|completei|complete|completar|finalizei|finalize|terminei|termine|fiz|feito|j[áa]\\s+fiz|acabei)';
const DELETE_VERBS = '(?:apague|apagar|apaga|delete|deletar|exclua|excluir|exclui|remova|remover|remove|cancele|cancelar|cancela|desmarque|desmarcar|desmarca|tire|tira)';
const MOVE_VERBS = '(?:altere|alterar|altera|mude|mudar|muda|troque|trocar|troca|remarque|remarcar|remarca|passe|passar|passa|adie|adiar|adia|mova|mover|move|reagende|reagendar|reagenda|transfira|transferir|empurre|empurra|jogue|joga)';

/** Pergunta: termina em "?" ou começa com palavra interrogativa. */
export function isQuestion(text: string): boolean {
  if (/\?\s*$/.test(text)) return true;
  const n = normalizeText(stripWakeWord(text)).trim();
  return /^(como|qual|quais|quando|onde|aonde|por\s?que|pq|quanto|quantos|quantas|quem|o\s+que|oque|sera\s+que|vai\s+(chover|fazer|ter|estar)|e\s+se|existe|tem\s+como)\b/.test(n);
}

export function parseCommand(input: string, ctx: ParseCtx): ParseResult {
  const original = stripWakeWord(input).replace(/\s+/g, ' ').trim();
  if (!original) return { kind: 'unknown' };
  const n = normalizeText(original).replace(/[?!.]+$/, '');
  // Perguntas nunca viram criação de tarefa/evento pelo caminho local (ex.: "como está o clima amanhã?").
  const question = isQuestion(original);
  const today = localDateOf(ctx.now, ctx.tz);
  const todayKey = localDateKey(today);

  // Clima (sem IA): "como está o clima amanhã??", "vai chover hoje em Feira de Santana?"
  if (/\b(clima|tempo\s+(?:amanha|hoje|agora|em|pra|para)|previsao\s+do\s+tempo|chover|chuva|temperatura|calor|frio)\b/.test(n) && !/\b(tempo\s+livre|quanto\s+tempo|tempo\s+de\s+)/.test(n)) {
    const city = /\b(?:em|no|na|de)\s+([a-z][a-z\s]{2,40}?)(?:\s+(?:hoje|amanha|agora|depois de amanha))?$/.exec(n)?.[1]?.trim();
    const date = /\bdepois\s+de\s+amanha\b/.test(n) ? localDateKey(addDaysLocal(localDateOf(ctx.now, ctx.tz), 2)) : /\bamanha\b/.test(n) ? 'tomorrow' : 'today';
    const known = city && !/^(hoje|amanha|agora|semana|tempo|clima)$/.test(city);
    return { kind: 'calls', calls: [{ tool: 'get_weather', input: { date, ...(known ? { city } : {}) } }] };
  }

  // Cálculos exatos (sem IA): "quanto é 15% de 200", "comprei por 200 e vendi por 350…"
  const calc = parseCalcRequest(original);
  if (calc) return { kind: 'calls', calls: [{ tool: 'calculate', input: calc }] };

  // Ajuda / cortesia
  if (/^(ajuda|help|comandos|o que voce (sabe|pode|consegue) fazer)/.test(n)) return { kind: 'reply', reply: HELP_TEXT };
  if (/^(obrigad[oa]|valeu|show|perfeito|otimo|beleza)[\s!.]*$/.test(n)) return { kind: 'reply', reply: 'Disponha. Estou por aqui.' };

  // ---------------- 2.0: automações, empresas, planejamento ----------------
  const v2 = parseBusiness(original, n, ctx);
  if (v2) return v2;

  // Memória
  if (/(o que voce (sabe|lembra) (sobre|de) mim|minhas (preferencias|memorias)|quais (sao )?minhas preferencias)/.test(n)) {
    return { kind: 'calls', calls: [{ tool: 'list_memories', input: {} }] };
  }

  // Briefing e revisão
  if (/^(bom dia|boa tarde|boa noite)[\s,!.]*(jarvis)?[\s!.]*$/.test(n) || /(briefing|resumo do (meu )?dia|planejamento (do|de hoje|para hoje|do meu dia)|como (esta|e|ta) (o )?meu dia|organiz\w* (a )?minha (manha|tarde|dia|rotina)|me (atualize|atualiza))/.test(n)) {
    return { kind: 'calls', calls: [{ tool: 'generate_daily_briefing', input: {} }] };
  }
  if (/((revisao|resumo|balanco) (do )?(fim|final) do dia|revisao (noturna|do dia|de hoje)|como foi (o )?meu dia|evening review)/.test(n)) {
    return { kind: 'calls', calls: [{ tool: 'evening_review', input: {} }] };
  }
  if (/(produtividade|quantas? (tarefas|sessoes|vezes) .*(conclui|completei|fiz|cumpri)|quanto tempo de foco|meu progresso|meu desempenho|como (estou|to) indo)/.test(n)) {
    return { kind: 'calls', calls: [{ tool: 'get_productivity_summary', input: { range: /\bhoje\b/.test(n) ? 'today' : 'week' } }] };
  }

  // Foco
  if (/(parar|pare|encerrar|encerre|finalizar|finalize|sair|saia|terminar|termine|desativar|desative)\s+(o\s+|do\s+|da\s+)?(modo foco|mission mode|foco|sessao( de foco)?)/.test(n)) {
    return { kind: 'special', special: { action: 'stop_focus' } };
  }
  if (/(modo foco|mission mode|sessao de foco|modo concentracao)/.test(n) || /^(vamos )?(focar|foco)\b/.test(n)) {
    const t = extractTemporal(original, ctx);
    const proj = /(?:n[oa]|d[oa]|para o|pro|pra)\s+projeto\s+(.+?)\s*[.!?]*$/iu.exec(original);
    const task = !proj ? /(?:na tarefa|para a tarefa)\s+(.+?)\s*[.!?]*$/iu.exec(original) : null;
    const input: Record<string, unknown> = { minutes: t.durationMin && Number.isFinite(t.durationMin) ? t.durationMin : 25 };
    if (proj) input.project = cleanTitle(proj[1]);
    if (task) input.task = cleanTitle(task[1]);
    return { kind: 'calls', calls: [{ tool: 'start_focus_session', input }] };
  }

  // Busca
  const searchVerb = /(mostre|mostra|me mostre|quais|liste|lista|encontre|encontra|ache|busque|busca|procure|procura|pesquise|pesquisa|o que (eu )?(ja )?(registrei|anotei|escrevi|salvei)|tudo que)/;
  const sobre = /\bsobre\s+(.+)$/iu.exec(original.replace(/[?!.]+$/, ''));
  if (sobre && searchVerb.test(n)) {
    const t = extractTemporal(sobre[1], ctx);
    const q = cleanTitle(t.rest) || cleanTitle(sobre[1]);
    return { kind: 'calls', calls: [{ tool: 'search_personal_knowledge', input: { query: q } }] };
  }
  const directSearch = /^(?:pesquise|pesquisar|busque|buscar|procure|procurar|encontre|encontrar)\s+(?:por\s+)?(.+)$/iu.exec(original.replace(/[?!.]+$/, ''));
  if (directSearch) return { kind: 'calls', calls: [{ tool: 'search_personal_knowledge', input: { query: cleanTitle(directSearch[1]) } }] };

  // Reorganização
  if (/(o que (eu )?posso (deixar|adiar|passar|mover|empurrar)|estou (muito )?(ocupad|sem tempo|atolad|sobrecarregad)|alivi\w* (meu|o) dia)/.test(n)) {
    return { kind: 'special', special: { action: 'suggest_postpone', date: todayKey } };
  }
  if (/(reorganiz|ordene|ordena|priorize|prioriza|organize|organiza)\w*\s+(as\s+)?(minhas\s+)?tarefas/.test(n)) {
    return { kind: 'calls', calls: [{ tool: 'list_tasks', input: { range: 'pending' } }], summary: 'Suas tarefas pendentes, ordenadas por prioridade e prazo:' };
  }

  // Projetos
  if (/(transform|convert|vir)\w*\s+(essa|esta|a ultima|minha ultima|a)?\s*(anotacao|nota|ideia)\s+(em|num|para)\s+(um\s+)?projeto/.test(n)) {
    return { kind: 'special', special: { action: 'note_to_project' } };
  }
  const planProj = /(?:organiz|divid|quebr|planej|estrutur|separ)\w*\s+(?:esse|este|o|meu)\s+projeto(?:\s+(.+?))?\s+em\s+(?:etapas|tarefas|fases)/iu.exec(original) ??
    /(?:organiz|divid|quebr|planej|estrutur|separ)\w*\s+(?:esse|este|o)\s+projeto/iu.exec(original);
  if (planProj) return { kind: 'special', special: { action: 'plan_project', project: planProj[1] ? cleanTitle(planProj[1]) : undefined } };
  const newProj = /^(?:crie|criar|cria|novo|abra|abrir|comece|come[çc]ar|inicie|iniciar)\s+(?:um\s+)?(?:novo\s+)?projeto\s+(?:chamado\s+|com\s+o\s+nome\s+|de\s+nome\s+|denominado\s+)?(.+)$/iu.exec(original);
  if (newProj) {
    const name = newProj[1].replace(/^["“'”]+|["“'”.!]+$/g, '').trim();
    return { kind: 'calls', calls: [{ tool: 'create_project', input: { name } }] };
  }

  // Rotinas / hábitos
  if (/^(crie|criar|cria|nova|novo|adicione|adiciona|registre)\s+(uma\s+|um\s+)?(nova\s+|novo\s+)?(rotina|habito)/.test(n)) {
    const t = extractTemporal(original, ctx);
    const name = cleanTitle(t.rest.replace(/^.*?(?:rotina|h[áa]bito)\s+(?:de\s+|chamad[ao]\s+)?/iu, ''));
    if (!name) return { kind: 'reply', reply: 'Qual o nome da rotina? Ex.: “Crie a rotina leitura todos os dias às 21h”.' };
    const days = t.recurDays ?? (t.recurrence === 'FREQ=DAILY' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
    const input: Record<string, unknown> = { name, days };
    if (t.time) input.time = toTime(t.time);
    return { kind: 'calls', calls: [{ tool: 'create_routine', input }] };
  }

  // Concluir
  const comp = new RegExp(`^(?:${COMPLETE_VERBS})\\s+(?:a\\s+tarefa\\s+|o\\s+|a\\s+)?(.+?)$`, 'iu').exec(original.replace(/[.!]+$/, '')) ??
    /^(?:marque|marca|marcar)\s+(?:a\s+tarefa\s+|o\s+|a\s+)?(.+?)\s+como\s+(?:feit[ao]|conclu[íi]d[ao]|completa)$/iu.exec(original.replace(/[.!]+$/, ''));
  if (comp) {
    const t = extractTemporal(comp[1], ctx);
    const q = cleanTitle(t.rest);
    if (q) return { kind: 'special', special: { action: 'complete', query: q, date: t.date ? localDateKey(t.date) : undefined } };
  }

  // Excluir
  const del = new RegExp(`^${DELETE_VERBS}\\s+(?:a\\s+|o\\s+)?(tarefa|evento|compromisso|reuni[ãa]o|lembrete)?\\s*(?:de\\s+|da\\s+|do\\s+)?(.+)$`, 'iu').exec(original.replace(/[.!]+$/, ''));
  if (del) {
    const t = extractTemporal(del[2], ctx);
    const kindWord = normalizeText(del[1] ?? '');
    const verb = normalizeText(original.split(' ')[0]);
    const kind = kindWord === 'tarefa' ? 'task' : kindWord && kindWord !== 'lembrete' ? 'event' : verb.startsWith('desmarc') ? 'event' : 'any';
    const query = cleanTitle(t.rest) || (kindWord === 'reuniao' ? 'Reunião' : '');
    if (query) return { kind: 'special', special: { action: 'delete', kind, query, date: t.date ? localDateKey(t.date) : undefined } };
  }

  // Remarcar
  const mv = new RegExp(`^${MOVE_VERBS}\\s+(.+?)\\s+(?:para|pra|pro)\\s+(.+)$`, 'iu').exec(original.replace(/[.!]+$/, ''));
  if (mv) {
    const target = extractTemporal(mv[1], ctx);
    const next = extractTemporal(mv[2], ctx);
    const query = cleanTitle(target.rest.replace(/^(?:o\s+|a\s+)?(?:hor[áa]rio|data)\s+(?:d[ao]s?\s+)?/iu, ''));
    if (query && (next.date || next.time)) {
      const input: Record<string, unknown> = { match: { query, ...(target.date ? { date: localDateKey(target.date) } : {}) } };
      if (next.date) input.new_date = localDateKey(next.date);
      if (next.time) input.new_time = toTime(next.time);
      return { kind: 'calls', calls: [{ tool: 'reschedule_item', input }] };
    }
  }
  const adie = /^(?:adie|adiar|adia|empurre|empurra)\s+(.+)$/iu.exec(original.replace(/[.!]+$/, ''));
  if (adie && !mv) {
    const target = extractTemporal(adie[1], ctx);
    const base = target.date ?? today;
    return { kind: 'calls', calls: [{ tool: 'reschedule_item', input: { match: { query: cleanTitle(target.rest), date: localDateKey(base) }, new_date: localDateKey(addDaysLocal(base, 1)) } }] };
  }

  // Extração temporal do comando inteiro
  const t = extractTemporal(original, ctx);
  const nRest = normalizeText(t.rest);

  // Memória permanente: "lembre que prefiro reuniões pela manhã"
  const mem = /^(?:lembre|lembra|lembre-se|memorize|guarde|grave|saiba|anote)\s+(?:-se\s+)?(?:de\s+)?que\s+(.+)$/iu.exec(original.replace(/[.!]+$/, ''));
  if (mem && /^(eu\s+)?(prefiro|gosto|nao gosto|não gosto|costumo|sempre|nunca|meu|minha|me chame|pode me chamar|odeio|trabalho|acordo|durmo)/iu.test(mem[1])) {
    const content = mem[1].trim().replace(/^eu\s+/i, '');
    const finalContent = content[0].toUpperCase() + content.slice(1);
    return {
      kind: 'calls',
      confirm: true,
      summary: 'Posso guardar esta preferência na sua memória permanente?',
      items: [finalContent],
      calls: [{ tool: 'remember_preference', input: { category: guessMemoryCategory(normalizeText(content)), content: finalContent } }],
    };
  }

  // Lembretes
  const remind = /(?:^|\s)(?:me\s+)?(?:lembre|lembra|lembrar|avise|avisa|avisar|notifique|notifica)(?:-me)?\s+(?:de\s+|da\s+|do\s+|das\s+|dos\s+|que\s+|para\s+|pra\s+|sobre\s+)?(.+)$/iu.exec(t.rest);
  if (remind && !/^(o que|quais|qual)/.test(n)) {
    const title = cleanTitle(remind[1]);
    if (t.remindBeforeMin !== undefined && title) {
      return {
        kind: 'special',
        special: {
          action: 'remind_existing', query: title, before: t.remindBeforeMin,
          date: t.date ? localDateKey(t.date) : undefined, time: t.time ? toTime(t.time) : undefined, dateExplicit: Boolean(t.date),
        },
      };
    }
    if (!title) return { kind: 'reply', reply: 'Do que devo te lembrar?' };
    return finishTimed('create_reminder', title, t, ctx);
  }

  // Consultas de agenda/tarefas
  const isQuery = /^(o que|oque|que|quais?|qual|quando|quantos?|quantas?|tenho|tem|me (mostre|mostra|diga|diz|fala|fale)|mostre|mostra|liste|lista|listar|ver|veja|como (esta|ta)|minha agenda|minhas tarefas|meus compromissos|agenda d[eo]|tarefas d[eo]|compromissos d[eo])/.test(n) || /\?\s*$/.test(original);
  if (isQuery && /(tenho|agenda|compromisso|tarefa|evento|reuni|programad|marcad|pendente|pendencia|atrasad|fazer|planejad|algo)/.test(n)) {
    const dateKey = t.date ? localDateKey(t.date) : undefined;
    if (/(pendente|pendencia|atrasad|ficou|nao (fiz|conclui)|esqueci)/.test(n)) {
      if (dateKey && dateKey < todayKey) return { kind: 'calls', calls: [{ tool: 'list_tasks', input: { range: 'date', date: dateKey, only_open: true } }] };
      return { kind: 'calls', calls: [{ tool: 'list_tasks', input: { range: 'overdue' } }] };
    }
    const onlyTasks = /tarefa/.test(n) && !/(compromisso|agenda|evento|reuni)/.test(n);
    const onlyEvents = /(compromisso|evento|reuni)/.test(n) && !/tarefa/.test(n);
    if (t.weekRange) {
      const base = t.weekRange === 'next' ? addDaysLocal(today, 7) : today;
      const wd = weekdayOfLocal(base);
      const from = t.weekRange === 'next' ? addDaysLocal(base, -((wd + 6) % 7)) : today;
      const to = addDaysLocal(t.weekRange === 'next' ? from : base, t.weekRange === 'next' ? 6 : 6 - ((wd + 6) % 7));
      const calls: ToolCall[] = [];
      if (!onlyTasks) calls.push({ tool: 'list_events', input: { from: localDateKey(from), to: localDateKey(to) } });
      if (!onlyEvents) calls.push({ tool: 'list_tasks', input: { range: 'week' } });
      return { kind: 'calls', calls };
    }
    const d = dateKey ?? todayKey;
    if (onlyTasks) return { kind: 'calls', calls: [{ tool: 'list_tasks', input: { range: 'date', date: d } }] };
    if (onlyEvents) return { kind: 'calls', calls: [{ tool: 'list_events', input: { date: d } }] };
    return { kind: 'calls', calls: [{ tool: 'get_agenda', input: { date: d } }] };
  }

  // Anotações
  const noteExplicit =
    /^(?:anote|anota|anotar|registre|registra|registrar|salve|salva|guarde|guarda|escreva|escreve)\s+(?:que|a ideia|essa ideia|uma ideia|isso|uma nota|nota|na nota)\b/.test(n) ||
    /^(?:crie|criar|cria|nova|faca|faz|fazer|adicione|adiciona|abra|abrir)\s+(?:uma\s+)?(?:nova\s+)?(?:anotacao|nota)\b/.test(n) ||
    /^tive uma ideia/.test(n) ||
    /^(ideia|nota|anotacao)\s*[:-]/.test(n);
  const bareAnote = /^(?:anote|anota|anotar|registre|registra)\s+/.test(n);
  if (noteExplicit || (bareAnote && !t.date && !t.time)) {
    const isIdea = /ideia/.test(n);
    let content = original
      .replace(/^(?:anote|anota|anotar|registre|registra|registrar|salve|salva|guarde|guarda|escreva|escreve)\s+(?:que\s+|isso:?\s+|uma\s+nota:?\s+|nota:?\s+|na\s+nota:?\s+)?/iu, '')
      .replace(/^(?:crie|criar|cria|nova|fa[çc]a|faz|fazer|adicione|adiciona|abra|abrir)\s+(?:uma\s+)?(?:nova\s+)?(?:anota[çc][ãa]o|nota)\s*(?:sobre\s+|de\s+|com\s+|:)?\s*/iu, '')
      .replace(/^(?:ideia|nota|anota[çc][ãa]o)\s*[:-]\s*/iu, '')
      .trim();
    if (/^tive uma ideia/i.test(content)) content = content.replace(/^tive uma ideia[\s:,.]*/iu, 'Ideia ').trim();
    const meaningful = normalizeText(content).replace(/\b(minha|nova|uma|ideia|sobre|a|o)\b/g, '').trim();
    if (!meaningful || meaningful.split(/\s+/).length < 2) {
      return {
        kind: 'clarify',
        pending: { intent: 'create_task', missing: 'title', draft: { mode: 'note', folder: isIdea ? 'Ideias' : null }, question: isIdea ? 'Pode falar, estou anotando sua ideia.' : 'Pode ditar, estou anotando.' },
      };
    }
    content = content[0].toUpperCase() + content.slice(1);
    if (!/[.!?].+[.!?]$/s.test(content)) content = content.replace(/\.$/, '');
    const input: Record<string, unknown> = { content, tags: guessTags(content) };
    if (isIdea) input.folder = 'Ideias';
    return { kind: 'calls', calls: [{ tool: 'create_note', input }] };
  }

  // Eventos
  const eventVerb = /^(?:marque|marca|marcar|agende|agenda|agendar|reserve|reservar)\s+/.test(nRest) || /^(?:marque|marca|marcar|agende|agendar)\s+/.test(n);
  const eventNoun = /^(?:uma\s+|um\s+)?(reuniao|consulta|encontro|call|almoco|jantar|entrevista|dentista|medico|aula|evento|compromisso)\b/.test(nRest);
  if (eventVerb || (eventNoun && t.time && !question)) {
    let title = t.rest.replace(/^(?:marque|marca|marcar|agende|agenda|agendar|reserve|reservar)\s+/iu, '');
    title = cleanTitle(title.replace(/^(?:uma|um)\s+/iu, ''));
    if (!title) return { kind: 'reply', reply: 'O que devo agendar?' };
    const participants = [...title.matchAll(/(?:com\s+(?:o\s+|a\s+)?)([A-ZÁÉÍÓÚÂÊÔ][\p{L}]+)(?:\s+e\s+([A-ZÁÉÍÓÚÂÊÔ][\p{L}]+))?/gu)].flatMap((m) => [m[1], m[2]].filter(Boolean));
    const draft: Record<string, unknown> = { title };
    if (participants.length) draft.participants = participants;
    if (t.durationMin && Number.isFinite(t.durationMin)) draft.duration_minutes = t.durationMin;
    if (t.remindBeforeMin !== undefined) draft.remind_minutes_before = t.remindBeforeMin;
    if (t.recurrence) draft.recurrence = t.recurrence;
    if (t.date) draft.date = localDateKey(t.date);
    if (t.time) draft.time = toTime(t.time);
    return finishEvent(draft, ctx);
  }

  // Captura múltipla: "preciso comprar um presente, estudar IA e tive uma ideia para meu app"
  const multi = question ? [] : splitCapture(original);
  if (multi.length >= 2) {
    const calls: ToolCall[] = [];
    const items: string[] = [];
    for (const part of multi) {
      const pn = normalizeText(part);
      if (/^(tive uma ideia|ideia|anote que|nota)/.test(pn)) {
        const content = part.replace(/^tive uma ideia[\s:,.]*/iu, 'Ideia ').replace(/^(?:anote que|nota:?)\s*/iu, '');
        const c = content[0].toUpperCase() + content.slice(1);
        calls.push({ tool: 'create_note', input: { content: c, folder: 'Ideias', tags: guessTags(c) } });
        items.push(`Nota: ${c}`);
      } else {
        const pt = extractTemporal(part, ctx);
        const title = cleanTitle(pt.rest.replace(/^(?:preciso|tenho\s+que|tenho\s+de|devo|quero|lembrar\s+de)\s+/iu, ''));
        if (!title) continue;
        const input: Record<string, unknown> = { title };
        if (pt.date) input.due = toLocalDT(pt.date, pt.time);
        calls.push({ tool: 'create_task', input });
        items.push(`Tarefa: ${title}${pt.date ? ` (${toLocalDT(pt.date, pt.time).replace('T', ' ')})` : ''}`);
      }
    }
    if (calls.length >= 2) return { kind: 'calls', calls, confirm: true, summary: `Identifiquei ${calls.length} itens. Posso registrar?`, items };
  }

  // Tarefas explícitas
  const taskVerb = /^(?:crie|criar|cria|adicione|adiciona|adicionar|inclua|incluir|coloque|colocar|coloca|nova|novo|anote|anota|anotar|registre|registra|bota|bote|poe|ponha|agende)\s+(?:uma\s+|um\s+)?(?:nova\s+)?(?:tarefa\s*:?\s*)?(?:de\s+|para\s+|pra\s+)?/iu;
  const need = /^(?:preciso|tenho\s+que|tenho\s+de|devo)\s+(?!que\s)/iu;
  if (taskVerb.test(t.rest) || need.test(t.rest) || /^tarefa\s*:/.test(nRest)) {
    const title = cleanTitle(t.rest.replace(taskVerb, '').replace(need, '').replace(/^tarefa\s*:\s*/iu, ''));
    if (title) return finishTimed('create_task', title, t, ctx);
  }

  // Implícito: "academia amanhã às 9"
  if (!question && (t.date || t.time || t.recurrence) && cleanTitle(t.rest)) {
    const title = cleanTitle(t.rest);
    const words = title.split(/\s+/).length;
    const looksLikeConversation = /[,;]/.test(title) || /\b(nao|voce|porque|acho|sera|seria|pode|poderia|quero que|preciso que)\b/.test(normalizeText(title));
    if (words <= 6 && !looksLikeConversation) return finishTimed('create_task', title, t, ctx);
  }

  return { kind: 'unknown' };
}

function splitCapture(text: string): string[] {
  const n = normalizeText(text);
  if (!/^(preciso|tenho que|tenho de|quero|lembrar de|anote)|tive uma ideia/.test(n)) return [];
  const base = text.replace(/[.!]+$/, '');
  const parts = base
    .split(/\s*[,;]\s*|\s+e\s+(?=(?:tamb[ée]m\s+)?(?:tive|preciso|tenho|[\p{L}]+(?:ar|er|ir)\b))/iu)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  // "preciso" no início vale para os itens seguintes.
  const prefix = /^(preciso|tenho que|tenho de|quero)\s+/iu.exec(parts[0])?.[0] ?? '';
  return parts.map((p, i) => (i > 0 && prefix && !/^(tive|preciso|tenho|quero)/iu.test(p) ? `${prefix}${p}` : p));
}

/** Cria tarefa/lembrete com tratamento de data/hora ausentes. */
function finishTimed(kind: 'create_task' | 'create_reminder', title: string, t: Temporal, ctx: ParseCtx): ParseResult {
  const today = localDateOf(ctx.now, ctx.tz);
  const draft: Record<string, unknown> = { title };
  if (t.recurrence) draft.recurrence = t.recurrence;
  if (t.remindBeforeMin !== undefined) draft.remind_minutes_before = t.remindBeforeMin;
  let date = t.date;
  if (!date && t.recurDays?.length) {
    // Primeira ocorrência da recorrência a partir de hoje.
    for (let i = 0; i < 7; i++) {
      const d = addDaysLocal(today, i);
      if (t.recurDays.includes(weekdayOfLocal(d)) && (i > 0 || !t.time || isFutureToday(t.time, ctx))) {
        date = d;
        break;
      }
    }
  }
  if (!date && t.recurrence === 'FREQ=DAILY') date = t.time && !isFutureToday(t.time, ctx) ? addDaysLocal(today, 1) : today;
  if (!date && t.time) {
    if (isFutureToday(t.time, ctx)) date = today;
    else {
      draft.time = toTime(t.time);
      return {
        kind: 'clarify',
        pending: { intent: kind, missing: 'date', draft, question: `${toTime(t.time).replace(':00', 'h').replace(':', 'h')} de hoje já passou. Para qual dia devo marcar?` },
      };
    }
  }
  if (kind === 'create_reminder') {
    if (!date && !t.time) return { kind: 'clarify', pending: { intent: kind, missing: 'time', draft, question: `Quando devo te lembrar de “${title}”?` } };
    if (date && !t.time) {
      draft.date = localDateKey(date);
      return { kind: 'clarify', pending: { intent: kind, missing: 'time', draft, question: 'Em qual horário devo te lembrar?' } };
    }
    // Lembrete = tarefa com aviso no horário (aparece na agenda e nas tarefas, sem duplicar).
    return { kind: 'calls', calls: [{ tool: 'create_task', input: { title, due: toLocalDT(date!, t.time), remind_minutes_before: t.remindBeforeMin ?? 0, ...(t.recurrence ? { recurrence: t.recurrence } : {}) } }] };
  }
  const input: Record<string, unknown> = { title };
  if (date) input.due = toLocalDT(date, t.time);
  if (t.recurrence) input.recurrence = t.recurrence;
  if (t.remindBeforeMin !== undefined && t.time) input.remind_minutes_before = t.remindBeforeMin;
  return { kind: 'calls', calls: [{ tool: 'create_task', input }] };
}

export function finishEvent(draft: Record<string, unknown>, _ctx: ParseCtx): ParseResult {
  if (!draft.date) {
    return { kind: 'clarify', pending: { intent: 'create_event', missing: 'date', draft, question: `Para qual dia devo marcar “${draft.title}”${draft.time ? ` às ${String(draft.time).replace(':00', 'h').replace(':', 'h')}` : ''}?` } };
  }
  if (!draft.time) {
    return { kind: 'clarify', pending: { intent: 'create_event', missing: 'time', draft, question: `Qual horário para “${draft.title}”?` } };
  }
  const { date, time, ...rest } = draft;
  return { kind: 'calls', calls: [{ tool: 'create_event', input: { ...rest, start: `${date}T${time}` } }] };
}

/** Continua uma conversa em que o JARVIS pediu um dado que faltava. */
export function resolveClarification(pending: PendingClarification, answer: string, ctx: ParseCtx): ParseResult | null {
  const a = stripWakeWord(answer).trim();
  const n = normalizeText(a);
  if (/^(cancel|deixa|esquece|nao|não|nada)/.test(n)) return { kind: 'reply', reply: 'Tudo bem, cancelei.' };
  const draft = { ...pending.draft };
  if (pending.missing === 'title') {
    if (draft.mode === 'note') {
      const content = a[0].toUpperCase() + a.slice(1);
      const input: Record<string, unknown> = { content, tags: guessTags(content) };
      if (draft.folder) input.folder = draft.folder;
      return { kind: 'calls', calls: [{ tool: 'create_note', input }] };
    }
    return null;
  }
  const t = extractTemporal(a, ctx);
  if (t.date) draft.date = localDateKey(t.date);
  if (t.time) draft.time = toTime(t.time);
  if (pending.missing === 'date' && !t.date) return null;
  if (pending.missing === 'time' && !t.time) return null;
  if (pending.intent === 'create_event') return finishEvent(draft, ctx);
  const title = String(draft.title);
  const date = draft.date ? (draft.date as string) : localDateKey(localDateOf(ctx.now, ctx.tz));
  const time = draft.time as string | undefined;
  const input: Record<string, unknown> = { title, due: time ? `${date}T${time}` : date };
  if (draft.recurrence) input.recurrence = draft.recurrence;
  if (pending.intent === 'create_reminder') input.remind_minutes_before = draft.remind_minutes_before ?? 0;
  else if (draft.remind_minutes_before !== undefined) input.remind_minutes_before = draft.remind_minutes_before;
  return { kind: 'calls', calls: [{ tool: 'create_task', input }] };
}

/* ------------------------------------------------------------------ */
/* Versão 2.0 — automações, empresas, planejador, despesas             */
/* ------------------------------------------------------------------ */

const PROJECT_WORDS: [RegExp, string][] = [
  [/\bconnect?fly\b|\bconectfly\b/, 'Connectfly'],
  [/\bfly\s?delivery\b/, 'FlyDelivery'],
  [/farmacia preco bom|\bfarmacia\b/, 'Farmácia Preço Bom'],
  [/\btg baterias\b|\bbaterias?\b/, 'TG Baterias'],
  [/site\s?creator\s?fly/, 'SiteCreatorFly'],
];

export function parseMoneyText(n: string): number | null {
  const m = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais|real|r\$)?/.exec(n.replace(/r\$\s*/g, 'r$ '));
  if (!m) return null;
  const raw = m[1];
  const v = /,\d{1,2}$/.test(raw) ? Number(raw.replace(/\./g, '').replace(',', '.')) : Number(raw.replace(/\.(?=\d{3}$)/, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseBusiness(original: string, n: string, ctx: ParseCtx): ParseResult | null {
  const clean = original.replace(/[.!?]+$/, '');

  // Criar automação com IA
  if (/(crie|criar|cria|monte|montar)\s+(uma\s+)?automac/.test(n) || (/^(quero|preciso) que\s+(tod[oa]|cada|diariamente|semanalmente)/.test(n) && /(relatorio|resumo|envi|prepar|sincroniz|verifiq)/.test(n))) {
    return { kind: 'special', special: { action: 'create_automation', goal: clean } };
  }
  // Executar automação
  const run = /^(?:execute|executar|executa|rode|rodar|roda|dispare|disparar|dispara|acione|acionar|aciona|inicie|iniciar|rodar)\s+(?:a\s+|o\s+)?(?:automa[cç][aã]o|workflow|fluxo|sincroniza[cç][aã]o)?\s*(?:de\s+|do\s+|da\s+)?(.+)$/iu.exec(clean);
  if (run && /(automac|workflow|fluxo|sincroniza|relatorio)/.test(n) && !/modo foco/.test(n)) {
    const q = cleanTitle(run[1].replace(/\b(autorizada|agora|por favor)\b/gi, ''));
    if (q) return { kind: 'special', special: { action: 'run_automation', query: /sincroniza/.test(n) && !/sincroniza/.test(normalizeText(q)) ? `sincronização ${q}` : q } };
  }
  // Falhas
  if (/(workflows?|automac\w*|fluxos?)\s+(que\s+)?(falharam|com (erro|falha)|deram erro)/.test(n) || /(falhas?|erros?) (das|nas|de) (automac|workflow|fluxo)/.test(n)) {
    const t = extractTemporal(original, ctx);
    return { kind: 'calls', calls: [{ tool: 'list_failed_workflows', input: t.date ? { date: localDateKey(t.date) } : {} }] };
  }
  // Status de um fluxo
  const st = /(?:verifique|verifica|checar|cheque|confira|veja)\s+(?:se\s+)?(?:o|a)\s+(?:fluxo|automa[cç][aã]o|workflow)\s+(?:de\s+|do\s+|da\s+)?(.+?)\s+(?:est[aá]|ta)\s+(?:funcionando|rodando|ok)/iu.exec(clean)
    ?? /(?:status|situa[cç][aã]o)\s+(?:da|do)\s+(?:automa[cç][aã]o|fluxo|workflow)\s+(?:de\s+|do\s+|da\s+)?(.+)$/iu.exec(clean);
  if (st) return { kind: 'calls', calls: [{ tool: 'get_workflow_execution_status', input: { automation: cleanTitle(st[1]) } }] };
  if (/^(quais|liste|lista|mostre|mostra|me mostre)\b.*(automac|workflows?)\b/.test(n)) return { kind: 'calls', calls: [{ tool: 'list_automations', input: {} }] };

  // Central executiva
  if (/(briefing|resumo|panorama|visao geral)\s+(empresarial|executivo|das empresas|dos (meus )?(projetos|negocios))/.test(n) || /^como (estao|estao as|vao) (as )?(minhas )?empresas/.test(n)) {
    return { kind: 'calls', calls: [{ tool: 'business_briefing', input: {} }] };
  }
  if (/(radar de pendencias|o que (precisa|exige) (da )?minha atencao|pendencias criticas|o que esta atrasado)/.test(n)) return { kind: 'calls', calls: [{ tool: 'get_pending_radar', input: {} }] };
  if (/relatorio semanal|resumo da semana|relatorio da semana/.test(n)) return { kind: 'calls', calls: [{ tool: 'generate_weekly_report', input: {} }] };
  if (/(organiz\w*|planej\w*|monte|montar)\s+(o\s+|a\s+)?(meu dia|minha manha|minha tarde|minha agenda de hoje|o dia)/.test(n)) {
    const t = extractTemporal(original, ctx);
    return { kind: 'special', special: { action: 'plan_day', date: t.date ? localDateKey(t.date) : undefined } };
  }

  // Despesas
  if (/^(registre|registrar|registra|lance|lancar|lanca|anote|anota)\s+(uma\s+)?(despesa|gasto)|^gastei\b/.test(n)) {
    const amount = parseMoneyText(n);
    if (!amount) return { kind: 'reply', reply: 'Qual foi o valor da despesa? Ex.: “registre despesa de 120 reais com hospedagem”.' };
    const desc = /(?:com|de|em|no|na|para)\s+([^\d][^,]*)$/iu.exec(clean.replace(/r\$\s*[\d.,]+|[\d.,]+\s*(reais|real)/i, ' ').replace(/\s+/g, ' '));
    const t = extractTemporal(original, ctx);
    const input: Record<string, unknown> = { amount };
    if (desc) input.description = cleanTitle(desc[1].replace(/^(despesa|gasto)\s+/i, ''));
    if (t.date) input.date = localDateKey(t.date);
    return { kind: 'calls', calls: [{ tool: 'register_expense', input }] };
  }

  // Follow-up
  const fu = /(?:follow[\s-]?up|retorno|retornar)\s+(?:com|para|ao|a)\s+(?:o\s+|a\s+)?([A-ZÁÉÍÓÚÂÊÔ][\p{L}]+(?:\s+[A-ZÁÉÍÓÚÂÊÔ][\p{L}]+)?)(.*)$/u.exec(clean);
  if (fu) {
    const t = extractTemporal(fu[2], ctx);
    if (!t.date) return { kind: 'reply', reply: `Para quando devo agendar o follow-up com ${fu[1]}?` };
    const about = cleanTitle(t.rest.replace(/^(sobre|a respeito d[oa])\s+/i, ''));
    return { kind: 'calls', calls: [{ tool: 'create_follow_up', input: { who: fu[1], ...(about ? { about } : {}), due: toLocalDT(t.date, t.time) } }] };
  }

  // Perguntas sobre empresas do ecossistema
  const proj = PROJECT_WORDS.find(([re]) => re.test(n));
  const aboutMyNotes = /(ideia|anotac|anotei|registrei|nota|escrevi|salvei)/.test(n);
  if (proj && !aboutMyNotes && /^(quant|qual|quais|como|me mostre|mostre|mostra|liste|compare|existem|tem|ha|gere|resum|status|indicador|o que|prioridad)/.test(n)) {
    return { kind: 'special', special: { action: 'project_query', project: proj[1], text: original } };
  }
  return null;
}
