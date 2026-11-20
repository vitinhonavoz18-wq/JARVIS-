/**
 * Ferramentas da versão 2.0: automações (n8n), projetos conectados, central executiva,
 * radar de pendências, planejador do dia, metas, despesas, alertas e relatórios.
 * Todas consultam dados reais; quando uma fonte não está conectada, dizem isso claramente.
 */
import { z } from 'zod';
import { normalizeText } from '../data/repo.ts';
import type { Automation, AutomationRun, ConnectedProject, Task } from '../types.ts';
import {
  dayRangeUtc, formatRelativeDay, formatTimeSpoken, formatWhen, localDateKey, localDateOf, parseLocalDateKey,
  toLocalIso, zonedToUtc, formatDuration,
} from '../time.ts';
import { requiresConfirmation } from '../connectors/types.ts';
import { PROJECT_TEMPLATES } from '../connectors/templates.ts';
import { ACTIVE_RUN, RUN_STATUS_LABEL, validateInput } from '../integration/services.ts';
import { buildWorkflowDraft } from '../integration/workflowBuilder.ts';
import { computeFreeSlots, daySnapshot, focusMinutesInRange, loadEventsInRange, overdueTasks, routineProgress, sortTasksSmart, weekBounds } from './insights.ts';
import { registerTools, tool, type ToolContext, type ToolDef } from './tools.ts';

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const NEEDS_CLOUD = 'Esta função exige o Modo Nuvem (servidor do JARVIS conectado ao Supabase). No Modo Local não há acesso seguro ao n8n nem aos projetos.';

const STOP = /\b(automacao|automacoes|workflow|fluxo|de|da|do|das|dos|meu|meus|minha|minhas|a|o|as|os|autorizada|autorizado|por favor)\b/g;

function score(name: string, aliases: string[], q: string): number {
  const nq = normalizeText(q).replace(STOP, ' ').replace(/\s+/g, ' ').trim();
  if (!nq) return 0;
  let best = 0;
  for (const cand of [name, ...aliases]) {
    const c = normalizeText(cand).replace(STOP, ' ').replace(/\s+/g, ' ').trim();
    if (c === nq) best = Math.max(best, 100);
    else if (c.includes(nq) || nq.includes(c)) best = Math.max(best, 70);
    else {
      const words = nq.split(' ').filter((w) => w.length > 2);
      const hits = words.filter((w) => c.includes(w)).length;
      if (words.length && hits) best = Math.max(best, (50 * hits) / words.length);
    }
  }
  return best;
}

async function resolveAutomation(ctx: ToolContext, ref: string): Promise<Automation | string> {
  const all = await ctx.repo.table('automations').list({ eq: { enabled: true } });
  if (!all.length) return 'Nenhuma automação executável está registrada. Cadastre uma no Automation Studio.';
  const byId = all.find((a) => a.id === ref);
  if (byId) return byId;
  const ranked = all.map((a) => ({ a, s: score(a.name, a.aliases, ref) })).filter((x) => x.s >= 35).sort((x, y) => y.s - x.s);
  if (!ranked.length) return `Não encontrei automação registrada parecida com “${ref}”. Registradas: ${all.slice(0, 6).map((a) => a.name).join(', ')}.`;
  if (ranked.length > 1 && ranked[0].s === ranked[1].s) return `Encontrei mais de uma automação: ${ranked.slice(0, 4).map((x) => `“${x.a.name}”`).join(', ')}. Qual delas?`;
  return ranked[0].a;
}

async function resolveProject(ctx: ToolContext, ref: string): Promise<ConnectedProject | string> {
  const all = await ctx.repo.table('connected_projects').list({ eq: { enabled: true } });
  const nq = normalizeText(ref);
  const hit = all.find((p) => p.id === ref) ?? all.find((p) => normalizeText(p.name) === nq) ?? all.find((p) => nq.includes(normalizeText(p.name)) || normalizeText(p.name).includes(nq))
    ?? all.find((p) => nq.includes(p.template.replace(/_/g, ' ')));
  if (hit) return hit;
  const tpl = PROJECT_TEMPLATES.find((t) => nq.includes(normalizeText(t.name)));
  return `O projeto “${tpl?.name ?? ref}” ainda não está conectado ao JARVIS, então esse dado está indisponível. Conecte-o na Central Executiva.`;
}

const runLine = (r: AutomationRun, name: string, ctx: ToolContext) =>
  `• ${name}: ${RUN_STATUS_LABEL[r.status]} — ${formatWhen(r.requested_at ?? r.created_at, false, ctx.now, ctx.tz)}${r.output_summary ? ` · ${r.output_summary}` : ''}${r.error ? ` · erro: ${r.error}` : ''}`;

/* -------------------------------- Automações -------------------------------- */

