// Teste exclusivo da stack local do Supabase com usuários descartáveis.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const api = 'http://127.0.0.1:54321';
const site = 'http://127.0.0.1:4174';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(key, 'A chave pública da stack local é obrigatória');
async function testAccount() {
  const client = createClient(api, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `jarvis-${randomUUID()}@example.com`;
  const password = randomUUID();
  const { data, error } = await client.auth.signUp({ email, password });
  assert.ifError(error);
  assert.ok(data.session, 'O teste requer confirmação automática no Auth local');
  return { client, email, password, jwt: data.session.access_token };
}
const owner = await testAccount();
const other = await testAccount();
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH });
try {
  const page = await browser.newPage({ timezoneId: 'America/Bahia', locale: 'pt-BR' });
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin === api && response.status() >= 400) {
      const body = await response.json().catch(() => ({}));
      console.log(url.pathname, response.status(), body.code ?? '');
    }
  });
  await page.goto(site);
  await page.getByLabel('E-mail').fill(owner.email);
  await page.getByLabel('Senha').fill(owner.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const input = page.getByLabel('Comando para o JARVIS');
  await input.fill('anote que preciso revisar o contrato');
  await input.press('Enter');
  await page.getByText(/Anotação “Preciso revisar o contrato” salva/).waitFor();
  await page.reload();
  await page.goto(site + '/notas');
  await page.getByText('Preciso revisar o contrato', { exact: true }).first().waitFor();
  const own = await owner.client.from('notes').select('id').single();
  assert.ifError(own.error);
  const foreign = await other.client.from('notes').select('id').eq('id', own.data.id);
  assert.ifError(foreign.error);
  assert.deepEqual(foreign.data, []);
  console.log('Login, sessão após recarga, anotação persistida e isolamento entre usuários aprovados.');
} finally {
  await browser.close();
}

execFileSync('deno', ['test', '--config', 'supabase/functions/deno.json', '--frozen', '--allow-read', '--allow-env', '--allow-net', 'supabase/tests/edge_authenticated.ts'], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_URL: api, JARVIS_TEST_SESSION: owner.jwt },
});
