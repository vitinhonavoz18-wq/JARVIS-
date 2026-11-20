/**
 * Automation Engine (servidor): fila persistente de execuções, despacho para webhooks do n8n
 * com assinatura HMAC, retentativas com backoff, acompanhamento de status e conectores de projetos.
 * Todas as consultas filtram pelo dono (user_id) — o servidor usa a chave de serviço.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret, importMasterKey, randomSecret } from '../../../src/core/integration/crypto.ts';
import { signPayload } from '../../../src/core/integration/contract.ts';
import { N8nClient, mapExecutionStatus } from '../../../src/core/integration/n8n.ts';
import { HttpConnector } from '../../../src/core/connectors/http.ts';
import { buildWorkflowDraft } from '../../../src/core/integration/workflowBuilder.ts';
import type { ActionResult, Capability, ConnectorHealth } from '../../../src/core/connectors/types.ts';
import type { IntegrationServices, RunRequest } from '../../../src/core/integration/services.ts';
import type { Automation, AutomationRun } from '../../../src/core/types.ts';
import { log } from './http.ts';

const MAX_ATTEMPTS = 5;
type Owner = 'automation_connection' | 'automation' | 'connected_project';
type SecretName = 'api_key' | 'events_secret' | 'webhook_auth' | 'project_token';

let keyPromise: Promise<CryptoKey> | null = null;
function masterKey() {
  const k = Deno.env.get('INTEGRATIONS_ENCRYPTION_KEY');
  if (!k) throw new Error('INTEGRATIONS_ENCRYPTION_KEY não configurada no servidor.');
  return (keyPromise ??= importMasterKey(k));
}

export async function putSecret(db: SupabaseClient, userId: string, ownerType: Owner, ownerId: string, name: SecretName, value: string) {
  const value_enc = await encryptSecret(await masterKey(), value, `${ownerType}:${ownerId}:${name}`);
  const { error } = await db.from('integration_secrets').upsert({ user_id: userId, owner_type: ownerType, owner_id: ownerId, name, value_enc }, { onConflict: 'owner_type,owner_id,name' });
  if (error) throw new Error(error.message);
}

export async function getSecret(db: SupabaseClient, userId: string, ownerType: Owner, ownerId: string, name: SecretName): Promise<string | null> {
  const { data } = await db.from('integration_secrets').select('value_enc').eq('user_id', userId).eq('owner_type', ownerType).eq('owner_id', ownerId).eq('name', name).maybeSingle();
  return data ? decryptSecret(await masterKey(), data.value_enc, `${ownerType}:${ownerId}:${name}`) : null;
}

export async function ensureEventsSecret(db: SupabaseClient, userId: string, connectionId: string, rotate = false): Promise<string | null> {
  const existing = rotate ? null : await getSecret(db, userId, 'automation_connection', connectionId, 'events_secret');
  if (existing) return null; // já existe: nunca é exibido de novo
  const secret = randomSecret(32);
  await putSecret(db, userId, 'automation_connection', connectionId, 'events_secret', secret);
  return secret;
}

export async function n8nClientFor(db: SupabaseClient, userId: string, connectionId: string): Promise<N8nClient> {
  const { data: conn } = await db.from('automation_connections').select('*').eq('id', connectionId).eq('user_id', userId).maybeSingle();
  if (!conn) throw new Error('Conexão n8n não encontrada.');
  const key = await getSecret(db, userId, 'automation_connection', connectionId, 'api_key');
  if (!key) throw new Error('Chave da API do n8n não cadastrada para esta conexão.');
  return new N8nClient(conn.base_url, key);
}

export async function testConnection(db: SupabaseClient, userId: string, connectionId: string) {
  let status = 'misconfigured';
  let detail = '';
  try {
    const r = await (await n8nClientFor(db, userId, connectionId)).test();
    status = r.status;
    detail = r.detail;
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  await db.from('automation_connections').update({ status, status_detail: detail, last_checked_at: new Date().toISOString() }).eq('id', connectionId).eq('user_id', userId);
  return { status, detail };
}

/** Descobre workflows (somente leitura) e a última execução conhecida de cada um. */
export async function syncWorkflows(db: SupabaseClient, userId: string, connectionId: string) {
  const client = await n8nClientFor(db, userId, connectionId);
  const { data: conn } = await db.from('automation_connections').select('authorized_projects').eq('id', connectionId).eq('user_id', userId).single();
  const projects: string[] = conn?.authorized_projects ?? [];
  let wfs = await client.listWorkflows();
  if (projects.length) wfs = wfs.filter((w) => w.projectId && projects.includes(w.projectId));
  const execs = await client.listExecutions({ limit: 100 }).catch(() => []);
  const rows = wfs.map((w) => {
    const last = execs.find((e) => e.workflowId === w.id);
    return {
      user_id: userId, connection_id: connectionId, n8n_id: w.id, name: w.name, active: w.active, tags: w.tags, n8n_project_id: w.projectId,
      description: w.description, triggers: w.triggers, webhook_paths: w.webhookPaths,
      last_execution_status: last?.status ?? null, last_execution_at: last?.stoppedAt ?? last?.startedAt ?? null, synced_at: new Date().toISOString(),
    };
  });
  if (rows.length) {
    const { error } = await db.from('automation_workflows').upsert(rows, { onConflict: 'connection_id,n8n_id' });
    if (error) throw new Error(error.message);
  }
  await db.from('automation_connections').update({ last_sync_at: new Date().toISOString(), status: 'connected', status_detail: `${rows.length} workflow(s) sincronizado(s).` }).eq('id', connectionId).eq('user_id', userId);
  return rows.length;
}

