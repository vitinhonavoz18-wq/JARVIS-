// Empacota a pasta dist/ num único Cloudflare Worker (site estático + rotas da SPA).
// Uso: npm run build && node scripts/build-worker.mjs  →  gera deploy/worker.mjs
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const DIST = 'dist';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const path = '/' + relative(DIST, p).split('\\').join('/');
      if (path === '/_redirects') continue;
      files[path] = { t: TYPES[extname(p)] ?? 'application/octet-stream', b: readFileSync(p).toString('base64') };
    }
  }
})(DIST);

const worker = `// Gerado por scripts/build-worker.mjs — não edite à mão.
const FILES = ${JSON.stringify(files)};
const cache = new Map();
function body(f) {
  let b = cache.get(f);
  if (!b) { const s = atob(f.b); b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); cache.set(f, b); }
  return b;
}
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Método não permitido', { status: 405 });
    let path = decodeURIComponent(url.pathname);
    let f = FILES[path] ?? FILES[path.replace(/\\/$/, '') + '/index.html'];
    // Rotas do aplicativo (/agenda, /tarefas, …) caem no index.html.
    if (!f && !/\\.[a-z0-9]+$/i.test(path)) { f = FILES['/index.html']; path = '/index.html'; }
    if (!f) return new Response('Não encontrado', { status: 404, headers: SECURITY });
    const immutable = path.startsWith('/assets/');
    const headers = {
      ...SECURITY,
      'Content-Type': f.t,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    return new Response(request.method === 'HEAD' ? null : body(f), { headers });
  },
};
`;
mkdirSync('deploy', { recursive: true });
writeFileSync('deploy/worker.mjs', worker);
console.log(`deploy/worker.mjs: ${Object.keys(files).length} arquivos, ${(worker.length / 1024 / 1024).toFixed(2)} MB`);