const listAutomations = tool({
  name: 'list_automations',
  description: 'Lista as automações executáveis registradas (n8n) e a última execução de cada uma.',
  readOnly: true, risk: 'read', output: 'Lista de automações com status da última execução.',
  schema: z.object({ project: z.string().optional() }),
  async run(ctx, i) {
    let autos = await ctx.repo.table('automations').list({ eq: { enabled: true }, order: [{ field: 'name' }] });
    if (i.project) {
      const p = await resolveProject(ctx, i.project);
      if (typeof p === 'string') return { ok: true, message: p, data: [] };
      autos = autos.filter((a) => a.project_id === p.id);
    }
    if (!autos.length) return { ok: true, message: 'Nenhuma automação executável registrada ainda. Cadastre em Automation Studio.', data: [] };
    const runs = await ctx.repo.table('automation_runs').list({ order: [{ field: 'requested_at', asc: false }], limit: 200 });
    const lines = autos.map((a) => {
      const last = runs.find((r) => r.automation_id === a.id);
      return `• ${a.name}${last ? ` — última: ${RUN_STATUS_LABEL[last.status]} (${formatRelativeDay(last.requested_at ?? last.created_at, ctx.now, ctx.tz)})` : ' — nunca executada'}`;
    });
    return { ok: true, message: `Automações registradas (${autos.length}):\n${lines.join('\n')}`, data: autos.map((a) => ({ id: a.id, name: a.name, risk: a.risk })), link: '/automacoes' };
  },
});

const runAutomation = tool({
  name: 'execute_approved_workflow',
  description: 'Executa uma automação REGISTRADA do n8n (por nome ou id) com parâmetros validados. Retorna o status real: solicitada/iniciada não significa concluída.',
  risk: 'external', timeoutMs: 30000, output: 'Execução criada com status atual.',
  schema: z.object({ automation: z.string().min(1), input: z.record(z.string(), z.unknown()).optional() }),
  async needsConfirmation(ctx, i) {
    const a = await resolveAutomation(ctx, i.automation);
    if (typeof a === 'string') return false; // a execução vai falhar com mensagem clara
    return a.requires_confirmation || requiresConfirmation(a.risk);
  },
  async run(ctx, i) {
    if (!ctx.services) return { ok: false, message: NEEDS_CLOUD };
    const a = await resolveAutomation(ctx, i.automation);
    if (typeof a === 'string') return { ok: false, message: a };
    const input = i.input ?? {};
    const errors = validateInput(a.input_schema, input);
    if (errors.length) return { ok: false, message: `Parâmetros inválidos para “${a.name}”: ${errors.join('; ')}.` };
    const r = await ctx.services.runAutomation({ automationId: a.id, input, source: ctx.source === 'voice' ? 'voice' : ctx.source === 'manual' ? 'manual' : 'ai' });
    if (!r.ok || !r.run) return { ok: false, message: r.message };
    const st = r.run.status;
    const msg = st === 'succeeded'
      ? `“${a.name}” concluída com sucesso${r.run.output_summary ? `: ${r.run.output_summary}` : '.'}`
      : st === 'failed' ? `“${a.name}” falhou: ${r.run.error ?? 'erro não informado'}.`
      : `“${a.name}” ${RUN_STATUS_LABEL[st]}. Vou acompanhar e avisar quando terminar.`;
    return { ok: st !== 'failed', message: msg, data: { run_id: r.run.id, status: st }, link: '/automacoes' };
  },
});

const runStatus = tool({
  name: 'get_workflow_execution_status',
  description: 'Consulta o status real da última execução de uma automação (ou de uma execução pelo id).',
  readOnly: true, risk: 'read',
  schema: z.object({ automation: z.string().optional(), run_id: z.string().optional() }),
  async run(ctx, i) {
    let run: AutomationRun | null;
    let name = '';
    if (i.run_id) run = await ctx.repo.table('automation_runs').get(i.run_id);
    else if (i.automation) {
      const a = await resolveAutomation(ctx, i.automation);
      if (typeof a === 'string') return { ok: true, message: a };
      name = a.name;
      run = (await ctx.repo.table('automation_runs').list({ eq: { automation_id: a.id }, order: [{ field: 'requested_at', asc: false }], limit: 1 }))[0] ?? null;
      if (!run) return { ok: true, message: `“${a.name}” ainda não foi executada pelo JARVIS.` };
    } else return { ok: false, message: 'Qual automação devo verificar?' };
    if (!run) return { ok: false, message: 'Execução não encontrada.' };
    if (ctx.services && (ACTIVE_RUN as readonly string[]).includes(run.status)) {
      const fresh = await ctx.services.refreshRun(run.id);
      if (fresh.run) run = fresh.run;
    }
    if (!name) name = (await ctx.repo.table('automations').get(run.automation_id))?.name ?? 'Automação';
    return { ok: true, message: runLine(run, name, ctx).slice(2), data: { status: run.status, run_id: run.id } };
  },
});

