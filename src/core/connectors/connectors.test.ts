import { describe, it, expect } from 'vitest';
import { HttpConnector } from './http.ts';
import { authorize, requiresConfirmation, type AuthorizedContext } from './types.ts';
import { signPayload, verifySignature, JarvisEvent } from '../integration/contract.ts';
import { encryptSecret, decryptSecret, importMasterKey, randomSecret } from '../integration/crypto.ts';
import { N8nClient, summarizeWorkflow, mapExecutionStatus, normalizeBaseUrl } from '../integration/n8n.ts';

const ctx = (over: Partial<AuthorizedContext> = {}): AuthorizedContext => ({ userId: 'u', scopes: ['metrics:read'], confirmed: false, correlationId: crypto.randomUUID(), ...over });

function fakeFetch(routes: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    const r = routes[key](init);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  return { fn, calls };
}

describe('Project Connector SDK', () => {
  it('política de confirmação por risco', () => {
    expect(requiresConfirmation('read')).toBe(false);
    expect(requiresConfirmation('reversible')).toBe(false);
    expect(requiresConfirmation('external')).toBe(true);
    expect(requiresConfirmation('destructive')).toBe(true);
  });

  it('nega escopo não autorizado e escrita sensível sem confirmação', () => {
    const cap = { id: 'x', name: 'x', description: '', risk: 'sensitive' as const, scope: 'orders:write' };
    expect(authorize(cap, ctx()).ok).toBe(false);
    expect(authorize(cap, ctx({ scopes: ['orders:write'] })).ok).toBe(false);
    expect(authorize(cap, ctx({ scopes: ['orders:write'], confirmed: true })).ok).toBe(true);
  });

  it('HttpConnector: saúde, capacidades e ação com origem e horário', async () => {
    const f = fakeFetch({
      '/jarvis/health': () => ({ body: { status: 'healthy', detail: 'ok' } }),
      '/jarvis/capabilities': () => ({ body: { capabilities: [{ id: 'metrics.summary', name: 'M', description: '', risk: 'read', scope: 'metrics:read' }, { id: 'orders.cancel', name: 'C', description: '', risk: 'destructive', scope: 'orders:write' }] } }),
      '/jarvis/actions/metrics.summary': () => ({ body: { ok: true, data: { empresas_ativas: 42 } } }),
    });
    const c = new HttpConnector('fly', 'FlyDelivery', 'https://api.fly.test', 'tok', f.fn);
    expect((await c.healthCheck()).status).toBe('healthy');
    const r = await c.executeAction('metrics.summary', {}, ctx());
    expect(r).toMatchObject({ ok: true, data: { empresas_ativas: 42 }, source: 'FlyDelivery' });
    expect(r.fetchedAt).toBeTruthy();
    expect(f.calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    const denied = await c.executeAction('orders.cancel', {}, ctx({ scopes: ['*'] }));
    expect(denied.ok).toBe(false);
    expect(f.calls.some((x) => x.url.includes('orders.cancel'))).toBe(false);
  });

  it('exige HTTPS e trata token recusado', async () => {
    expect(() => new HttpConnector('a', 'A', 'http://inseguro', 't')).toThrow();
    const f = fakeFetch({ '/jarvis/health': () => ({ status: 401 }) });
    expect((await new HttpConnector('a', 'A', 'https://x.test', 't', f.fn).healthCheck()).status).toBe('unauthorized');
  });
});

describe('Contrato de eventos e assinatura', () => {
  const secret = 'segredo-de-teste';
  const body = JSON.stringify({ a: 1 });
  it('aceita assinatura válida e rejeita adulteração, ausência e replay', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await signPayload(secret, ts, body);
    expect((await verifySignature(secret, ts, sig, body)).ok).toBe(true);
    expect(await verifySignature(secret, ts, sig, body + ' ')).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await verifySignature('outro', ts, sig, body)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await verifySignature(secret, null, sig, body)).toEqual({ ok: false, reason: 'missing' });
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(await verifySignature(secret, old, await signPayload(secret, old, body), body)).toEqual({ ok: false, reason: 'stale' });
  });
  it('assinatura gerada no n8n (crypto do Node, como no modelo) é aceita', async () => {
    const { createHmac } = await import('node:crypto');
    const ts = String(Math.floor(Date.now() / 1000));
    const n8nSig = 'sha256=' + createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
    expect((await verifySignature(secret, ts, n8nSig, body)).ok).toBe(true);
  });
  it('valida o contrato versionado', () => {
    const ok = JarvisEvent.safeParse({ event_id: 'evt-12345678', event_type: 'workflow.execution.completed', schema_version: '1.0', source: 'n8n', occurred_at: new Date().toISOString(), correlation_id: crypto.randomUUID(), payload: {} });
    expect(ok.success).toBe(true);
    expect(JarvisEvent.safeParse({ event_id: 'x', event_type: 'qualquer', schema_version: '2.0' }).success).toBe(false);
  });
});

