/**
 * Automation Studio / Central Executiva — operações autenticadas do usuário.
 * Nenhuma ação executa comandos arbitrários: só endpoints e automações registrados.
 */
import { z } from 'zod';
import { adminClient, cors, json, requireUser, log } from '../_shared/http.ts';
import {
  createServerServices, ensureEventsSecret, finish, n8nClientFor, projectAction, projectHealth, putSecret, syncWorkflows, testConnection,
} from '../_shared/automation.ts';
import { buildWorkflowDraft } from '../../../src/core/integration/workflowBuilder.ts';
import { normalizeBaseUrl } from '../../../src/core/integration/n8n.ts';

const A = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_connection'), id: z.string().uuid().optional(), name: z.string().min(1).max(80), base_url: z.string().url(), environment: z.enum(['production', 'development']), api_key: z.string().min(10).max(500).optional(), authorized_projects: z.array(z.string().max(100)).max(50).optional() }),
  z.object({ action: z.literal('test_connection'), id: z.string().uuid() }),
  z.object({ action: z.literal('rotate_events_secret'), id: z.string().uuid() }),
  z.object({ action: z.literal('sync'), id: z.string().uuid() }),
  z.object({ action: z.literal('set_automation_secret'), automation_id: z.string().uuid(), value: z.string().min(1).max(500) }),
  z.object({ action: z.literal('run'), automation_id: z.string().uuid(), input: z.record(z.string(), z.unknown()).default({}), source: z.enum(['manual', 'shortcut', 'voice', 'ai']).default('manual'), idempotency_key: z.string().max(100).optional() }),
  z.object({ action: z.literal('refresh_run'), run_id: z.string().uuid() }),
  z.object({ action: z.literal('cancel_run'), run_id: z.string().uuid() }),
  z.object({ action: z.literal('draft_workflow'), connection_id: z.string().uuid(), goal: z.string().min(10).max(500), tz: z.string().max(60).default('America/Bahia'), create: z.boolean().default(false) }),
  z.object({ action: z.literal('activate_workflow'), connection_id: z.string().uuid(), n8n_id: z.string().max(100), confirm: z.literal(true) }),
  z.object({ action: z.literal('set_project_token'), project_id: z.string().uuid(), token: z.string().min(8).max(500) }),
  z.object({ action: z.literal('project_health'), project_id: z.string().uuid() }),
  z.object({ action: z.literal('project_action'), project_id: z.string().uuid(), capability: z.string().max(80), input: z.record(z.string(), z.unknown()).default({}), confirmed: z.boolean().default(false) }),
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const parsed = A.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Requisição inválida', issues: parsed.error.issues.slice(0, 3).map((i) => i.message) }, 400);
  const db = adminClient();
  const uid = user.id;
  const b = parsed.data;
  try {
    switch (b.action) {
      case 'save_connection': {
        const base = normalizeBaseUrl(b.base_url);
        let id = b.id;
        if (id) {
          const { data: updated, error } = await db.from('automation_connections').update({ name: b.name, base_url: base, environment: b.environment, authorized_projects: b.authorized_projects ?? [] }).eq('id', id).eq('user_id', uid).select('id').maybeSingle();
          if (error) throw error;
          if (!updated) return json({ error: 'Conexão não encontrada.' }, 404);
        } else {
          const { data, error } = await db.from('automation_connections').insert({ user_id: uid, name: b.name, base_url: base, environment: b.environment, authorized_projects: b.authorized_projects ?? [] }).select('id').single();
          if (error) throw error;
          id = data.id;
        }
        if (b.api_key) await putSecret(db, uid, 'automation_connection', id!, 'api_key', b.api_key);
        const eventsSecret = await ensureEventsSecret(db, uid, id!);
        const test = await testConnection(db, uid, id!);
        return json({ id, ...test, events_secret: eventsSecret });
      }
      case 'test_connection':
        return json(await testConnection(db, uid, b.id));
      case 'rotate_events_secret':
        return json({ events_secret: await ensureEventsSecret(db, uid, b.id, true) });
      case 'sync':
        return json({ synced: await syncWorkflows(db, uid, b.id) });
      case 'set_automation_secret': {
        const { data } = await db.from('automations').select('id').eq('id', b.automation_id).eq('user_id', uid).maybeSingle();
        if (!data) return json({ error: 'Automação não encontrada.' }, 404);
        await putSecret(db, uid, 'automation', b.automation_id, 'webhook_auth', b.value);
        return json({ ok: true });
      }
      case 'run':
        return json(await createServerServices(db, uid).runAutomation({ automationId: b.automation_id, input: b.input, source: b.source, idempotencyKey: b.idempotency_key }));
      case 'refresh_run':
        return json(await createServerServices(db, uid).refreshRun(b.run_id));
      case 'cancel_run': {
        const { data: run } = await db.from('automation_runs').select('*').eq('id', b.run_id).eq('user_id', uid).maybeSingle();
        if (!run) return json({ error: 'Execução não encontrada.' }, 404);
        if (run.status === 'queued') return json({ ok: true, run: await finish(db, run, 'cancelled', { error: 'Cancelada antes do envio.' }) });
        if (!['requested', 'started', 'running'].includes(run.status)) return json({ ok: false, message: 'Execução já terminou.' });
        if (!run.n8n_execution_id) return json({ ok: false, message: 'O n8n não informou o id desta execução; não é possível interrompê-la com segurança pela API.' });
        const { data: auto } = await db.from('automations').select('connection_id').eq('id', run.automation_id).single();
        try {
          await (await n8nClientFor(db, uid, auto!.connection_id)).stopExecution(run.n8n_execution_id);
        } catch (e) {
          return json({ ok: false, message: `Esta instância do n8n não permitiu interromper a execução: ${e instanceof Error ? e.message : e}` });
        }
        return json({ ok: true, run: await finish(db, run, 'cancelled', { error: 'Interrompida pelo usuário.' }) });
      }
      case 'draft_workflow': {
        const draft = buildWorkflowDraft(b.goal, { now: new Date(), tz: b.tz }, `${Deno.env.get('SUPABASE_URL')}/functions/v1/jarvis-events`, b.connection_id);
        if (!b.create) return json({ draft });
        const r = await createServerServices(db, uid).createWorkflowDraft(b.connection_id, b.goal, b.tz);
        return json({ draft, ...r });
      }
      case 'activate_workflow':
        await (await n8nClientFor(db, uid, b.connection_id)).activateWorkflow(b.n8n_id);
        await syncWorkflows(db, uid, b.connection_id).catch(() => 0);
        return json({ ok: true });
      case 'set_project_token': {
        const { data } = await db.from('connected_projects').select('id').eq('id', b.project_id).eq('user_id', uid).maybeSingle();
        if (!data) return json({ error: 'Projeto não encontrado.' }, 404);
        await putSecret(db, uid, 'connected_project', b.project_id, 'project_token', b.token);
        return json(await projectHealth(db, uid, b.project_id));
      }
      case 'project_health':
        return json(await projectHealth(db, uid, b.project_id));
      case 'project_action':
        return json(await projectAction(db, uid, b.project_id, b.capability, b.input, b.confirmed));
    }
  } catch (e) {
    log('automation_gateway_error', { user: uid, action: b.action, error: e instanceof Error ? e.message.slice(0, 200) : 'erro' });
    return json({ error: e instanceof Error ? e.message : 'Erro inesperado.' }, 500);
  }
});