const failedWorkflows = tool({
  name: 'list_failed_workflows',
  description: 'Lista automações que falharam ou ficaram sem resposta em um dia (padrão: hoje), incluindo workflows sincronizados do n8n com erro.',
  readOnly: true, risk: 'read',
  schema: z.object({ date: LocalDate.optional() }),
  async run(ctx, i) {
    const day = i.date ? parseLocalDateKey(i.date) : localDateOf(ctx.now, ctx.tz);
    const { start, end } = dayRangeUtc(day, ctx.tz);
    const [runs, autos, wfs] = await Promise.all([
      ctx.repo.table('automation_runs').list({ in: { status: ['failed', 'timeout'] }, gte: { requested_at: start.toISOString() }, lt: { requested_at: end.toISOString() } }),
      ctx.repo.table('automations').list(),
      ctx.repo.table('automation_workflows').list({ in: { last_execution_status: ['error', 'crashed'] }, gte: { last_execution_at: start.toISOString() }, lt: { last_execution_at: end.toISOString() } }),
    ]);
    const label = formatRelativeDay(start.toISOString(), ctx.now, ctx.tz);
    if (!runs.length && !wfs.length) return { ok: true, message: `Nenhuma automação com falha ${label} (nos dados sincronizados).`, data: [] };
    const lines = [
      ...runs.map((r) => runLine(r, autos.find((a) => a.id === r.automation_id)?.name ?? 'Automação', ctx)),
      ...wfs.map((w) => `• ${w.name} (n8n): última execução com erro — ${formatTimeSpoken(w.last_execution_at!, ctx.tz)}`),
    ];
    return { ok: true, message: `Falhas ${label} (${lines.length}):\n${lines.join('\n')}`, data: { runs: runs.length, workflows: wfs.length }, link: '/automacoes' };
  },
});

const createAutomationDraft = tool({
  name: 'create_automation_draft',
  description: 'A partir de um objetivo em linguagem natural, monta um rascunho de workflow n8n e o cria INATIVO na instância conectada. Nunca ativa em produção.',
  risk: 'external', timeoutMs: 30000,
  schema: z.object({ goal: z.string().min(10).max(500), connection: z.string().optional() }),
  async run(ctx, i) {
    const conns = await ctx.repo.table('automation_connections').list();
    const conn = conns.find((c) => c.id === i.connection) ?? conns.find((c) => c.environment === 'development' && c.status === 'connected') ?? conns.find((c) => c.status === 'connected');
    if (!conn) return { ok: false, message: 'Nenhuma instância n8n conectada. Conecte uma no Automation Studio.' };
    if (!ctx.services) return { ok: false, message: NEEDS_CLOUD };
    const draft = buildWorkflowDraft(i.goal, { now: ctx.now, tz: ctx.tz }, 'https://SEU-PROJETO.supabase.co/functions/v1/jarvis-events', conn.id);
    const r = await ctx.services.createWorkflowDraft(conn.id, i.goal, ctx.tz);
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, message: `Rascunho “${draft.name}” criado INATIVO no n8n (${conn.name}).\n${draft.summary.join('\n')}`, data: { workflow_id: r.workflowId }, link: '/automacoes' };
  },
});

/* ---------------------------------- Projetos ---------------------------------- */

const listProjects = tool({
  name: 'list_connected_projects',
  description: 'Lista as empresas/projetos conectados ao JARVIS e o estado de cada conexão.',
  readOnly: true, risk: 'read',
  schema: z.object({}),
  async run(ctx) {
    const all = await ctx.repo.table('connected_projects').list({ eq: { enabled: true }, order: [{ field: 'name' }] });
    if (!all.length) return { ok: true, message: 'Nenhum projeto conectado ainda. Adicione na Central Executiva.', data: [] };
    const lbl = { not_configured: 'não configurado', healthy: 'operacional', degraded: 'instável', down: 'fora do ar', unauthorized: 'sem autorização' } as const;
    return {
      ok: true,
      message: `Projetos (${all.length}):\n${all.map((p) => `• ${p.name}: ${lbl[p.status]}${p.last_health_at ? ` (verificado ${formatRelativeDay(p.last_health_at, ctx.now, ctx.tz)} ${formatTimeSpoken(p.last_health_at, ctx.tz)})` : ''}`).join('\n')}`,
      data: all.map((p) => ({ id: p.id, name: p.name, status: p.status })),
      link: '/executivo',
    };
  },
});

