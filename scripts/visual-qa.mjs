// QA visual e de estabilidade (FASE 9). Uso: node scripts/visual-qa.mjs [url] [pasta-de-capturas]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SHOTS = process.argv[3] ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ROUTES = ['/', '/conversar', '/executivo', '/automacoes', '/agenda', '/tarefas', '/notas', '/projetos', '/rotinas', '/foco', '/conhecimento', '/relatorios', '/ai-engine', '/configuracoes'];
const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800, mobile: true, dpr: 3 },
  { name: '375x812', width: 375, height: 812, mobile: true, dpr: 3 },
  { name: '390x844', width: 390, height: 844, mobile: true, dpr: 3 },
  { name: '412x915', width: 412, height: 915, mobile: true, dpr: 2.625 },
  { name: 'tablet 768x1024', width: 768, height: 1024, mobile: true, dpr: 2 },
  { name: 'desktop 1440x900', width: 1440, height: 900, mobile: false, dpr: 1 },
];
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); if (!ok) console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`); };

const browser = await chromium.launch();
async function newPage(vp, gfx) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, isMobile: vp.mobile, hasTouch: vp.mobile, locale: 'pt-BR', timezoneId: 'America/Bahia' });
  if (gfx) await ctx.addInitScript((g) => localStorage.setItem('jarvis:gfx', g), gfx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { ctx, page, errors };
}

// 1. Todas as telas em todos os tamanhos
for (const vp of VIEWPORTS) {
  const { ctx, page, errors } = await newPage(vp);
  await page.goto(BASE);
  await page.waitForSelector('text=Franklin', { timeout: 20000 });
  // Dados de exemplo para telas não ficarem só no estado vazio
  if (vp.name === '412x915' || vp.name === '360x800') {
    for (const c of ['academia amanhã às 9', 'reunião com a equipe hoje às 23h', 'anote que preciso revisar o contrato', 'preciso estudar inglês']) {
      await page.goto(`${BASE}/conversar`);
      await page.getByLabel('Comando para o JARVIS').fill(c);
      await page.getByLabel('Comando para o JARVIS').press('Enter');
      await page.waitForTimeout(400);
    }
  }
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);
    const m = await page.evaluate((vw) => {
      const nav = document.querySelector('nav[aria-label="Navegação"]');
      const navVisible = nav && getComputedStyle(nav).display !== 'none';
      const navTop = navVisible ? nav.getBoundingClientRect().top : innerHeight;
      const fab = document.querySelector('[aria-label="Criar novo item"]');
      const fabBox = fab?.getBoundingClientRect();
      window.scrollTo(0, document.documentElement.scrollHeight);
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const covered = [...document.querySelectorAll('main button, main a, main input, main textarea, main select')]
          .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' && b.bottom > navTop + 2 && b.top < innerHeight && !el.closest('[class*="sticky"]'); })
          .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30));
        const smallTargets = navVisible ? [...nav.querySelectorAll('a,button')].filter((a) => { const b = a.getBoundingClientRect(); return b.height < 44 || b.width < 44; }).length : 0;
        res({
          // Compara com a largura REAL do aparelho (no mobile, conteúdo largo alarga a janela de layout).
          overflowX: document.documentElement.scrollWidth > vw + 1 || innerWidth > vw + 1,
          wideEls: [...document.querySelectorAll('main *')].filter((el) => {
            if (el.getBoundingClientRect().right <= vw + 1) return false;
            // Ignora conteúdo dentro de áreas com rolagem/corte intencional (tabelas roláveis, textos com reticências).
            for (let a = el.parentElement; a && a.tagName !== 'MAIN'; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
            return true;
          }).slice(0, 2).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`),
          covered: covered.slice(0, 3),
          fabOverNav: fabBox && navVisible ? fabBox.bottom > navTop - 2 : false,
          smallTargets,
          title: document.querySelector('h1')?.textContent?.slice(0, 40) ?? '',
        });
      })));
    }, vp.width);
    const tag = `${vp.name} ${r}`;
    check(`${tag}: sem rolagem horizontal`, !m.overflowX && !m.wideEls.length, m.wideEls.join(' | '));
    check(`${tag}: nada escondido atrás da navegação`, !m.covered.length, m.covered.join(', '));
    check(`${tag}: botão + acima da navegação`, !m.fabOverNav);
    check(`${tag}: alvos de toque ≥ 44px na navegação`, m.smallTargets === 0, `${m.smallTargets} pequenos`);
    check(`${tag}: tela renderizada (título)`, Boolean(m.title), m.title);
    if (SHOTS && (vp.name === '412x915' || (vp.name === '360x800' && r === '/') || (vp.name.startsWith('desktop') && r === '/'))) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${vp.name.split(' ').pop()}${r === '/' ? '-inicio' : r.replace(/\//g, '-')}.png` });
    }
  }
  check(`${vp.name}: sem erros de console em todas as telas`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// 2. Menu “+” abre as 5 ações e leva ao formulário certo
{
  const { ctx, page } = await newPage(VIEWPORTS[3]);
  await page.goto(BASE); await page.waitForSelector('text=Franklin');
  await page.getByLabel('Criar novo item').click();
  const items = await page.getByRole('menuitem').allTextContents();
  check('Menu +: Tarefa, Anotação, Compromisso, Projeto, Lembrete', ['Tarefa', 'Anotação', 'Compromisso', 'Projeto', 'Lembrete'].every((x) => items.some((i) => i.includes(x))), items.join(','));
  await page.getByRole('menuitem', { name: /Compromisso/ }).click();
  check('Menu +: Compromisso abre o formulário', await page.getByRole('dialog', { name: 'Novo compromisso' }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  await ctx.close();
}

// 3. Estabilidade: recarregamentos, navegação, segundo plano, rotação
{
  const { ctx, page, errors } = await newPage(VIEWPORTS[3], 'balanced');
  await page.goto(BASE); await page.waitForSelector('text=Franklin');
  for (let i = 0; i < 5; i++) { await page.reload(); await page.waitForSelector('text=Franklin'); }
  check('5 recarregamentos seguidos sem erro', errors.length === 0, errors[0]);
  for (const r of [...ROUTES, ...ROUTES]) { await page.goto(`${BASE}${r}`); await page.waitForTimeout(120); }
  await page.goto(BASE); await page.waitForSelector('text=Franklin'); await page.waitForTimeout(3500);
  const contexts = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('Navegação repetida: no máximo 1 canvas ativo', contexts <= 1, String(contexts));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await page.waitForTimeout(500);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await page.waitForTimeout(500);
  check('Volta do segundo plano: app responde', await page.getByText('Resumo do dia').isVisible());
  await page.setViewportSize({ width: 915, height: 412 });
  await page.waitForTimeout(500);
  const landscapeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > 916 || innerWidth > 916);
  check('Rotação para paisagem sem rolagem horizontal', !landscapeOverflow);
  await page.setViewportSize({ width: 412, height: 915 });

  // Perda e recuperação do contexto gráfico (o que acontece quando a GPU descarta o WebGL)
  const hasGl = await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c && c.classList.contains('opacity-100'); }, null, { timeout: 8000 }).then(() => true, () => false);
  if (hasGl) {
    await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); window.__lc = g.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
    await page.waitForTimeout(400);
    const fallback = await page.evaluate(() => Boolean(document.querySelector('.animate-spin-slow')) && document.querySelector('canvas').classList.contains('opacity-0'));
    check('Perda do contexto WebGL: mostra o núcleo em CSS (sem tela preta)', fallback);
    await page.evaluate(() => window.__lc.restoreContext());
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => document.querySelector('canvas')?.classList.contains('opacity-100'));
    check('Contexto restaurado: núcleo 3D volta', Boolean(back));
  } else check('WebGL disponível no navegador de teste', false, 'não iniciou');
  check('Estabilidade: sem erros de console', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// 4. Níveis de qualidade e flags de diagnóstico
for (const gfx of ['high', 'balanced', 'economy']) {
  const { ctx, page, errors } = await newPage(VIEWPORTS[3], gfx);
  await page.goto(BASE); await page.waitForSelector('text=Franklin'); await page.waitForTimeout(3000);
  const s = await page.evaluate(() => ({ level: document.documentElement.dataset.gfx, webgl: document.querySelector('canvas')?.classList.contains('opacity-100') ?? false }));
  check(`Qualidade ${gfx}: aplicada`, s.level === gfx, s.level);
  check(`Qualidade ${gfx}: WebGL ${gfx === 'economy' ? 'desligado' : 'ativo'}`, gfx === 'economy' ? !s.webgl : s.webgl);
  check(`Qualidade ${gfx}: tarefas continuam funcionando`, await page.getByText('Resumo do dia').isVisible() && errors.length === 0, errors[0]);
  await ctx.close();
}
for (const flag of ['nowebgl', 'noblur', 'nogrid', 'noglow', 'noanim']) {
  const { ctx, page, errors } = await newPage(VIEWPORTS[3]);
  await page.goto(`${BASE}/?diag=${flag}`); await page.waitForSelector('text=Franklin');
  const d = await page.evaluate(() => document.documentElement.dataset.diag);
  check(`Diagnóstico ?diag=${flag}`, d === flag && errors.length === 0, d);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações de QA passaram`);
process.exit(failed.length ? 1 : 0);