/* ------------------------------ Execuções ------------------------------ */

function eventsUrl() {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/jarvis-events`;
}

/** Envia UMA tentativa ao webhook. Atualiza o status real da execução. */
export async function dispatchRun(db: SupabaseClient, run: AutomationRun): Promise<AutomationRun> {
  const { data: auto } = await db.from('automations').select('*').eq('id', run.automation_id).eq('user_id', run.user_id).single<Automation>();
  if (!auto || !auto.enabled) return finish(db, run, 'failed', { error: 'Automação desativada ou removida.' });
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    correlation_id: run.correlation_id, automation: auto.name, input: run.input, requested_at: run.requested_at,
    callback: { url: eventsUrl(), connection_id: auto.connection_id, schema_version: '1.0' },
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Jarvis-Correlation-Id': run.correlation_id, 'X-Jarvis-Timestamp': ts };
  const eventsSecret = await getSecret(db, run.user_id, 'automation_connection', auto.connection_id, 'events_secret');
  if (eventsSecret) headers['X-Jarvis-Signature'] = await signPayload(eventsSecret, ts, body);
  if (auto.auth_header_name) {
    const v = await getSecret(db, run.user_id, 'automation', auto.id, 'webhook_auth');
    if (v) headers[auto.auth_header_name] = v;
  }
  let res: Response;
  try {
    res = await fetch(auto.webhook_url, { method: 'POST', headers, body, signal: AbortSignal.timeout(auto.mode === 'sync' ? 60_000 : 20_000) });
  } catch (e) {
    return retryOrFail(db, run, `n8n inacessível: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) await res.body?.cancel().catch(() => {}); // libera a conexão
  if (res.status === 429 || res.status >= 500) return retryOrFail(db, run, `n8n respondeu ${res.status}`);
  if (!res.ok) return finish(db, run, 'failed', { error: res.status === 404 ? 'Webhook não encontrado (workflow inativo ou caminho errado).' : res.status === 401 || res.status === 403 ? 'Webhook recusou a autenticação.' : `Webhook respondeu ${res.status}.` });
  const payload = (await res.json().catch(() => ({}))) as { jarvis?: { status?: string; summary?: string; output?: Record<string, unknown>; execution_id?: string } };
  const j = payload.jarvis;
  // Modo síncrono: o workflow responde com o resultado final no contrato { jarvis: { status, summary, output } }.
  if (auto.mode === 'sync' && j?.status === 'succeeded') return finish(db, run, 'succeeded', { output_summary: j.summary ?? null, output: j.output ?? null, n8n_execution_id: j.execution_id ?? null });
  if (auto.mode === 'sync' && j?.status === 'failed') return finish(db, run, 'failed', { error: j.summary ?? 'Falha informada pelo workflow.' });
  // Assíncrono (padrão): aceito ≠ concluído. O término chega por evento ou expira no prazo.
  const { data } = await db.from('automation_runs').update({ status: 'started', started_at: new Date().toISOString(), n8n_execution_id: j?.execution_id ?? null, error: null })
    .eq('id', run.id).eq('user_id', run.user_id).select('*').single();
  return data as AutomationRun;
}

async function retryOrFail(db: SupabaseClient, run: AutomationRun, error: string) {
  if (run.attempts >= MAX_ATTEMPTS) return finish(db, run, 'failed', { error: `${error} (após ${run.attempts} tentativas)` });
  const wait = Math.min(15, 2 ** run.attempts) * 60_000; // 2, 4, 8, 15 min
  const { data } = await db.from('automation_runs').update({ status: 'queued', error, next_attempt_at: new Date(Date.now() + wait).toISOString() }).eq('id', run.id).eq('user_id', run.user_id).select('*').single();
  log('automation_retry', { run: run.id, attempts: run.attempts, error });
  return data as AutomationRun;
}