const projectStatus = tool({
  name: 'get_project_status',
  description: 'Verifica o estado operacional real de um projeto conectado (teste de saúde do conector).',
  readOnly: true, risk: 'read', timeoutMs: 25000,
  schema: z.object({ project: z.string().min(1) }),
  async run(ctx, i) {
    const p = await resolveProject(ctx, i.project);
    if (typeof p === 'string') return { ok: true, message: p };
    if (!ctx.services || p.connector_type === 'none') return { ok: true, message: `${p.name}: conector não configurado — status indisponível.` };
    const h = await ctx.services.projectHealth(p.id);
    return { ok: true, message: `${p.name}: ${h.status === 'healthy' ? 'operacional' : h.status} — ${h.detail} (fonte: ${p.name}, ${formatTimeSpoken(h.checkedAt, ctx.tz)}).`, data: h };
  },
});

function pickCapability(text: string): string {
  const n = normalizeText(text);
  if (/estoque/.test(n)) return 'stock.low';
  if (/compar|semana anterior|mes anterior/.test(n)) return 'metrics.compare';
  if (/integrac|erro|falha/.test(n)) return 'integrations.status';
  if (/pendent|atividade|tarefa|prioridade/.test(n)) return 'tasks.pending';
  if (/alerta/.test(n)) return 'alerts.list';
  return 'metrics.summary';
}

function formatData(data: unknown): string {
  if (data == null) return 'sem dados';
  if (typeof data !== 'object') return String(data);
  if (Array.isArray(data)) return data.slice(0, 15).map((x) => `• ${typeof x === 'object' ? Object.values(x as object).join(' — ') : String(x)}`).join('\n') || 'nenhum item';
  return Object.entries(data as Record<string, unknown>).slice(0, 20).map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n');
}

const businessMetrics = tool({
  name: 'get_business_metrics',
  description: 'Consulta dados reais de um projeto conectado (indicadores, comparação de períodos, estoque baixo, pendências, integrações). Sempre informa fonte e horário. Se não houver conexão, diz que o dado está indisponível.',
  readOnly: true, risk: 'read', timeoutMs: 30000,
  schema: z.object({ project: z.string().min(1), capability: z.string().optional(), question: z.string().optional(), input: z.record(z.string(), z.unknown()).optional() }),
  async run(ctx, i) {
    const p = await resolveProject(ctx, i.project);
    if (typeof p === 'string') return { ok: true, message: p };
    const cap = i.capability ?? pickCapability(i.question ?? '');
    if (ctx.services && p.connector_type !== 'none') {
      const r = await ctx.services.projectAction(p.id, cap, i.input ?? {}, false);
      if (r.ok) {
        return { ok: true, message: `${p.name} — ${cap} (fonte: ${r.source}, atualizado ${formatRelativeDay(r.fetchedAt, ctx.now, ctx.tz)} às ${formatTimeSpoken(r.fetchedAt, ctx.tz)}):\n${formatData(r.data)}`, data: r };
      }
      const snap = (await ctx.repo.table('project_snapshots').list({ eq: { project_id: p.id, capability: cap }, order: [{ field: 'fetched_at', asc: false }], limit: 1 }))[0];
      if (snap) return { ok: true, message: `Não consegui consultar ${p.name} agora (${r.error}). Último dado disponível (fonte: ${snap.source}, ${formatRelativeDay(snap.fetched_at, ctx.now, ctx.tz)} às ${formatTimeSpoken(snap.fetched_at, ctx.tz)}):\n${formatData(snap.data)}`, data: snap };
      return { ok: false, message: `Não consegui obter “${cap}” de ${p.name}: ${r.error}` };
    }
    const snap = (await ctx.repo.table('project_snapshots').list({ eq: { project_id: p.id, capability: cap }, order: [{ field: 'fetched_at', asc: false }], limit: 1 }))[0];
    if (snap) return { ok: true, message: `${p.name} — último dado recebido (fonte: ${snap.source}, ${formatRelativeDay(snap.fetched_at, ctx.now, ctx.tz)} às ${formatTimeSpoken(snap.fetched_at, ctx.tz)}):\n${formatData(snap.data)}`, data: snap };
    return { ok: true, message: `${p.name}: dado “${cap}” indisponível — o conector não está configurado e nenhum dado foi recebido ainda.` };
  },
});

const searchCustomers = tool({
  name: 'search_customer_records',
  description: 'Pesquisa registros de clientes em um projeto conectado, apenas se o projeto permitir dados detalhados. Retorna o mínimo necessário.',
  readOnly: true, risk: 'read', timeoutMs: 30000,
  schema: z.object({ project: z.string().min(1), query: z.string().min(2).max(100) }),
  async run(ctx, i) {
    const p = await resolveProject(ctx, i.project);
    if (typeof p === 'string') return { ok: true, message: p };
    if (p.privacy_level !== 'detailed') return { ok: false, message: `${p.name} está configurado para dados agregados. Por privacidade, não consulto registros individuais de clientes.` };
    if (!ctx.services) return { ok: false, message: NEEDS_CLOUD };
    const r = await ctx.services.projectAction(p.id, 'customers.search', { query: i.query }, false);
    return r.ok ? { ok: true, message: `Resultados em ${p.name} (fonte: ${r.source}):\n${formatData(r.data)}`, data: r } : { ok: false, message: r.error ?? 'Falha na consulta.' };
  },
});

