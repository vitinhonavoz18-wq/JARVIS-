import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepo, uuid } from '../data/memoryRepo.ts';
import { runAgent, type AgentOutput } from './agent.ts';
import type { ToolContext } from './tools.ts';
import type { AutomationRun, ConversationState } from '../types.ts';
import type { IntegrationServices } from '../integration/services.ts';
import { toLocalIso } from '../time.ts';
import { parseCommand } from './nlu.ts';
import { routeSpecialist } from './specialists.ts';
import { buildWorkflowDraft } from '../integration/workflowBuilder.ts';

const NOW = new Date('2026-11-20T12:00:00.000Z'); // sexta 9h em Salvador
const TZ = 'America/Bahia';
let repo: MemoryRepo;
let state: ConversationState | null;
let services: IntegrationServices | null;
let calls: string[];

const ctx = (): ToolContext => ({
  repo, now: NOW, tz: TZ, source: 'ai', services,
  prefs: { display_name: 'Franklin', assistant_name: 'JARVIS', default_reminder_minutes: 15, memory_enabled: true, memory_categories: [], timezone: TZ },
});

async function say(text: string): Promise<AgentOutput> {
  const out = await runAgent({ text, ctx: ctx(), state, history: [], requestId: uuid() });
  state = out.state;
  return out;
}

function fakeServices(finalStatus: AutomationRun['status'] = 'started'): IntegrationServices {
  return {
    async runAutomation(req) {
      calls.push(`run:${req.automationId}:${JSON.stringify(req.input)}`);
      const run = await repo.table('automation_runs').insert({ requested_at: NOW.toISOString(), automation_id: req.automationId, status: finalStatus, input: req.input, source: req.source, output_summary: finalStatus === 'succeeded' ? '12 vendas' : null });
      return { ok: true, run, message: 'ok' };
    },
    async refreshRun(id) {
      const run = await repo.table('automation_runs').update(id, { status: 'succeeded', output_summary: 'concluído no n8n' });
      return { ok: true, run, message: 'ok' };
    },
    async projectAction(projectId, capability) {
      calls.push(`project:${projectId}:${capability}`);
      return { ok: true, data: capability === 'stock.low' ? [{ produto: 'Moura 60Ah', estoque: 2 }] : { empresas_ativas: 42 }, source: 'FlyDelivery API', fetchedAt: NOW.toISOString() };
    },
    async projectHealth() {
      return { status: 'healthy', detail: 'ok', checkedAt: NOW.toISOString() };
    },
    async createWorkflowDraft() {
      calls.push('draft');
      return { ok: true, workflowId: '99', message: 'ok' };
    },
  };
}

beforeEach(async () => {
  repo = new MemoryRepo('u1');
  state = null;
  services = fakeServices();
  calls = [];
  const conn = await repo.table('automation_connections').insert({ name: 'n8n Connectfly', base_url: 'https://n8n.test', status: 'connected', environment: 'production' } as never);
  await repo.table('automations').insert({ connection_id: conn.id, name: 'Relatório de vendas', aliases: ['vendas'], webhook_url: 'https://n8n.test/webhook/vendas', risk: 'read', requires_confirmation: false, input_schema: { type: 'object', properties: { periodo: { type: 'string', enum: ['semana', 'mes'] } } } });
  await repo.table('automations').insert({ connection_id: conn.id, name: 'Sincronização de projetos', webhook_url: 'https://n8n.test/webhook/sync', risk: 'external', requires_confirmation: true });
});