export async function finish(db: SupabaseClient, run: AutomationRun, status: 'succeeded' | 'failed' | 'cancelled', extra: Partial<AutomationRun>): Promise<AutomationRun> {
  const { data } = await db.from('automation_runs').update({ status, finished_at: new Date().toISOString(), ...extra }).eq('id', run.id).eq('user_id', run.user_id).select('*').single();
  if (status === 'failed') {
    const { data: auto } = await db.from('automations').select('name,alert_on_failure').eq('id', run.automation_id).single();
    if (auto?.alert_on_failure) {
      await db.from('alerts').insert({ user_id: run.user_id, severity: 'warning', title: `Automação falhou: ${auto.name}`, body: extra.error ?? null, source: 'automation', link: '/automacoes' });
    }
  }
  return data as AutomationRun;
}

/** Processa a fila (chamado pelo cron a cada minuto). */
export async function processQueue(db: SupabaseClient) {
  const { data: claimed } = await db.rpc('claim_automation_runs', { p_limit: 50 });
  let n = 0;
  for (const run of (claimed ?? []) as AutomationRun[]) {
    await dispatchRun(db, run).catch((e) => log('automation_dispatch_error', { run: run.id, error: String(e) }));
    n++;
  }
  const { data: expired } = await db.rpc('expire_automation_runs');
  return { dispatched: n, expired: expired ?? 0 };
}

/* ----------------------------- Conectores ----------------------------- */

async function connectorFor(db: SupabaseClient, userId: string, projectId: string) {
  const { data: p } = await db.from('connected_projects').select('*').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (!p) throw new Error('Projeto não encontrado.');
  if (!p.enabled) throw new Error('Projeto desativado.');
  return p;
}

export async function projectHealth(db: SupabaseClient, userId: string, projectId: string): Promise<ConnectorHealth> {
  const p = await connectorFor(db, userId, projectId);
  let health: ConnectorHealth;
  let caps: Capability[] = p.capabilities ?? [];
  if (p.connector_type === 'http' && p.base_url) {
    const token = await getSecret(db, userId, 'connected_project', projectId, 'project_token');
    if (!token) health = { status: 'unauthorized', detail: 'Token do projeto não cadastrado.', checkedAt: new Date().toISOString() };
    else {
      const c = new HttpConnector(p.id, p.name, p.base_url, token);
      health = await c.healthCheck();
      if (health.status === 'healthy' || health.status === 'degraded') caps = await c.listCapabilities().catch(() => caps);
    }
  } else if (p.connector_type === 'n8n') {
    const { data: autos } = await db.from('automations').select('category,name,risk,description').eq('user_id', userId).eq('project_id', projectId).eq('enabled', true).eq('mode', 'sync');
    caps = (autos ?? []).filter((a: { category: string | null }) => a.category).map((a: { category: string; name: string; risk: Capability['risk']; description: string | null }) => ({ id: a.category, name: a.name, description: a.description ?? '', risk: a.risk, scope: '*' }));
    health = { status: caps.length ? 'healthy' : 'degraded', detail: caps.length ? `${caps.length} capacidade(s) via n8n.` : 'Nenhuma automação síncrona vinculada a este projeto.', checkedAt: new Date().toISOString() };
  } else health = { status: 'not_configured', detail: 'Conector não configurado.', checkedAt: new Date().toISOString() };
  await db.from('connected_projects').update({ status: health.status, status_detail: health.detail, last_health_at: health.checkedAt, capabilities: caps }).eq('id', projectId).eq('user_id', userId);
  return health;
}