/* ------------------------------ Alertas, metas, despesas ------------------------------ */

const createAlert = tool({
  name: 'create_internal_alert',
  description: 'Cria um alerta interno no painel do JARVIS.',
  risk: 'reversible',
  schema: z.object({ title: z.string().min(1).max(200), body: z.string().max(2000).optional(), severity: z.enum(['info', 'warning', 'critical']).optional() }),
  async run(ctx, i) {
    const a = await ctx.repo.table('alerts').insert({ title: i.title, body: i.body ?? null, severity: i.severity ?? 'info', source: 'jarvis' });
    return { ok: true, message: `Alerta “${a.title}” registrado.`, data: a, link: '/executivo' };
  },
});

const followUp = tool({
  name: 'create_follow_up',
  description: 'Agenda um follow-up (retorno) com alguém, como tarefa com lembrete.',
  risk: 'reversible',
  schema: z.object({ who: z.string().min(1).max(100), about: z.string().max(200).optional(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/) }),
  async run(ctx, i) {
    const { TOOL_MAP } = await import('./tools.ts');
    const title = `Follow-up com ${i.who}${i.about ? `: ${i.about}` : ''}`;
    return TOOL_MAP.get('create_task')!.run(ctx, { title, due: i.due, category: 'Follow-up', priority: 'high', remind_minutes_before: i.due.includes('T') ? 0 : undefined } as never);
  },
});

const parseMoney = (v: string | number) => (typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));

const registerExpense = tool({
  name: 'register_expense',
  description: 'Registra uma despesa (valor em reais, categoria, descrição, data).',
  risk: 'reversible',
  schema: z.object({ amount: z.union([z.number(), z.string()]), description: z.string().max(300).optional(), category: z.string().max(60).optional(), date: LocalDate.optional(), project: z.string().max(80).optional() }),
  async run(ctx, i) {
    const amount = parseMoney(i.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: 'Valor da despesa inválido.' };
    const e = await ctx.repo.table('expenses').insert({ amount: Math.round(amount * 100) / 100, description: i.description ?? null, category: i.category ?? 'Geral', spent_on: i.date ?? localDateKey(localDateOf(ctx.now, ctx.tz)), project_label: i.project ?? null });
    return { ok: true, message: `Despesa de ${e.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} registrada${e.description ? ` (${e.description})` : ''}.`, data: e, link: '/executivo' };
  },
});

const goalTool = tool({
  name: 'update_goal',
  description: 'Cria uma meta ou atualiza o progresso de uma meta existente.',
  risk: 'reversible',
  schema: z.object({ title: z.string().min(1).max(160), current: z.number().optional(), target: z.number().optional(), unit: z.string().max(20).optional(), due_date: LocalDate.optional() }),
  async run(ctx, i) {
    const t = ctx.repo.table('goals');
    const existing = (await t.list({ eq: { status: 'active' } })).find((g) => score(g.title, [], i.title) >= 70);
    if (existing) {
      const g = await t.update(existing.id, { ...(i.current !== undefined ? { current: i.current } : {}), ...(i.target !== undefined ? { target: i.target } : {}) });
      const pct = g.target ? Math.round((g.current / g.target) * 100) : null;
      if (g.target && g.current >= g.target) await t.update(g.id, { status: 'achieved' });
      return { ok: true, message: `Meta “${g.title}” atualizada: ${g.current}${g.unit ? ` ${g.unit}` : ''}${g.target ? ` de ${g.target} (${pct}%)` : ''}.`, data: g };
    }
    const g = await t.insert({ title: i.title, target: i.target ?? null, current: i.current ?? 0, unit: i.unit ?? null, due_date: i.due_date ?? null });
    return { ok: true, message: `Meta “${g.title}” criada${g.target ? ` (alvo: ${g.target}${g.unit ? ` ${g.unit}` : ''})` : ''}.`, data: g };
  },
});

/* ------------------------------ Radar e briefings ------------------------------ */

export interface RadarItem {
  kind: 'overdue' | 'today_high' | 'stale' | 'alert' | 'automation' | 'project' | 'goal';
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
  link: string;
}