describe('Automation Engine — execução por comando', () => {
  it('automação de leitura executa direto e NÃO diz concluída quando só foi iniciada', async () => {
    const out = await say('Jarvis, execute a automação de relatório de vendas.');
    expect(calls[0]).toMatch(/^run:/);
    expect(out.reply).toContain('iniciada no n8n');
    expect(out.reply).not.toMatch(/conclu[ií]da com sucesso/);
    expect(out.specialist).toBe('automation');
  });

  it('automação externa exige confirmação antes de disparar', async () => {
    const out = await say('Jarvis, execute a sincronização autorizada dos meus projetos.');
    expect(out.proposal).toBeTruthy();
    expect(calls).toHaveLength(0);
    await say('sim');
    expect(calls).toHaveLength(1);
  });

  it('status consulta o n8n quando a execução ainda está ativa', async () => {
    await say('execute a automação de relatório de vendas');
    const out = await say('Jarvis, verifique se o fluxo de vendas está funcionando.');
    expect(out.reply).toContain('concluída com sucesso');
  });

  it('valida parâmetros contra o esquema registrado', async () => {
    const r = await runAgent({ text: 'x', ctx: ctx(), state: null, history: [], llm: { chat: async () => ({ text: '', toolCalls: [{ id: '1', name: 'execute_approved_workflow', input: { automation: 'vendas', input: { periodo: 'ano' } } }] }) } });
    expect(r.actions[0].ok).toBe(false);
    expect(r.actions[0].summary).toMatch(/fora das opções/);
    expect(calls).toHaveLength(0);
  });

  it('lista falhas de hoje com dados reais', async () => {
    const a = (await repo.table('automations').list())[0];
    await repo.table('automation_runs').insert({ automation_id: a.id, status: 'failed', error: 'credencial expirada', requested_at: NOW.toISOString() } as never);
    const out = await say('Jarvis, mostre os workflows que falharam hoje.');
    expect(out.reply).toContain('credencial expirada');
  });

  it('sem servidor (Modo Local), informa que exige o Modo Nuvem', async () => {
    services = null;
    const out = await say('execute a automação de relatório de vendas');
    expect(out.reply).toMatch(/Modo Nuvem/);
  });

  it('criar automação com IA gera rascunho e pede aprovação', async () => {
    const out = await say('Jarvis, quero que toda segunda-feira às 8h seja preparado um relatório das vendas da semana anterior.');
    expect(out.proposal?.items.join(' ')).toContain('0 8 * * MON');
    expect(calls).toHaveLength(0);
    await say('sim');
    expect(calls).toContain('draft');
  });
});

describe('Projetos e Central Executiva', () => {
  it('projeto não conectado → dado indisponível, sem inventar', async () => {
    const out = await say('Jarvis, quantas empresas estão ativas no FlyDelivery?');
    expect(out.reply).toMatch(/não está conectado|indisponível/);
    expect(out.reply).not.toMatch(/\d{2} empresas/);
  });

  it('projeto conectado → dado com fonte e horário', async () => {
    await repo.table('connected_projects').insert({ name: 'FlyDelivery', template: 'flydelivery', connector_type: 'http', base_url: 'https://fly.test' });
    const out = await say('Jarvis, quantas empresas estão ativas no FlyDelivery?');
    expect(out.reply).toContain('empresas ativas: 42');
    expect(out.reply).toContain('fonte: FlyDelivery API');
    expect(out.specialist).toBe('analyst');
  });

  it('estoque baixo usa a capacidade correta', async () => {
    await repo.table('connected_projects').insert({ name: 'TG Baterias', template: 'tg_baterias', connector_type: 'http', base_url: 'https://tg.test' });
    const out = await say('Jarvis, quais baterias estão com estoque baixo?');
    expect(calls.some((c) => c.endsWith(':stock.low'))).toBe(true);
    expect(out.reply).toContain('Moura 60Ah');
  });

  it('briefing empresarial e radar de pendências com dados reais', async () => {
    await repo.table('tasks').insert({ title: 'Enviar proposta', due_at: '2026-11-18T15:00:00.000Z', priority: 'high' });
    await repo.table('alerts').insert({ title: 'Integração iFood com erro', severity: 'critical' });
    const b = await say('Jarvis, faça meu briefing empresarial.');
    expect(b.reply).toContain('Nenhuma empresa conectada');
    expect(b.reply).toContain('Integração iFood com erro');
    const r = await say('radar de pendências');
    expect(r.reply).toContain('Enviar proposta');
    expect(r.reply.indexOf('🔴')).toBeGreaterThanOrEqual(0);
  });

  it('privacidade: projeto agregado não expõe registros de clientes', async () => {
    await repo.table('connected_projects').insert({ name: 'Farmácia Preço Bom', template: 'farmacia_preco_bom', connector_type: 'http', base_url: 'https://f.test' });
    const r = await runAgent({ text: 'x', ctx: ctx(), state: null, history: [], llm: { chat: async () => ({ text: '', toolCalls: [{ id: '1', name: 'search_customer_records', input: { project: 'Farmácia', query: 'Maria' } }] }) } });
    expect(JSON.stringify(r)).not.toContain('project:');
    expect(calls.filter((c) => c.includes('customers'))).toHaveLength(0);
  });
});

