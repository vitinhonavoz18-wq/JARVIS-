import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2] ?? 'http://localhost:4173';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__ctx = { created: 0, lost: 0 };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) {
    const c = orig.call(this, t, a);
    if ((t === 'webgl' || t === 'webgl2') && c && !this.__counted) {
      this.__counted = true; window.__ctx.created++;
      this.addEventListener('webglcontextlost', () => window.__ctx.lost++);
    }
    return c;
  };
});
const p = await ctx.newPage();
const warnings = [];
p.on('console', (m) => /WebGL|context/i.test(m.text()) && warnings.push(m.text().slice(0, 120)));
await p.goto(url); await p.waitForSelector('text=Franklin');
for (let i = 0; i < 20; i++) {
  await p.evaluate(() => { history.pushState({}, '', '/conversar'); dispatchEvent(new PopStateEvent('popstate')); });
  await p.waitForTimeout(250);
  await p.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await p.waitForTimeout(250);
}
await p.waitForTimeout(1000);
const r = await p.evaluate(() => ({ ...window.__ctx, liveCanvases: document.querySelectorAll('canvas').length }));
console.log(JSON.stringify({ ...r, warnings: [...new Set(warnings)].slice(0, 5), warningCount: warnings.length }));
await b.close();