export async function buildRadar(ctx: ToolContext): Promise<RadarItem[]> {
  const today = localDateOf(ctx.now, ctx.tz);
  const since = new Date(ctx.now.getTime() - 24 * 3600_000).toISOString();
  const [overdue, todaySnap, inProgress, alerts, runs, projects, goals, autos] = await Promise.all([
    overdueTasks(ctx.repo, ctx.now, ctx.tz),
    daySnapshot(ctx.repo, localDateKey(today), ctx.tz, ctx.now),
    ctx.repo.table('tasks').list({ eq: { status: 'in_progress' }, isNull: ['deleted_at'] }),
    ctx.repo.table('alerts').list({ isNull: ['read_at'], order: [{ field: 'created_at', asc: false }], limit: 20 }),
    ctx.repo.table('automation_runs').list({ in: { status: ['failed', 'timeout'] }, gte: { requested_at: since } }),
    ctx.repo.table('connected_projects').list({ eq: { enabled: true } }),
    ctx.repo.table('goals').list({ eq: { status: 'active' } }),
    ctx.repo.table('automations').list(),
  ]);
  const items: RadarItem[] = [];
  for (const t of overdue.slice(0, 10)) items.push({ kind: 'overdue', title: t.title, detail: `atrasada desde ${formatRelativeDay(t.due_at!, ctx.now, ctx.tz)}`, severity: t.priority === 'urgent' || t.priority === 'high' ? 'critical' : 'warning', link: `/tarefas?id=${t.id}` });
  for (const t of todaySnap.pendingTasks.filter((x) => x.priority === 'high' || x.priority === 'urgent')) items.push({ kind: 'today_high', title: t.title, detail: `prioridade alta para hoje${t.due_at && !t.all_day ? ` às ${formatTimeSpoken(t.due_at, ctx.tz)}` : ''}`, severity: 'warning', link: `/tarefas?id=${t.id}` });
  for (const t of inProgress.filter((x) => ctx.now.getTime() - new Date(x.updated_at).getTime() > 7 * 86400_000)) items.push({ kind: 'stale', title: t.title, detail: 'em andamento há mais de 7 dias sem atualização', severity: 'info', link: `/tarefas?id=${t.id}` });
  for (const a of alerts) items.push({ kind: 'alert', title: a.title, detail: a.body ?? a.source, severity: a.severity, link: a.link ?? '/executivo' });
  for (const r of runs) items.push({ kind: 'automation', title: autos.find((a) => a.id === r.automation_id)?.name ?? 'Automação', detail: RUN_STATUS_LABEL[r.status], severity: 'warning', link: '/automacoes' });
  for (const p of projects.filter((x) => x.status === 'down' || x.status === 'unauthorized' || x.status === 'degraded')) items.push({ kind: 'project', title: p.name, detail: p.status_detail ?? p.status, severity: p.status === 'degraded' ? 'warning' : 'critical', link: '/executivo' });
  for (const g of goals) {
    if (!g.target || !g.due_date) continue;
    const daysLeft = Math.round((zonedToUtc(...(g.due_date.split('-').map(Number) as [number, number, number]), 12, 0, ctx.tz).getTime() - ctx.now.getTime()) / 86400_000);
    const pct = g.current / g.target;
    if (daysLeft <= 14 && pct < 0.75) items.push({ kind: 'goal', title: g.title, detail: `${Math.round(pct * 100)}% concluída, prazo em ${Math.max(0, daysLeft)} dia(s)`, severity: daysLeft <= 3 ? 'critical' : 'warning', link: '/executivo' });
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

const radar = tool({
  name: 'get_pending_radar',
  description: 'Radar de pendências: tarefas atrasadas, prioridades de hoje, tarefas paradas, alertas não lidos, automações com falha, projetos fora do ar e metas em risco.',
  readOnly: true, risk: 'read',
  schema: z.object({}),
  async run(ctx) {
    const items = await buildRadar(ctx);
    if (!items.length) return { ok: true, message: 'Radar limpo: nenhuma pendência crítica encontrada nos seus registros.', data: [] };
    const icon = { critical: '🔴', warning: '🟠', info: '🔵' };
    return { ok: true, message: `Radar de pendências (${items.length}):\n${items.slice(0, 12).map((x) => `${icon[x.severity]} ${x.title} — ${x.detail}`).join('\n')}`, data: items, link: '/executivo' };
  },
});

export async function buildBusinessBriefing(ctx: ToolContext) {
  const [projects, radarItems, runs, snaps] = await Promise.all([
    ctx.repo.table('connected_projects').list({ eq: { enabled: true }, order: [{ field: 'name' }] }),
    buildRadar(ctx),
    ctx.repo.table('automation_runs').list({ gte: { requested_at: new Date(ctx.now.getTime() - 24 * 3600_000).toISOString() } }),
    ctx.repo.table('project_snapshots').list({ order: [{ field: 'fetched_at', asc: false }], limit: 100 }),
  ]);
  const lines: string[] = [];
  if (!projects.length) lines.push('Nenhuma empresa conectada ainda — os indicadores aparecerão aqui após conectar os projetos.');
  for (const p of projects) {
    const snap = snaps.find((s) => s.project_id === p.id && s.capability === 'metrics.summary');
    const status = { not_configured: 'conector não configurado', healthy: 'operacional', degraded: 'instável', down: 'fora do ar', unauthorized: 'sem autorização' }[p.status];
    lines.push(`${p.name}: ${status}${snap ? ` · últimos indicadores (fonte: ${snap.source}, ${formatRelativeDay(snap.fetched_at, ctx.now, ctx.tz)} ${formatTimeSpoken(snap.fetched_at, ctx.tz)}): ${Object.entries(snap.data).slice(0, 4).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}` : ''}`);
  }
  const ok = runs.filter((r) => r.status === 'succeeded').length;
  const bad = runs.filter((r) => r.status === 'failed' || r.status === 'timeout').length;
  const active = runs.filter((r) => (ACTIVE_RUN as readonly string[]).includes(r.status)).length;
  if (runs.length) lines.push(`Automações nas últimas 24h: ${ok} concluídas, ${bad} com falha, ${active} em andamento.`);
  const critical = radarItems.filter((x) => x.severity === 'critical');
  lines.push(critical.length ? `Exigem atenção: ${critical.slice(0, 4).map((x) => x.title).join(', ')}.` : 'Nenhum ponto crítico no radar.');
  return { lines, projects, radar: radarItems, runs: { ok, bad, active } };
}

const businessBriefing = tool({
  name: 'business_briefing',
  description: 'Briefing empresarial consolidado: situação de cada projeto conectado (com fonte e horário), automações das últimas 24h e pontos que exigem atenção.',
  readOnly: true, risk: 'read',
  schema: z.object({}),
  async run(ctx) {
    const b = await buildBusinessBriefing(ctx);
    return { ok: true, message: `Briefing empresarial:\n${b.lines.map((l) => `• ${l}`).join('\n')}`, data: { radar: b.radar.length, runs: b.runs }, link: '/executivo' };
  },
});

const weeklyReport = tool({
  name: 'generate_weekly_report',
  description: 'Relatório semanal com dados reais: tarefas, foco, hábitos, automações, despesas e metas.',
  readOnly: true, risk: 'read',
  schema: z.object({}),
  async run(ctx) {
    const today = localDateOf(ctx.now, ctx.tz);
    const { from, to } = weekBounds(today);
    const start = dayRangeUtc(from, ctx.tz).start.toISOString();
    const end = dayRangeUtc(to, ctx.tz).end.toISOString();
    const [done, created, focus, routines, runs, expenses, goals] = await Promise.all([
      ctx.repo.table('tasks').list({ eq: { status: 'done' }, gte: { completed_at: start }, lt: { completed_at: end }, isNull: ['deleted_at'] }),
      ctx.repo.table('tasks').list({ gte: { created_at: start }, lt: { created_at: end }, isNull: ['deleted_at'] }),
      focusMinutesInRange(ctx.repo, from, to, ctx.tz, ctx.now),
      routineProgress(ctx.repo, today),
      ctx.repo.table('automation_runs').list({ gte: { requested_at: start }, lt: { requested_at: end } }),
      ctx.repo.table('expenses').list({ gte: { spent_on: localDateKey(from) }, lte: { spent_on: localDateKey(to) } }),
      ctx.repo.table('goals').list({ eq: { status: 'active' } }),
    ]);
    const total = expenses.reduce((a, e) => a + Number(e.amount), 0);
    const lines = [
      `Semana de ${from.day}/${from.month} a ${to.day}/${to.month}.`,
      `Tarefas: ${done.length} concluídas, ${created.length} criadas.`,
      `Foco: ${formatDuration(focus)}.`,
      ...routines.map((r) => `${r.routine.name}: ${r.done} de ${r.planned} sessões.`),
      `Automações: ${runs.filter((r) => r.status === 'succeeded').length} concluídas, ${runs.filter((r) => r.status === 'failed' || r.status === 'timeout').length} com falha.`,
      `Despesas registradas: ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${expenses.length} lançamentos).`,
      ...goals.filter((g) => g.target).map((g) => `Meta “${g.title}”: ${Math.round((g.current / g.target!) * 100)}%.`),
    ];
    return { ok: true, message: `Relatório semanal:\n${lines.map((l) => `• ${l}`).join('\n')}`, data: { done: done.length, focus, expenses: total } };
  },
});

/* ------------------------------- Planejador do dia ------------------------------- */

export interface PlanItem { task: Task; start: Date; end: Date }

/** Encaixa tarefas pendentes sem horário nas janelas livres do dia, sem mexer em compromissos. */
export async function buildDayPlan(ctx: ToolContext, dateKey?: string): Promise<{ plan: PlanItem[]; unplaced: Task[]; date: string }> {
  const day = dateKey ? parseLocalDateKey(dateKey) : localDateOf(ctx.now, ctx.tz);
  const key = localDateKey(day);
  const events = await loadEventsInRange(ctx.repo, day, day, ctx.tz);
  const timedTasks = (await ctx.repo.table('tasks').list({ gte: { due_at: dayRangeUtc(day, ctx.tz).start.toISOString() }, lt: { due_at: dayRangeUtc(day, ctx.tz).end.toISOString() }, isNull: ['deleted_at'] }))
    .filter((t) => !t.all_day && t.status !== 'done' && t.status !== 'cancelled');
  // Tarefas com horário ocupam 30 min na agenda.
  const busy = [...events, ...timedTasks.map((t) => ({ event: { all_day: false } as never, start: new Date(t.due_at!), end: new Date(new Date(t.due_at!).getTime() + 30 * 60000), key: t.id }))];
  const now = key === localDateKey(localDateOf(ctx.now, ctx.tz)) ? ctx.now : zonedToUtc(day.year, day.month, day.day, 0, 0, ctx.tz);
  const slots = computeFreeSlots(day, busy as never, ctx.tz, now).map((s) => ({ start: new Date(Math.ceil(s.start.getTime() / 900000) * 900000), end: s.end }));
  const allDayToday = (await ctx.repo.table('tasks').list({ gte: { due_at: dayRangeUtc(day, ctx.tz).start.toISOString() }, lt: { due_at: dayRangeUtc(day, ctx.tz).end.toISOString() }, isNull: ['deleted_at'] }))
    .filter((t) => t.all_day && t.status === 'todo');
  const isToday = key === localDateKey(localDateOf(ctx.now, ctx.tz));
  const overdue = isToday ? (await overdueTasks(ctx.repo, ctx.now, ctx.tz)).filter((t) => t.status === 'todo') : [];
  // Tarefas sem data entram depois das do dia e das atrasadas, por prioridade.
  const undated = sortTasksSmart(await ctx.repo.table('tasks').list({ eq: { status: 'todo' }, isNull: ['due_at', 'deleted_at'] })).slice(0, 5);
  const candidates = [...sortTasksSmart([...allDayToday, ...overdue]), ...undated].slice(0, 10);
  const plan: PlanItem[] = [];
  const unplaced: Task[] = [];
  for (const t of candidates) {
    const dur = (t.priority === 'high' || t.priority === 'urgent' ? 60 : 45) * 60000;
    const slot = slots.find((s) => s.end.getTime() - s.start.getTime() >= dur);
    if (!slot) {
      unplaced.push(t);
      continue;
    }
    plan.push({ task: t, start: new Date(slot.start), end: new Date(slot.start.getTime() + dur) });
    slot.start = new Date(slot.start.getTime() + dur + 10 * 60000); // 10 min de intervalo
  }
  return { plan, unplaced, date: key };
}

const planDay = tool({
  name: 'plan_day',
  description: 'Sugere um planejamento do dia encaixando tarefas sem horário nas janelas livres da agenda. Não altera compromissos; só aplica após aprovação.',
  readOnly: true, risk: 'read',
  schema: z.object({ date: LocalDate.optional() }),
  async run(ctx, i) {
    const { plan, unplaced, date } = await buildDayPlan(ctx, i.date);
    if (!plan.length) return { ok: true, message: unplaced.length ? 'Não há janelas livres suficientes hoje para as tarefas pendentes.' : 'Não há tarefas sem horário para organizar.', data: { plan: [] } };
    return {
      ok: true,
      message: `Sugestão de planejamento:\n${plan.map((p) => `• ${formatTimeSpoken(p.start, ctx.tz)}–${formatTimeSpoken(p.end, ctx.tz)} ${p.task.title}`).join('\n')}${unplaced.length ? `\nSem espaço hoje: ${unplaced.map((t) => t.title).join(', ')}.` : ''}`,
      data: { date, plan: plan.map((p) => ({ task_id: p.task.id, title: p.task.title, start: toLocalIso(p.start, ctx.tz) })) },
    };
  },
});

export const BUSINESS_TOOLS: ToolDef[] = [
  listAutomations, runAutomation, runStatus, failedWorkflows, createAutomationDraft,
  listProjects, projectStatus, businessMetrics, searchCustomers,
  createAlert, followUp, registerExpense, goalTool,
  radar, businessBriefing, weeklyReport, planDay,
] as unknown as ToolDef[];

registerTools(BUSINESS_TOOLS);

