// Integração exclusivamente com a stack efêmera do CI. Nenhum provedor pago é chamado.
import { assert, assertEquals } from 'jsr:@std/assert@1.0.13';
import { createClient } from '@supabase/supabase-js';
import { signPayload } from '../../src/core/integration/contract.ts';

const api = Deno.env.get('SUPABASE_URL');
assertEquals(api, 'http://127.0.0.1:54321');
const jwt = Deno.env.get('JARVIS_TEST_SESSION')!;
const bearer = { Authorization: 'Bearer ' + jwt };
const client = createClient(api!, Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY')!, { global: { headers: bearer } });
const cron = crypto.randomUUID();
Deno.env.set('CRON_SECRET', cron);
Deno.env.set('INTEGRATIONS_ENCRYPTION_KEY', btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));

Deno.test('funções com Auth, banco real, chave de atalho, Cron e evento assinado', async () => {
  const servers = new Map<string, Deno.HttpServer<Deno.NetAddr>>();
  const serve = Deno.serve;
  try {
    for (const slug of ['ai-chat', 'transcribe', 'automation-gateway', 'jarvis-command', 'process-reminders', 'jarvis-events']) {
      Deno.serve = ((handler: Deno.ServeHandler) => {
        const server = serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, handler);
        servers.set(slug, server);
        return server;
      }) as typeof Deno.serve;
      await import(`../functions/${slug}/index.ts`);
    }
    async function post(slug: string, body: string, headers: Record<string, string>, expected = 200) {
      const port = servers.get(slug)!.addr.port;
      const res = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
      const data = await res.json();
      assertEquals(res.status, expected, slug);
      return data;
    }
    assertEquals((await post('ai-chat', '{"ping":true}', bearer)).configured, false);
    await post('transcribe', '{}', bearer, 503);
    const connection = await post('automation-gateway', JSON.stringify({ action: 'save_connection', name: 'CI', environment: 'development', base_url: 'https://example.invalid' }), bearer);
    assert(connection.id && connection.events_secret);
    const body = JSON.stringify({ event_id: crypto.randomUUID(), event_type: 'project.activity', schema_version: '1.0', source: 'n8n', occurred_at: new Date().toISOString(), payload: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = { 'x-jarvis-connection': connection.id, 'x-jarvis-timestamp': ts, 'x-jarvis-signature': await signPayload(connection.events_secret, ts, body) };
    assertEquals((await post('jarvis-events', body, headers)).duplicate, false);
    assertEquals((await post('jarvis-events', body, headers)).duplicate, true);
    const shortcut = 'jfv_' + crypto.randomUUID().replaceAll('-', '');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shortcut));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const { error } = await client.from('api_tokens').insert({ name: 'CI', token_hash: hash, token_prefix: shortcut.slice(0, 8) });
    assertEquals(error, null);
    const result = await post('jarvis-command', JSON.stringify({ text: 'anote que preciso verificar o atalho' }), { Authorization: 'Bearer ' + shortcut });
    assert(result.reply.includes('salva'));
    assertEquals(typeof (await post('process-reminders', '{}', { 'x-cron-secret': cron })).processed, 'number');
  } finally {
    Deno.serve = serve;
    await Promise.all([...servers.values()].map(s => s.shutdown()));
  }
});
