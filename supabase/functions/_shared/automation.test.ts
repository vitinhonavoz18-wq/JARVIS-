// Teste de integração do Automation Engine (Deno): n8n simulado via HTTP real + banco em memória.
// Rodar: deno test --config supabase/functions/deno.json --allow-net --allow-env supabase/functions/_shared/automation.test.ts
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1.0.13';

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
Deno.env.set('INTEGRATIONS_ENCRYPTION_KEY', key);
Deno.env.set('SUPABASE_URL', 'https://jarvis.test');

const { createRun, dispatchRun, putSecret, ensureEventsSecret, getSecret, processQueue } = await import('./automation.ts');
const { handleEvent } = await import('./events.ts');
const { verifySignature } = await import('../../../src/core/integration/contract.ts');

/* ---------------- banco em memória com a API do supabase-js usada pelo motor ---------------- */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const T = (n: string) => (tables[n] ??= []);
const uniques: Record<string, string[][]> = { integration_events: [['connection_id', 'event_id']], integration_secrets: [['owner_type', 'owner_id', 'name']] };

function builder(table: string) {
  let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  let payload: Row | Row[] | null = null;
  const filters: ((r: Row) => boolean)[] = [];
  let onConflict: string[] = [];
  const run = () => {
    const rows = T(table);
    if (op === 'insert' || op === 'upsert') {
      const list = Array.isArray(payload) ? payload : [payload!];
      const out: Row[] = [];
      for (const p of list) {
        const keys = op === 'upsert' ? onConflict : null;
        const existing = keys ? rows.find((r) => keys.every((k) => r[k] === p[k])) : null;
        if (existing) { Object.assign(existing, p); out.push(existing); continue; }
        for (const u of uniques[table] ?? []) if (rows.some((r) => u.every((k) => r[k] === p[k]))) return { data: null, error: { code: '23505', message: 'duplicate' } };
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), correlation_id: table === 'automation_runs' ? crypto.randomUUID() : undefined, ...p };
        rows.push(row);
        out.push(row);
      }
      return { data: out, error: null };
    }
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'update') hit.forEach((r) => Object.assign(r, payload));
    return { data: hit, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b; },
    upsert: (p: Row | Row[], o: { onConflict: string }) => { op = 'upsert'; payload = p; onConflict = o.onConflict.split(','); return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return b; },
    gte: () => b,
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => void) => res(run()),
  };
  return b;
}
const db = {
  from: builder,
  rpc: async (name: string) => {
    if (name === 'claim_automation_runs') {
      const q = T('automation_runs').filter((r) => r.status === 'queued' && String(r.next_attempt_at) <= new Date().toISOString());
      q.forEach((r) => { r.status = 'requested'; r.attempts = Number(r.attempts) + 1; });
      return { data: q, error: null };
    }
    return { data: 0, error: null };
  },
} as never;

/* ---------------- n8n simulado ---------------- */
const received: { headers: Headers; body: string }[] = [];
let behavior: 'async' | 'sync' | 'error500' | 'notfound' = 'async';
const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const body = await req.text();
  received.push({ headers: req.headers, body });
  if (behavior === 'error500') return new Response('boom', { status: 500 });
  if (behavior === 'notfound') return new Response('no', { status: 404 });
  if (behavior === 'sync') return Response.json({ jarvis: { status: 'succeeded', summary: '12 vendas na semana', output: { vendas: 12 } } });
  return Response.json({ message: 'Workflow was started' });
});
// O motor exige HTTPS no cadastro (validado no banco); aqui chamamos o servidor local direto.
const port = (server.addr as Deno.NetAddr).port;
const URL_ = `http://127.0.0.1:${port}/webhook/vendas`;

const USER = 'u1';
T('automation_connections').push({ id: 'conn1', user_id: USER });
const auto = { id: 'a1', user_id: USER, connection_id: 'conn1', name: 'Relatório de vendas', enabled: true, webhook_url: URL_, auth_header_name: 'X-Webhook-Token', mode: 'async', timeout_seconds: 900, alert_on_failure: true };
T('automations').push(auto);

