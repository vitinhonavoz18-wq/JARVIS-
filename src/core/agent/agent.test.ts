import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepo } from '../data/memoryRepo.ts';
import { VOICE_STYLE, runAgent, type AgentOutput, type LlmProvider } from './agent.ts';
import type { ToolContext } from './tools.ts';
import type { ConversationState } from '../types.ts';
import { toLocalIso } from '../time.ts';

// Quinta-feira, 19/11/2026, 10:00 em America/Bahia (UTC-3)
const NOW = new Date('2026-11-19T13:00:00.000Z');
const TZ = 'America/Bahia';

let repo: MemoryRepo;
let ctx: ToolContext;
let state: ConversationState | null;

function makeCtx(r: MemoryRepo, now = NOW): ToolContext {
  return {
    repo: r, now, tz: TZ, source: 'ai',
    prefs: { display_name: 'Franklin', assistant_name: 'JARVIS', default_reminder_minutes: 15, memory_enabled: true, memory_categories: [], timezone: TZ },
  };
}

async function say(text: string, extra: Partial<Parameters<typeof runAgent>[0]> = {}): Promise<AgentOutput> {
  const out = await runAgent({ text, ctx, state, history: [], requestId: crypto.randomUUID(), ...extra });
  state = out.state;
  return out;
}

const local = (iso: string | null) => (iso ? toLocalIso(iso, TZ) : null);

beforeEach(() => {
  repo = new MemoryRepo('user-a');
  ctx = makeCtx(repo);
  state = null;
});

describe('Cenário 1 — criar tarefa por voz', () => {
  it('“Jarvis, academia amanhã às 9.” cria tarefa na data correta', async () => {
    const out = await say('Jarvis, academia amanhã às 9.');
    const tasks = await repo.table('tasks').list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Academia');
    expect(local(tasks[0].due_at)).toBe('2026-11-20T09:00');
    expect(out.reply).toContain('amanhã, às 9h');
  });

  it('“anote academia amanhã às 9 da manhã e me avise meia hora antes” agenda lembrete às 8h30', async () => {
    const out = await say('Jarvis, anote academia amanhã às 9 da manhã e me avise meia hora antes.');
    const [task] = await repo.table('tasks').list();
    const [rem] = await repo.table('reminders').list();
    expect(task.title).toBe('Academia');
    expect(local(task.due_at)).toBe('2026-11-20T09:00');
    expect(local(rem.remind_at)).toBe('2026-11-20T08:30');
    expect(rem.entity_id).toBe(task.id);
    expect(out.reply).toMatch(/Vou te lembrar às 8h30/);
  });

  it('não duplica quando o mesmo comando é repetido', async () => {
    await say('academia amanhã às 9');
    await say('academia amanhã às 9');
    expect(await repo.table('tasks').list()).toHaveLength(1);
  });
});

