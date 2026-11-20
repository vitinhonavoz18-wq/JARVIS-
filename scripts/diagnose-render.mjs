// Diagnóstico de renderização (FASE 1): mede camadas de composição da GPU, memória estimada,
// validade do alpha pré-multiplicado do WebGL, erros de console e estouro horizontal.
// Uso: node scripts/diagnose-render.mjs [url] [rótulo]   (servidor rodando; Chromium do Playwright)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const LABEL = process.argv[3] ?? 'atual';
const DEVICES = [
  { name: 'Android 412x915 @2.625', width: 412, height: 915, dpr: 2.625 },
  { name: 'Android 360x800 @3', width: 360, height: 800, dpr: 3 },
];
const QUERY = process.argv[4] ?? '';

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const out = [];
for (const d of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Bahia',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' });
  // Força preserveDrawingBuffer para conseguir ler os pixels reais produzidos pelo WebGL.
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === 'webgl' || type === 'webgl2') attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
      return orig.call(this, type, attrs);
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${BASE}/${QUERY}`);
  await page.waitForSelector('text=Franklin', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('LayerTree.enable');
  const layers = await new Promise((resolve) => {
    cdp.on('LayerTree.layerTreeDidChange', (e) => e.layers && resolve(e.layers));
    page.evaluate(() => window.scrollBy(0, 1));
    setTimeout(() => resolve(null), 4000);
  });
  const drawn = (layers ?? []).filter((l) => l.drawsContent);
  const memMB = drawn.reduce((a, l) => a + l.width * l.height * d.dpr * d.dpr * 4, 0) / 1048576;
  const big = drawn.filter((l) => l.width >= d.width * 0.9 && l.height >= d.height * 0.5).length;
  const css = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
    return {
      backdrop: all.filter((el) => { const v = cs(el, 'backdrop-filter') || cs(el, '-webkit-backdrop-filter'); return v && v !== 'none'; }).length,
      masks: all.filter((el) => { const v = cs(el, 'mask-image') || cs(el, '-webkit-mask-image'); return v && v !== 'none'; }).length
        + all.filter((el) => { const v = getComputedStyle(el, '::after').getPropertyValue('-webkit-mask-image'); return v && v !== 'none'; }).length
        + (getComputedStyle(document.body, '::before').getPropertyValue('mask-image') !== 'none' ? 1 : 0),
      infiniteAnims: all.filter((el) => cs(el, 'animation-iteration-count') === 'infinite' && cs(el, 'animation-name') !== 'none').length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      domNodes: all.length,
    };
  });
  // Pixels do WebGL: no modo pré-multiplicado, cada canal de cor precisa ser <= alpha.
  const gl = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].find((x) => x.width > 50);
    if (!c) return { present: false };
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return { present: true, context: false };
    const w = g.drawingBufferWidth, h = g.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
    let lit = 0, invalid = 0, worst = 0;
    for (let i = 0; i < px.length; i += 4) {
      const m = Math.max(px[i], px[i + 1], px[i + 2]);
      if (m || px[i + 3]) lit++;
      if (m > px[i + 3] + 2) { invalid++; worst = Math.max(worst, m - px[i + 3]); }
    }
    const attrs = g.getContextAttributes();
    return { present: true, context: true, buffer: `${w}x${h}`, premultipliedAlpha: attrs.premultipliedAlpha, alpha: attrs.alpha, litPixels: lit, invalidPremultiplied: invalid, invalidPct: lit ? +(100 * invalid / lit).toFixed(1) : 0, worstExcess: worst };
  });
  out.push({ device: d.name, layers: layers?.length ?? 'n/d', drawingLayers: drawn.length, fullScreenLayers: big, compositedMemoryMB: +memMB.toFixed(1), ...css, webgl: gl, errors: errors.slice(0, 3) });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ label: LABEL, query: QUERY, results: out }, null, 2));