export async function projectAction(db: SupabaseClient, userId: string, projectId: string, capability: string, input: Record<string, unknown>, confirmed: boolean): Promise<ActionResult> {
  const p = await connectorFor(db, userId, projectId);
  const fetchedAt = new Date().toISOString();
  let result: ActionResult;
  if (p.connector_type === 'http' && p.base_url) {
    const token = await getSecret(db, userId, 'connected_project', projectId, 'project_token');
    if (!token) return { ok: false, error: 'Token do projeto não cadastrado.', source: p.name, fetchedAt };
    const c = new HttpConnector(p.id, p.name, p.base_url, token);
    result = await c.executeAction(capability, input, { userId, scopes: p.scopes, confirmed, correlationId: crypto.randomUUID() });
  } else if (p.connector_type === 'n8n') {
    const { data: auto } = await db.from('automations').select('*').eq('user_id', userId).eq('project_id', projectId).eq('category', capability).eq('enabled', true).eq('mode', 'sync').maybeSingle<Automation>();
    if (!auto) return { ok: false, error: `Nenhuma automação síncrona fornece “${capability}” para ${p.name}.`, source: p.name, fetchedAt };
    if ((auto.risk !== 'read' && auto.risk !== 'reversible') && !confirmed) return { ok: false, error: 'Esta ação exige sua confirmação.', source: p.name, fetchedAt };
    const run = await createRun(db, userId, { automationId: auto.id, input, source: 'ai' });
    const done = await dispatchRun(db, run);
    result = done.status === 'succeeded'
      ? { ok: true, data: done.output ?? { resumo: done.output_summary }, source: `${p.name} via n8n (${auto.name})`, fetchedAt }
      : { ok: false, error: done.error ?? `Execução ${done.status}.`, source: p.name, fetchedAt };
  } else return { ok: false, error: `${p.name}: conector não configurado.`, source: p.name, fetchedAt };
  if (result.ok && result.data && typeof result.data === 'object') {
    // Projetos agregados: nada de dados pessoais guardados em snapshots.
    await db.from('project_snapshots').insert({ user_id: userId, project_id: projectId, capability, data: Array.isArray(result.data) ? { itens: result.data } : result.data, source: result.source, fetched_at: result.fetchedAt });
  }
  return result;
}

/* ------------------------------ Serviços ------------------------------ */

export async function createRun(db: SupabaseClient, userId: string, req: RunRequest): Promise<AutomationRun> {
  const { data: auto } = await db.from('automations').select('id,timeout_seconds,enabled').eq('id', req.automationId).eq('user_id', userId).single();
  if (!auto?.enabled) throw new Error('Automação não encontrada ou desativada.');
  const now = new Date();
  const row = {
    user_id: userId, automation_id: req.automationId, status: 'requested', input: req.input, source: req.source,
    idempotency_key: req.idempotencyKey ?? null, attempts: 1, requested_at: now.toISOString(),
    timeout_at: new Date(now.getTime() + auto.timeout_seconds * 1000).toISOString(),
  };
  const { data, error } = await db.from('automation_runs').insert(row).select('*').single();
  if (error) {
    if (error.code === '23505' && req.idempotencyKey) {
      const { data: prev } = await db.from('automation_runs').select('*').eq('user_id', userId).eq('idempotency_key', req.idempotencyKey).single();
      return prev as AutomationRun;
    }
    throw new Error(error.message);
  }
  await db.from('automations').update({ last_run_at: now.toISOString() }).eq('id', req.automationId).eq('user_id', userId);
  return data as AutomationRun;
}

export async function refreshRun(db: SupabaseClient, userId: string, runId: string): Promise<AutomationRun | null> {
  const { data: run } = await db.from('automation_runs').select('*').eq('id', runId).eq('user_id', userId).maybeSingle<AutomationRun>();
  if (!run || !run.n8n_execution_id || !['started', 'running'].includes(run.status)) return run ?? null;
  const { data: auto } = await db.from('automations').select('connection_id').eq('id', run.automation_id).single();
  try {
    const exec = await (await n8nClientFor(db, userId, auto!.connection_id)).getExecution(run.n8n_execution_id);
    const st = mapExecutionStatus(exec.status);
    if (st === 'succeeded' || st === 'failed' || st === 'cancelled') return finish(db, run, st, st === 'failed' ? { error: 'Execução terminou com erro no n8n.' } : {});
    if (st === 'running' && run.status !== 'running') {
      const { data } = await db.from('automation_runs').update({ status: 'running' }).eq('id', run.id).select('*').single();
      return data as AutomationRun;
    }
  } catch (e) {
    log('automation_refresh_error', { run: run.id, error: String(e) });
  }
  return run;
}

export function createServerServices(db: SupabaseClient, userId: string): IntegrationServices {
  return {
    async runAutomation(req) {
      try {
        const run = await createRun(db, userId, req);
        const after = run.status === 'requested' ? await dispatchRun(db, run) : run;
        return { ok: true, run: after, message: 'ok' };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
    async refreshRun(runId) {
      const run = await refreshRun(db, userId, runId);
      return run ? { ok: true, run, message: 'ok' } : { ok: false, message: 'Execução não encontrada.' };
    },
    projectAction: (id, cap, input, confirmed) => projectAction(db, userId, id, cap, input, confirmed),
    projectHealth: (id) => projectHealth(db, userId, id),
    async createWorkflowDraft(connectionId, goal, tz) {
      try {
        const draft = buildWorkflowDraft(goal, { now: new Date(), tz }, eventsUrl(), connectionId);
        const r = await (await n8nClientFor(db, userId, connectionId)).createWorkflow(draft.workflow);
        return { ok: true, workflowId: r.id, message: 'ok' };
      } catch (e) {
        return { ok: false, message: `Não foi possível criar no n8n: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

export { randomSecret };