describe('Criptografia de credenciais', () => {
  it('cifra, decifra e amarra ao dono', async () => {
    const key = await importMasterKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
    const enc = await encryptSecret(key, 'n8n_api_key_123', 'conn:1');
    expect(enc).not.toContain('n8n_api_key_123');
    expect(await decryptSecret(key, enc, 'conn:1')).toBe('n8n_api_key_123');
    await expect(decryptSecret(key, enc, 'conn:2')).rejects.toThrow();
    expect(randomSecret().length).toBeGreaterThan(30);
  });
});

describe('Cliente n8n', () => {
  it('normaliza URL e exige HTTPS', () => {
    expect(normalizeBaseUrl('https://n8n.exemplo.com/api/v1/')).toBe('https://n8n.exemplo.com');
    expect(() => normalizeBaseUrl('http://n8n.exemplo.com')).toThrow();
  });
  it('detecta gatilhos e caminhos de webhook', () => {
    const s = summarizeWorkflow({ id: '7', name: 'Vendas', activeVersionId: 'v1', tags: [{ name: 'connectfly' }], nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { path: 'relatorio-vendas' } }, { type: 'n8n-nodes-base.scheduleTrigger' }] });
    expect(s).toMatchObject({ id: '7', active: true, tags: ['connectfly'], webhookPaths: ['relatorio-vendas'] });
    expect(s.triggers.sort()).toEqual(['schedule', 'webhook']);
  });
  it('estados reais de conexão', async () => {
    const ok = fakeFetch({ '/api/v1/workflows': () => ({ body: { data: [] } }) });
    expect((await new N8nClient('https://n8n.test', 'k', ok.fn).test()).status).toBe('connected');
    expect(ok.calls[0].init?.headers).toMatchObject({ 'X-N8N-API-KEY': 'k' });
    const unauth = fakeFetch({ '/api/v1/workflows': () => ({ status: 401 }) });
    expect((await new N8nClient('https://n8n.test', 'k', unauth.fn).test()).status).toBe('unauthorized');
    const down = { fn: async () => { throw new Error('ECONNREFUSED'); } };
    expect((await new N8nClient('https://n8n.test', 'k', down.fn).test()).status).toBe('unavailable');
  });
  it('paginação por cursor', async () => {
    let n = 0;
    const f = fakeFetch({ '/api/v1/workflows': () => ({ body: n++ === 0 ? { data: [{ id: 1, name: 'A' }], nextCursor: 'c2' } : { data: [{ id: 2, name: 'B' }], nextCursor: null } }) });
    const list = await new N8nClient('https://n8n.test', 'k', f.fn).listWorkflows();
    expect(list.map((w) => w.name)).toEqual(['A', 'B']);
    expect(f.calls[1].url).toContain('cursor=c2');
  });
  it('mapeia status de execução', () => {
    expect(mapExecutionStatus('success')).toBe('succeeded');
    expect(mapExecutionStatus('crashed')).toBe('failed');
    expect(mapExecutionStatus('waiting')).toBe('running');
  });
});