let secret = '';
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'segredos ficam cifrados e o segredo de eventos é gerado uma única vez', fn: async () => {
  secret = (await ensureEventsSecret(db, USER, 'conn1'))!;
  assert(secret.length > 30);
  assertEquals(await ensureEventsSecret(db, USER, 'conn1'), null);
  await putSecret(db, USER, 'automation', 'a1', 'webhook_auth', 'token-do-webhook');
  assert(!JSON.stringify(T('integration_secrets')).includes('token-do-webhook'));
  assertEquals(await getSecret(db, USER, 'automation', 'a1', 'webhook_auth'), 'token-do-webhook');
} });

Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'modo assíncrono: envia assinado e autenticado; aceito ≠ concluído', fn: async () => {
  behavior = 'async';
  const run = await createRun(db, USER, { automationId: 'a1', input: { periodo: 'semana' }, source: 'voice' });
  const after = await dispatchRun(db, run);
  assertEquals(after.status, 'started');
  const last = received.at(-1)!;
  assertEquals(last.headers.get('x-webhook-token'), 'token-do-webhook');
  const v = await verifySignature(secret, last.headers.get('x-jarvis-timestamp'), last.headers.get('x-jarvis-signature'), last.body);
  assert(v.ok, 'assinatura HMAC deve ser válida');
  assertEquals(JSON.parse(last.body).correlation_id, run.correlation_id);

  // n8n informa o término por evento → concluída
  await handleEvent(db, USER, 'conn1', { event_id: 'evt-0001-ok', event_type: 'workflow.execution.completed', schema_version: '1.0', source: 'n8n', occurred_at: new Date().toISOString(), correlation_id: run.correlation_id, execution_id: '881', payload: { summary: 'Relatório enviado' } });
  const done = T('automation_runs').find((r) => r.id === run.id)!;
  assertEquals(done.status, 'succeeded');
  assertEquals(done.output_summary, 'Relatório enviado');
  // evento repetido é ignorado
  const dup = await handleEvent(db, USER, 'conn1', { event_id: 'evt-0001-ok', event_type: 'workflow.execution.failed', schema_version: '1.0', source: 'n8n', occurred_at: new Date().toISOString(), correlation_id: run.correlation_id, payload: {} });
  assertEquals(dup.duplicate, true);
  assertEquals(T('automation_runs').find((r) => r.id === run.id)!.status, 'succeeded');
} });

Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'modo síncrono: resultado final devolvido pelo workflow', fn: async () => {
  behavior = 'sync';
  auto.mode = 'sync';
  const after = await dispatchRun(db, await createRun(db, USER, { automationId: 'a1', input: {}, source: 'manual' }));
  assertEquals(after.status, 'succeeded');
  assertEquals(after.output_summary, '12 vendas na semana');
  auto.mode = 'async';
} });

Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'erro 500: volta para a fila com espera e, no limite, falha com alerta', fn: async () => {
  behavior = 'error500';
  const run = await createRun(db, USER, { automationId: 'a1', input: {}, source: 'manual' });
  let r = await dispatchRun(db, run);
  assertEquals(r.status, 'queued');
  assert(String(r.next_attempt_at) > new Date().toISOString());
  assertMatch(String(r.error), /500/);
  r.next_attempt_at = new Date(0).toISOString();
  (r as unknown as Row).attempts = 5;
  await processQueue(db);
  r = T('automation_runs').find((x) => x.id === run.id) as never;
  assertEquals(r.status, 'failed');
  assert(T('alerts').some((a) => String(a.title).includes('Automação falhou')));
} });

Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'webhook inexistente falha na hora com mensagem clara', fn: async () => {
  behavior = 'notfound';
  const r = await dispatchRun(db, await createRun(db, USER, { automationId: 'a1', input: {}, source: 'manual' }));
  assertEquals(r.status, 'failed');
  assertMatch(String(r.error), /Webhook não encontrado/);
} });

Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'alerta crítico vindo do n8n vira alerta + push', fn: async () => {
  await handleEvent(db, USER, 'conn1', { event_id: 'evt-alert-01', event_type: 'project.alert', schema_version: '1.0', source: 'n8n', occurred_at: new Date().toISOString(), payload: { severity: 'critical', title: 'FlyDelivery fora do ar' } });
  assert(T('alerts').some((a) => a.title === 'FlyDelivery fora do ar'));
  assert(T('reminders').some((r) => String(r.title).includes('FlyDelivery fora do ar')));
  await server.shutdown();
} });
