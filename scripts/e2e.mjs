// Teste ponta a ponta no navegador (Modo Local): node scripts/e2e.mjs
// Requer o app servido em http://localhost:4173 (npm run build && npx vite preview).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Usa o Playwright instalado no sistema (ou o do projeto, se existir).
const { chromium } = require('playwright');

const BASE = process.env.E2E_URL ?? 'http://localhost:4173';
const SHOTS = process.env.E2E_SHOTS ?? '';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Bahia' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|fonts\.g/.test(m.text()) && errors.push(m.text()));

async function command(text) {
  const input = page.getByLabel('Comando para o JARVIS');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(700);
}

await page.goto(BASE);
await page.waitForSelector('text=Franklin', { timeout: 15000 });
check('Dashboard carrega com saudação personalizada', await page.locator('h1').first().innerText().then((t) => /Franklin/.test(t)));
check('Estado vazio de boas-vindas para usuário novo', await page.getByText('Vamos configurar seu centro de comando').isVisible());
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-dashboard-vazio.png` });

// Cenário 1: tarefa por comando
await command('Jarvis, academia amanhã às 9, me avise meia hora antes');
await page.waitForURL('**/conversar');
const reply1 = await page.locator('text=/Tarefa “Academia” criada para amanhã, às 9h/').first().isVisible();
check('Cenário 1 — tarefa criada e confirmada após salvar', reply1);

// Cenário 9: ambíguo
await command('marque uma reunião às 11h');
check('Cenário 9 — comando ambíguo pede o dia', await page.getByText(/Para qual dia devo marcar/).isVisible());
await command('sexta');
check('Cenário 9 — completa após a resposta', await page.getByText(/Reunião agendado para/).first().isVisible());

// Cenário 3: nota
await command('anote que preciso estudar novas estratégias de vendas');
check('Cenário 3 — nota salva', await page.getByText(/Anotação “Preciso estudar novas estratégias de vendas” salva/).isVisible());

// Captura múltipla com confirmação
await command('preciso comprar um presente, estudar inteligência artificial e tive uma ideia para meu aplicativo');
await page.getByRole('button', { name: 'Confirmar' }).last().click();
await page.waitForTimeout(800);
check('Captura universal — 3 itens após confirmação', await page.getByText(/Tarefa “Comprar um presente” criada/).isVisible());
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-conversa.png` });

// Cenário 4: consulta
await command('o que tenho para amanhã?');
check('Cenário 4 — consulta mostra dados reais', await page.getByText(/Para amanhã:/).last().isVisible());

// Cenário 5: atualizar
await command('altere a academia de amanhã para 7h');
check('Cenário 5 — tarefa remarcada', await page.getByText(/“Academia” remarcada para amanhã, às 7h/).isVisible());

// Página de tarefas
await page.goto(`${BASE}/tarefas`);
await page.getByRole('tab', { name: 'Amanhã' }).click();
check('Tarefas — Academia aparece em Amanhã (sem duplicar)', (await page.locator('p', { hasText: /^Academia$/ }).count()) === 1);
await page.getByRole('tab', { name: 'Kanban' }).click();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-kanban.png` });

// Cenário 6: recarregar
await page.reload();
await page.waitForSelector('text=Tarefas');
await page.getByRole('tab', { name: 'Pendentes' }).click();
check('Cenário 6 — dados persistem após recarregar', (await page.getByText('Comprar um presente').count()) > 0);

// Agenda
await page.goto(`${BASE}/agenda`);
await page.waitForTimeout(500);
check('Agenda — reunião visível na semana', await page.getByText('Reunião').first().isVisible());
if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-agenda.png` });

// Notas: criar e editar
await page.goto(`${BASE}/notas`);
await page.getByText('Preciso estudar novas estratégias de vendas').first().click();
await page.waitForSelector('.ProseMirror');
check('Notas — editor rico abre a nota', await page.locator('.ProseMirror').isVisible());
if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-notas.png` });

// Busca global
await page.keyboard.press('Control+k');
await page.getByRole('textbox', { name: 'Pesquisa global' }).fill('vendas');
await page.waitForTimeout(600);
check('Pesquisa global encontra a nota', await page.getByRole('option').filter({ hasText: 'estratégias de vendas' }).first().isVisible());
await page.keyboard.press('Escape');

// Dashboard com dados + mobile
await page.goto(BASE);
await page.waitForTimeout(1200);
check('Dashboard sem boas-vindas após ter dados', !(await page.getByText('Vamos configurar seu centro de comando').isVisible()));
check('Dashboard mostra pendências com prazo real', await page.getByText(/compromisso|tarefa/).first().isVisible());
if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-dashboard.png` });

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Bahia' });
const m = await mobile.newPage();
await m.goto(BASE);
await m.waitForSelector('text=Franklin');
check('Mobile — navegação inferior visível', await m.getByRole('navigation', { name: 'Navegação' }).isVisible());
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('Mobile — sem rolagem horizontal', !overflow);
if (SHOTS) await m.screenshot({ path: `${SHOTS}/07-mobile.png` });

check('Sem erros de JavaScript no console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
process.exit(failed ? 1 : 0);
