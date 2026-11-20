import { describe, it, expect } from 'vitest';
import { extractTemporal, parseCommand, parseAmount, cleanTitle } from './nlu.ts';
import { expandOccurrences, nextOccurrence, describeRule } from './recurrence.ts';
import { localIsoToUtc, toLocalIso, zonedToUtc, dayRangeUtc } from '../time.ts';
import { localDateKey } from '../time.ts';

const ctx = { now: new Date('2026-11-19T13:00:00.000Z'), tz: 'America/Bahia' }; // qui 10:00
const t = (s: string) => {
  const r = extractTemporal(s, ctx);
  return { date: r.date && localDateKey(r.date), time: r.time && `${r.time.h}:${String(r.time.m).padStart(2, '0')}`, rest: r.rest, dur: r.durationMin, before: r.remindBeforeMin, rec: r.recurrence };
};

describe('extração temporal', () => {
  it.each([
    ['amanhã às 9', '2026-11-20', '9:00'],
    ['hoje às 15h30', '2026-11-19', '15:30'],
    ['depois de amanhã às 8 da noite', '2026-11-21', '20:00'],
    ['sexta às 11h', '2026-11-20', '11:00'],
    ['na quinta', '2026-11-26', undefined],
    ['segunda-feira que vem às 7', '2026-11-23', '7:00'],
    ['dia 25 às 14:00', '2026-11-25', '14:00'],
    ['25/12 ao meio-dia', '2026-12-25', '12:00'],
    ['3 de janeiro às 10h', '2027-01-03', '10:00'],
    ['às 3 da tarde', undefined, '15:00'],
    ['às nove e meia', undefined, '9:30'],
    ['daqui a 30 minutos', '2026-11-19', '10:30'],
    ['em 2 horas', '2026-11-19', '12:00'],
  ])('%s', (input, date, time) => {
    const r = t(input);
    expect(r.date).toBe(date);
    expect(r.time).toBe(time);
  });

  it('duração, antecedência e recorrência', () => {
    expect(t('reunião amanhã às 11h, duração de uma hora e meia').dur).toBe(90);
    expect(t('foco por 45 minutos').dur).toBe(45);
    expect(t('me avise 15 minutos antes').before).toBe(15);
    expect(t('treino toda segunda, quarta e sexta às 7h').rec).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(t('leitura todos os dias às 21h').rec).toBe('FREQ=DAILY');
    expect(t('standup de segunda a sexta às 9h').rec).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('não confunde “segunda” ordinal com dia da semana', () => {
    expect(t('revisar a segunda versão do contrato').date).toBeUndefined();
  });

  it('quantidades', () => {
    expect(parseAmount('meia hora')).toBe(30);
    expect(parseAmount('uma hora')).toBe(60);
    expect(parseAmount('1h30')).toBe(90);
    expect(parseAmount('duas horas e meia')).toBe(150);
  });

  it('limpeza de título', () => {
    expect(cleanTitle(' para a academia de ')).toBe('Academia');
  });
});

describe('classificação de intenção', () => {
  const kind = (s: string) => {
    const r = parseCommand(s, ctx);
    return r.kind === 'calls' ? r.calls.map((c) => c.tool).join('+') : r.kind === 'special' ? `special:${r.special.action}` : r.kind;
  };
  it.each([
    ['Jarvis, quais são meus compromissos de amanhã?', 'list_events'],
    ['Jarvis, marque reunião com João sexta-feira às 11h.', 'create_event'],
    ['Jarvis, crie uma anotação sobre minha nova ideia.', 'clarify'],
    ['Jarvis, reorganize minhas tarefas por prioridade.', 'list_tasks'],
    ['Jarvis, transforme essa anotação em um projeto.', 'special:note_to_project'],
    ['Jarvis, me mostre o que ficou pendente ontem.', 'list_tasks'],
    ['Jarvis, quais ideias eu já registrei sobre a Connectfly?', 'search_personal_knowledge'],
    ['Jarvis, iniciar modo foco por 45 minutos no projeto Connectfly.', 'start_focus_session'],
    ['Jarvis, organiza minha manhã.', 'special:plan_day'],
    ['Jarvis, encontre tudo que registrei sobre a reunião de terça.', 'search_personal_knowledge'],
    ['parar modo foco', 'special:stop_focus'],
    ['desmarque a reunião de sexta', 'special:delete'],
    ['quais tarefas tenho hoje?', 'list_tasks'],
    ['o que tenho na semana que vem?', 'list_events+list_tasks'],
  ])('%s → %s', (input, expected) => expect(kind(input)).toBe(expected));

  it('reunião com participantes e duração', () => {
    const r = parseCommand('Jarvis, reunião com a equipe amanhã às 11h, duração de uma hora.', ctx);
    expect(r.kind).toBe('calls');
    if (r.kind === 'calls') expect(r.calls[0].input).toMatchObject({ title: 'Reunião com a equipe', start: '2026-11-20T11:00', duration_minutes: 60 });
  });
});

describe('fuso horário e recorrência', () => {
  it('converte horário local de Salvador para UTC', () => {
    expect(localIsoToUtc('2026-11-20T09:00', 'America/Bahia').date.toISOString()).toBe('2026-11-20T12:00:00.000Z');
    expect(toLocalIso('2026-11-20T12:00:00.000Z', 'America/Bahia')).toBe('2026-11-20T09:00');
  });
  it('funciona em fusos com horário de verão', () => {
    // Nova York: 8 de março de 2026 muda para EDT
    expect(zonedToUtc(2026, 3, 9, 9, 0, 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z');
    expect(zonedToUtc(2026, 3, 6, 9, 0, 'America/New_York').toISOString()).toBe('2026-03-06T14:00:00.000Z');
  });
  it('intervalo do dia local', () => {
    const r = dayRangeUtc({ year: 2026, month: 11, day: 19 }, 'America/Bahia');
    expect(r.start.toISOString()).toBe('2026-11-19T03:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-20T03:00:00.000Z');
  });
  it('expande ocorrências semanais com exceções', () => {
    const occ = expandOccurrences('FREQ=WEEKLY;BYDAY=MO,WE,FR', { year: 2026, month: 11, day: 16 }, { year: 2026, month: 11, day: 16 }, { year: 2026, month: 11, day: 29 }, ['2026-11-18']);
    expect(occ.map(localDateKey)).toEqual(['2026-11-16', '2026-11-20', '2026-11-23', '2026-11-25', '2026-11-27']);
  });
  it('próxima ocorrência mensal e diária', () => {
    expect(localDateKey(nextOccurrence('FREQ=MONTHLY', { year: 2026, month: 1, day: 15 }, { year: 2026, month: 1, day: 15 })!)).toBe('2026-02-15');
    expect(localDateKey(nextOccurrence('FREQ=DAILY;INTERVAL=2', { year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 1 })!)).toBe('2026-01-03');
    expect(nextOccurrence('FREQ=DAILY;UNTIL=20260102', { year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 2 })).toBeNull();
  });
  it('descreve regras em português', () => {
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('toda segunda, quarta e sexta');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('de segunda a sexta');
  });
});