describe('Cenário 2 — lembrete', () => {
  beforeEach(() => {
    ctx = makeCtx(repo, new Date('2026-11-19T12:00:00.000Z')); // 9h local
  });
  it('“me lembre da reunião às 11h, uma hora antes” usa o evento existente', async () => {
    await say('marque reunião com a equipe hoje às 11h');
    const out = await say('Jarvis, me lembre da reunião às 11h, uma hora antes.');
    const rems = await repo.table('reminders').list();
    expect(rems).toHaveLength(1);
    expect(local(rems[0].remind_at)).toBe('2026-11-19T10:00');
    expect(rems[0].entity_type).toBe('event');
    expect(out.reply).toContain('Vou te lembrar às 10h');
    expect(await repo.table('tasks').list()).toHaveLength(0);
  });

  it('sem evento existente, cria a tarefa com lembrete', async () => {
    await say('me lembre da reunião às 11h, uma hora antes');
    const [task] = await repo.table('tasks').list();
    const [rem] = await repo.table('reminders').list();
    expect(local(task.due_at)).toBe('2026-11-19T11:00');
    expect(local(rem.remind_at)).toBe('2026-11-19T10:00');
  });

  it('“me lembre de ligar para o cliente às 15h” cria lembrete hoje às 15h', async () => {
    const out = await say('Jarvis, me lembre de ligar para o cliente às 15h');
    const [task] = await repo.table('tasks').list();
    const [rem] = await repo.table('reminders').list();
    expect(task.title).toBe('Ligar para o cliente');
    expect(local(rem.remind_at)).toBe('2026-11-19T15:00');
    expect(out.reply).toContain('hoje, às 15h');
  });

  it('pergunta o dia quando o horário de hoje já passou', async () => {
    const out = await say('me lembre de pagar a conta às 7h');
    expect(out.reply).toMatch(/já passou/);
    expect(await repo.table('tasks').list()).toHaveLength(0);
    const out2 = await say('amanhã');
    expect(out2.reply).toContain('amanhã, às 7h');
    const [rem] = await repo.table('reminders').list();
    expect(local(rem.remind_at)).toBe('2026-11-20T07:00');
  });

  it('“me lembre de tomar uma decisão sobre o projeto amanhã às 14h” persiste lembrete', async () => {
    await say('Jarvis, me lembre de tomar uma decisão sobre o projeto amanhã às 14h.');
    const [rem] = await repo.table('reminders').list();
    expect(rem.status).toBe('pending');
    expect(local(rem.remind_at)).toBe('2026-11-20T14:00');
  });
});

describe('Cenário 3 — anotação', () => {
  it('cria nota e a encontra pela pesquisa', async () => {
    const out = await say('Jarvis, anote que preciso estudar novas estratégias de vendas.');
    expect(out.actions[0].tool).toBe('create_note');
    const [note] = await repo.table('notes').list();
    expect(note.content_text).toBe('Preciso estudar novas estratégias de vendas');
    const s = await say('encontre tudo sobre estratégias de vendas');
    expect(s.reply).toContain('Preciso estudar novas estratégias de vendas');
  });

  it('ideias são registradas e recuperadas por tema', async () => {
    await say('Jarvis, tive uma ideia para melhorar o FlyDelivery. Quero criar uma nova funcionalidade de atendimento.');
    await say('tive uma ideia para a Connectfly: landing page nova');
    const [n1] = await repo.table('notes').list({ search: { fields: ['content_text'], q: 'FlyDelivery' } });
    expect(n1.folder).toBe('Ideias');
    expect(n1.tags).toContain('FlyDelivery');
    const out = await say('Jarvis, me mostre todas as ideias que tive sobre o FlyDelivery.');
    expect(out.reply).toContain('FlyDelivery');
    expect(out.reply).not.toContain('Connectfly');
  });

  it('“tive uma ideia” sem conteúdo abre a captura', async () => {
    const out = await say('Jarvis, tive uma ideia.');
    expect(out.reply).toMatch(/estou anotando/);
    await say('um app de receitas com IA');
    const [note] = await repo.table('notes').list();
    expect(note.content_text).toBe('Um app de receitas com IA');
    expect(note.folder).toBe('Ideias');
  });
});

describe('Cenário 4 — consultar agenda', () => {
  it('responde somente com dados reais', async () => {
    const empty = await say('Jarvis, o que tenho para amanhã?');
    expect(empty.reply).toBe('Você não tem compromissos nem tarefas para amanhã.');
    await say('marque reunião com João amanhã às 11h, duração de uma hora');
    await say('academia amanhã às 7');
    const out = await say('o que tenho para amanhã?');
    expect(out.reply).toContain('Reunião com João');
    expect(out.reply).toContain('Academia');
    expect(out.reply).toContain('11h');
  });
});