describe('Planejador, despesas, follow-up e especialistas', () => {
  it('organiza o dia encaixando tarefas sem horário, sem mover compromissos, após aprovação', async () => {
    await repo.table('calendar_events').insert({ title: 'Reunião', start_at: '2026-11-20T13:00:00.000Z', end_at: '2026-11-20T14:00:00.000Z' });
    const t = await repo.table('tasks').insert({ title: 'Revisar contrato', due_at: '2026-11-20T03:00:00.000Z', all_day: true, priority: 'high' });
    const out = await say('Jarvis, organize meu dia com base na minha agenda.');
    expect(out.proposal).toBeTruthy();
    await say('sim');
    const updated = await repo.table('tasks').get(t.id);
    const start = toLocalIso(updated!.due_at!, TZ);
    expect(start >= '2026-11-20T09:00').toBe(true);
    expect(start.slice(11) === '10:00').toBe(false); // não colide com a reunião das 10h
    const ev = (await repo.table('calendar_events').list())[0];
    expect(ev.start_at).toBe('2026-11-20T13:00:00.000Z');
  });

  it('planejador também encaixa tarefas sem data, por prioridade', async () => {
    await repo.table('tasks').insert({ title: 'Estudar inglês', priority: 'high' });
    const out = await say('organize meu dia');
    expect(out.proposal?.items.join(' ')).toContain('Estudar inglês');
  });

  it('registra despesa com valor brasileiro', async () => {
    const out = await say('Jarvis, registre despesa de R$ 1.250,90 com hospedagem dos sites');
    const [e] = await repo.table('expenses').list();
    expect(e.amount).toBe(1250.9);
    expect(e.description?.toLowerCase()).toContain('hospedagem');
    expect(out.reply).toContain('R$');
  });

  it('follow-up vira tarefa com lembrete', async () => {
    await say('Jarvis, follow-up com João amanhã às 15h sobre a proposta');
    const [t] = await repo.table('tasks').list();
    expect(t.title).toBe('Follow-up com João: Proposta');
    expect(t.category).toBe('Follow-up');
  });

  it('roteia especialistas sem chamadas extras', () => {
    const c = { now: NOW, tz: TZ };
    expect(routeSpecialist('compare as vendas desta semana', parseCommand('compare as vendas desta semana', c)).id).toBe('analyst');
    expect(routeSpecialist('tem um bug no deploy da API').id).toBe('developer');
    expect(routeSpecialist('quero estudar inglês').id).toBe('personal');
  });

  it('rascunho n8n: cron, inativo, assinatura HMAC e sem segredos embutidos', () => {
    const d = buildWorkflowDraft('toda segunda e quarta às 7h30 envie o resumo de leads', { now: NOW, tz: TZ }, 'https://x.supabase.co/functions/v1/jarvis-events', 'conn-1');
    expect(d.trigger.cron).toBe('30 7 * * MON,WED');
    expect(JSON.stringify(d.workflow)).toContain('X-Jarvis-Signature');
    expect(JSON.stringify(d.workflow)).toContain('$env.JARVIS_EVENTS_SECRET');
    expect(d.summary.join(' ')).toMatch(/INATIVO/);
  });
});
