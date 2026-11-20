/**
 * Gera um RASCUNHO de workflow n8n a partir de um objetivo em português.
 * O rascunho é criado INATIVO; dados reais e credenciais são configurados no n8n e a ativação
 * em produção só acontece com aprovação explícita.
 */
import { extractTemporal, type ParseCtx } from '../agent/nlu.ts';
import { parseRule } from '../agent/recurrence.ts';
import { EVENT_SCHEMA_VERSION } from './contract.ts';

export interface WorkflowDraft {
  name: string;
  summary: string[];
  trigger: { kind: 'schedule' | 'webhook'; description: string; cron?: string };
  needs: string[];
  workflow: { name: string; nodes: unknown[]; connections: Record<string, unknown>; settings: Record<string, unknown> };
}

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function detectSources(n: string): string[] {
  const out: string[] = [];
  if (/venda|faturamento|pedido/.test(n)) out.push('Fonte de vendas/pedidos (API do sistema ou planilha)');
  if (/lead|cliente|crm/.test(n)) out.push('CRM / base de leads');
  if (/estoque|produto/.test(n)) out.push('Sistema de estoque');
  if (/whatsapp|mensagem|e-?mail|enviar/.test(n)) out.push('Canal de envio (WhatsApp/e-mail) — exige aprovação antes de ativar');
  if (!out.length) out.push('Fonte de dados a definir no n8n');
  return out;
}

export function buildWorkflowDraft(goal: string, ctx: ParseCtx, jarvisEventsUrl: string, connectionId: string): WorkflowDraft {
  const t = extractTemporal(goal, ctx);
  const n = goal.toLowerCase();
  const rule = parseRule(t.recurrence);
  const hour = t.time?.h ?? 8;
  const minute = t.time?.m ?? 0;
  let cron = `${minute} ${hour} * * *`;
  let when = `todos os dias às ${hour}h${minute ? String(minute).padStart(2, '0') : ''}`;
  if (rule?.freq === 'WEEKLY' && rule.byDay.length) {
    cron = `${minute} ${hour} * * ${rule.byDay.map((d) => DAY_CODES[d]).join(',')}`;
    when = `toda ${rule.byDay.map((d) => DAY_NAMES[d]).join(', ')} às ${hour}h${minute ? String(minute).padStart(2, '0') : ''}`;
  } else if (rule?.freq === 'MONTHLY') {
    cron = `${minute} ${hour} 1 * *`;
    when = `todo dia 1 às ${hour}h`;
  }
  const isReport = /relat[oó]rio|resumo|indicador/.test(n);
  const name = `JARVIS · ${goal.replace(/^(jarvis,?\s*)?(quero que|preciso que|crie uma automa[cç][aã]o (que|para)?)\s*/i, '').slice(0, 60)}`;
  const sources = detectSources(n);

  const nodes = [
    { id: 'trigger', name: 'Agendamento', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } } },
    { id: 'fetch', name: 'Buscar dados (configurar)', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [240, 0], parameters: {}, notes: `Substitua por: ${sources.join('; ')}` },
    {
      id: 'build', name: 'Montar evento JARVIS', type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 0],
      parameters: {
        jsCode: [
          '// Monta o evento no contrato do JARVIS e assina com HMAC (requer NODE_FUNCTION_ALLOW_BUILTIN=crypto).',
          "const crypto = require('crypto');",
          "const secret = $env.JARVIS_EVENTS_SECRET; // configure no ambiente do n8n",
          'const body = JSON.stringify({',
          "  event_id: crypto.randomUUID(), event_type: 'workflow.execution.completed', schema_version: '" + EVENT_SCHEMA_VERSION + "',",
          "  source: 'n8n', workflow_id: $workflow.id, execution_id: $execution.id, occurred_at: new Date().toISOString(),",
          `  payload: { summary: ${isReport ? "'Relatório gerado'" : "'Execução concluída'"}, output: $input.all().map(i => i.json).slice(0, 50) },`,
          '});',
          'const ts = String(Math.floor(Date.now() / 1000));',
          "const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');",
          'return [{ json: { body, ts, sig } }];',
        ].join('\n'),
      },
    },
    {
      id: 'send', name: 'Enviar ao JARVIS', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [720, 0],
      parameters: {
        method: 'POST', url: jarvisEventsUrl, sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'X-Jarvis-Connection', value: connectionId },
          { name: 'X-Jarvis-Timestamp', value: '={{ $json.ts }}' },
          { name: 'X-Jarvis-Signature', value: '={{ $json.sig }}' },
        ] },
        sendBody: true, contentType: 'raw', rawContentType: 'application/json', body: '={{ $json.body }}',
      },
    },
  ];
  const connections = {
    Agendamento: { main: [[{ node: 'Buscar dados (configurar)', type: 'main', index: 0 }]] },
    'Buscar dados (configurar)': { main: [[{ node: 'Montar evento JARVIS', type: 'main', index: 0 }]] },
    'Montar evento JARVIS': { main: [[{ node: 'Enviar ao JARVIS', type: 'main', index: 0 }]] },
  };
  return {
    name,
    summary: [
      `Gatilho: ${when} (cron “${cron}”, fuso do n8n).`,
      `Fontes de dados: ${sources.join('; ')}.`,
      `Resultado enviado ao JARVIS com assinatura de segurança (evento “workflow.execution.completed”).`,
      'Criado INATIVO no n8n: configure a fonte de dados, teste e só então ative.',
    ],
    trigger: { kind: 'schedule', description: when, cron },
    needs: sources,
    workflow: { name, nodes, connections, settings: { executionOrder: 'v1', timezone: ctx.tz } },
  };
}