describe('Cenário 5 — atualizar tarefa', () => {
  it('“altere a academia de amanhã para 7h” atualiza sem duplicar', async () => {
    await say('anote academia amanhã às 9h e me avise meia hora antes');
    const out = await say('Jarvis, altere a academia de amanhã para 7h.');
    const tasks = await repo.table('tasks').list();
    expect(tasks).toHaveLength(1);
    expect(local(tasks[0].due_at)).toBe('2026-11-20T07:00');
    const [rem] = await repo.table('reminders').list();
    expect(local(rem.remind_at)).toBe('2026-11-20T06:30');
    expect(out.reply).toContain('remarcada');
  });

  it('remarca evento pelo título', async () => {
    await say('marque reunião com João sexta às 11h');
    await say('passe a reunião com João para 14h');
    const [ev] = await repo.table('calendar_events').list();
    expect(local(ev.start_at)).toBe('2026-11-20T14:00');
    expect(local(ev.end_at)).toBe('2026-11-20T15:00');
  });
});

describe('Cenário 6 — persistência após recarregar', () => {
  it('dados sobrevivem a uma nova instância do repositório', async () => {
    const store = new Map<string, unknown[]>();
    const adapter = { load: (t: string) => store.get(t) ?? null, save: (t: string, r: unknown[]) => void store.set(t, JSON.parse(JSON.stringify(r))) };
    const r1 = new MemoryRepo('user-a', adapter);
    ctx = makeCtx(r1);
    await say('academia amanhã às 9');
    await say('anote que preciso revisar o contrato');
    const r2 = new MemoryRepo('user-a', adapter);
    expect(await r2.table('tasks').list()).toHaveLength(1);
    expect(await r2.table('notes').list()).toHaveLength(1);
    expect(await r2.table('reminders').list()).toHaveLength(0);
  });
});

describe('Cenário 8 — falha da IA', () => {
  it('mensagem clara e nada marcado como concluído', async () => {
    const failing: LlmProvider = { chat: async () => { throw new Error('provedor indisponível (503)'); } };
    const out = await say('faça uma análise profunda dos meus hábitos financeiros', { llm: failing });
    expect(out.error).toBe(true);
    expect(out.reply).toContain('Nenhuma alteração foi feita');
    expect(await repo.table('ai_action_logs').list({ eq: { status: 'success' } })).toHaveLength(0);
  });

  it('sem IA configurada, informa honestamente', async () => {
    const out = await say('qual é o sentido da vida?');
    expect(out.reply).toContain('não está configurado');
  });

  it('com IA, executa ferramentas e confirma apenas após persistir', async () => {
    let step = 0;
    const llm: LlmProvider = {
      chat: async () => {
        step++;
        if (step === 1) return { text: '', toolCalls: [{ id: 't1', name: 'create_task', input: { title: 'Planejar viagem', due: '2026-11-25T10:00', priority: 'high' } }] };
        return { text: 'Feito: tarefa “Planejar viagem” criada para quarta às 10h.', toolCalls: [] };
      },
    };
    const out = await say('preciso que você cuide do planejamento da minha viagem com alta prioridade', { llm });
    expect(out.via).toBe('ai');
    const [task] = await repo.table('tasks').list();
    expect(task.priority).toBe('high');
    expect(out.actions[0].ok).toBe(true);
  });

  it('instrução de frases curtas só vale na conversa por voz', async () => {
    const systems: string[] = [];
    const llm: LlmProvider = { chat: async (req) => { systems.push(req.system); return { text: 'ok', toolCalls: [] }; } };
    await say('qual é o sentido da vida?', { llm });
    await say('qual é o sentido da vida?', { llm, ctx: { ...ctx, source: 'voice' } });
    expect(systems[0]).not.toContain(VOICE_STYLE);
    expect(systems[1]).toContain(VOICE_STYLE);
  });

  it('IA não executa ação destrutiva sem confirmação', async () => {
    await say('academia amanhã às 9');
    const [task] = await repo.table('tasks').list();
    let step = 0;
    const llm: LlmProvider = {
      chat: async () => (++step === 1 ? { text: '', toolCalls: [{ id: 'x', name: 'delete_task', input: { task_id: task.id } }] } : { text: 'Aguardo sua confirmação.', toolCalls: [] }),
    };
    const out = await say('some com aquele treino de amanhã, não vou mais', { llm });
    expect(out.proposal?.calls[0].tool).toBe('delete_task');
    expect((await repo.table('tasks').get(task.id))?.deleted_at).toBeNull();
    await say('sim');
    expect((await repo.table('tasks').get(task.id))?.deleted_at).not.toBeNull();
  });
});

describe('Cenário 9 — comando ambíguo', () => {
  it('“marque uma reunião às 11h” pergunta o dia e não cria nada', async () => {
    const out = await say('Jarvis, marque uma reunião às 11h.');
    expect(out.reply).toMatch(/Para qual dia/);
    expect(await repo.table('calendar_events').list()).toHaveLength(0);
    const out2 = await say('sexta-feira');
    const [ev] = await repo.table('calendar_events').list();
    expect(local(ev.start_at)).toBe('2026-11-20T11:00');
    expect(out2.reply).toContain('Reunião agendado');
  });
});

describe('Cenário 10 — isolamento entre usuários (camada de repositório)', () => {
  it('usuário B não enxerga nem altera dados do usuário A', async () => {
    const store = new Map<string, unknown[]>();
    const adapter = { load: (t: string) => store.get(t) ?? null, save: (t: string, r: unknown[]) => void store.set(t, r) };
    const a = new MemoryRepo('user-a', adapter);
    const b = new MemoryRepo('user-b', adapter);
    const task = await a.table('tasks').insert({ title: 'Segredo' });
    expect(await b.table('tasks').list()).toHaveLength(0);
    expect(await b.table('tasks').get(task.id)).toBeNull();
    await expect(b.table('tasks').update(task.id, { title: 'hack' })).rejects.toThrow();
  });
});

describe('Recorrência, confirmação e outros fluxos', () => {
  it('tarefa recorrente segunda, quarta e sexta às 7h gera a próxima ao concluir', async () => {
    const out = await say('Jarvis, crie uma tarefa de treino toda segunda, quarta e sexta às 7h.');
    const [t1] = await repo.table('tasks').list();
    expect(t1.title).toBe('Treino');
    expect(t1.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(local(t1.due_at)).toBe('2026-11-20T07:00'); // sexta
    expect(out.reply).toContain('toda segunda, quarta e sexta');
    await say('concluí treino');
    const open = await repo.table('tasks').list({ eq: { status: 'todo' } });
    expect(open).toHaveLength(1);
    expect(local(open[0].due_at)).toBe('2026-11-23T07:00'); // segunda
  });

  it('captura múltipla pede confirmação e cria nos módulos certos', async () => {
    const out = await say('Jarvis, preciso comprar um presente, estudar inteligência artificial e tive uma ideia para meu aplicativo.');
    expect(out.proposal?.calls.map((c) => c.tool)).toEqual(['create_task', 'create_task', 'create_note']);
    expect(await repo.table('tasks').list()).toHaveLength(0);
    await say('sim');
    const titles = (await repo.table('tasks').list()).map((t) => t.title).sort();
    expect(titles).toEqual(['Comprar um presente', 'Estudar inteligência artificial']);
    expect(await repo.table('notes').list()).toHaveLength(1);
  });

  it('projeto: criar e dividir em etapas com aprovação', async () => {
    await say('Jarvis, crie um projeto chamado Nova Landing Page da Connectfly.');
    const [p] = await repo.table('projects').list();
    expect(p.name).toBe('Nova Landing Page da Connectfly');
    const out = await say('Jarvis, organize esse projeto em etapas.');
    expect(out.proposal).toBeTruthy();
    await say('pode');
    const tasks = await repo.table('tasks').list({ eq: { project_id: p.id } });
    expect(tasks.map((t) => t.title)).toContain('Desenvolvimento');
  });

  it('memória só é gravada após autorização', async () => {
    const out = await say('Jarvis, lembre que prefiro reuniões de trabalho pela manhã.');
    expect(out.proposal).toBeTruthy();
    expect(await repo.table('user_memories').list()).toHaveLength(0);
    await say('sim');
    const [m] = await repo.table('user_memories').list();
    expect(m.content).toBe('Prefiro reuniões de trabalho pela manhã');
    expect(m.category).toBe('horarios');
  });

  it('modo foco associado ao projeto', async () => {
    await say('crie um projeto chamado Connectfly');
    const out = await say('Jarvis, iniciar modo foco por 45 minutos no projeto Connectfly.');
    const [s] = await repo.table('focus_sessions').list();
    expect(s.planned_minutes).toBe(45);
    expect(s.project_id).not.toBeNull();
    expect(out.reply).toContain('45 min');
  });

  it('pendências de ontem consideram apenas tarefas reais', async () => {
    await repo.table('tasks').insert({ title: 'Enviar proposta', due_at: '2026-11-18T18:00:00.000Z' });
    await repo.table('tasks').insert({ title: 'Feita', due_at: '2026-11-18T19:00:00.000Z', status: 'done' });
    const out = await say('Jarvis, me mostre o que ficou pendente ontem.');
    expect(out.reply).toContain('Enviar proposta');
    expect(out.reply).not.toContain('Feita');
  });

  it('briefing usa dados reais e saudação personalizada', async () => {
    await say('marque reunião com a equipe hoje às 11h');
    await repo.table('tasks').insert({ title: 'Revisar orçamento', due_at: '2026-11-19T17:00:00.000Z', priority: 'high' });
    const out = await say('bom dia');
    expect(out.reply).toMatch(/^Bom dia, Franklin\./);
    expect(out.reply).toContain('1 compromisso');
    expect(out.reply).toContain('Revisar orçamento');
  });

  it('exclusão pede confirmação', async () => {
    await say('academia amanhã às 9');
    const out = await say('apague a tarefa academia');
    expect(out.proposal).toBeTruthy();
    await say('não');
    const [t] = await repo.table('tasks').list();
    expect(t.deleted_at).toBeNull();
  });

  it('“o que posso deixar para amanhã” propõe sem alterar', async () => {
    await repo.table('tasks').insert({ title: 'Organizar arquivos', due_at: '2026-11-19T20:00:00.000Z', priority: 'low' });
    await repo.table('tasks').insert({ title: 'Entrega cliente', due_at: '2026-11-19T18:00:00.000Z', priority: 'urgent' });
    const out = await say('Jarvis, hoje estou muito ocupado. O que posso deixar para amanhã?');
    expect(out.proposal?.items[0]).toContain('Organizar arquivos');
    const t = (await repo.table('tasks').list()).find((x) => x.title === 'Organizar arquivos')!;
    expect(local(t.due_at)).toBe('2026-11-19T17:00');
    await say('sim');
    expect(local((await repo.table('tasks').get(t.id))!.due_at)).toBe('2026-11-20T17:00');
  });

  it('idempotência: a mesma requisição não executa duas vezes', async () => {
    const id = crypto.randomUUID();
    await runAgent({ text: 'anote que comprar café', ctx, state: null, history: [], requestId: id });
    await runAgent({ text: 'anote que comprar café', ctx, state: null, history: [], requestId: id });
    expect(await repo.table('notes').list()).toHaveLength(1);
  });

  it('hábito: registrar treino e contar progresso da semana', async () => {
    await say('crie uma rotina de treino toda segunda, quarta, quinta e sexta às 7h');
    await say('fiz treino');
    const out = await say('como estou indo na semana?');
    expect(out.reply).toContain('Treino: 1 de 4 sessões planejadas');
  });
});
