/**
 * JARVIS Graphics Safe Mode — qualidade visual por aparelho.
 * Nunca desliga funcionalidades: só reduz efeitos (WebGL, partículas, desfoques, animações decorativas).
 * A escolha fica no próprio aparelho (localStorage), porque depende do hardware de cada um.
 */
export type GfxPref = 'auto' | 'high' | 'balanced' | 'economy';
export type GfxLevel = Exclude<GfxPref, 'auto'>;

export const GFX_LABEL: Record<GfxPref, string> = { auto: 'Automática', high: 'Alta', balanced: 'Equilibrada', economy: 'Econômica' };

const KEY = 'jarvis:gfx';
const SESSION_DOWNGRADE = 'jarvis:gfx-downgrade';

/** Flags de diagnóstico (?diag=nowebgl,noblur,nogrid,noglow,noanim) para isolar efeitos sem mudar o design. */
export const DIAG_FLAGS = ['nowebgl', 'noblur', 'nogrid', 'noglow', 'noanim'] as const;
export type DiagFlag = (typeof DIAG_FLAGS)[number];

function safeGet(store: Storage | undefined, k: string): string | null {
  try {
    return store?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function safeSet(store: Storage | undefined, k: string, v: string | null) {
  try {
    if (v === null) store?.removeItem(k);
    else store?.setItem(k, v);
  } catch {
    /* armazenamento indisponível */
  }
}

let webglCache: { ok: boolean; reason: string } | null = null;

/** Verifica WebGL UMA vez e libera o contexto de teste imediatamente. */
export function probeWebGL(): { ok: boolean; reason: string } {
  if (webglCache) return webglCache;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ?? c.getContext('webgl', { failIfMajorPerformanceCaveat: true })) as WebGLRenderingContext | null;
    if (!gl) webglCache = { ok: false, reason: 'WebGL indisponível ou apenas por software neste aparelho' };
    else {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      webglCache = { ok: true, reason: 'WebGL com aceleração por hardware' };
    }
  } catch {
    webglCache = { ok: false, reason: 'WebGL bloqueado' };
  }
  return webglCache;
}

export function readPref(): GfxPref {
  const v = safeGet(globalThis.localStorage, KEY);
  return v === 'high' || v === 'balanced' || v === 'economy' ? v : 'auto';
}

export function writePref(p: GfxPref) {
  safeSet(globalThis.localStorage, KEY, p === 'auto' ? null : p);
  safeSet(globalThis.sessionStorage, SESSION_DOWNGRADE, null);
  applyGraphics();
}

/** Detecção automática baseada em capacidades reais — não presume que todo celular é fraco. */
export function detectLevel(): { level: GfxLevel; reason: string } {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const down = safeGet(globalThis.sessionStorage, SESSION_DOWNGRADE) as GfxLevel | null;
  if (down) return { level: down, reason: 'reduzida automaticamente nesta sessão (quadros lentos ou perda do contexto gráfico)' };
  if (nav.connection?.saveData) return { level: 'economy', reason: 'modo de economia de dados ativo' };
  const gl = probeWebGL();
  if (!gl.ok) return { level: 'economy', reason: gl.reason };
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) return { level: 'economy', reason: `memória do aparelho: ${nav.deviceMemory} GB` };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { level: 'balanced', reason: 'preferência do sistema por menos movimento' };
  if ((typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) || (navigator.hardwareConcurrency ?? 8) <= 4) return { level: 'balanced', reason: 'hardware intermediário' };
  return { level: 'high', reason: 'WebGL acelerado e hardware suficiente' };
}

export function currentLevel(): { pref: GfxPref; level: GfxLevel; reason: string } {
  const pref = readPref();
  if (pref !== 'auto') return { pref, level: pref, reason: 'escolhida manualmente' };
  return { pref, ...detectLevel() };
}

/** Reduz um nível nesta sessão (só no modo automático). */
export function downgrade(why: string) {
  if (readPref() !== 'auto') return;
  const cur = currentLevel().level;
  const next: GfxLevel = cur === 'high' ? 'balanced' : 'economy';
  if (next === cur) return;
  safeSet(globalThis.sessionStorage, SESSION_DOWNGRADE, next);
  console.info(`[JARVIS gfx] qualidade reduzida para ${next}: ${why}`);
  applyGraphics();
}

export function diagFlags(): Set<DiagFlag> {
  const fromUrl = new URLSearchParams(location.search).get('diag');
  if (fromUrl !== null) safeSet(globalThis.sessionStorage, 'jarvis:diag', fromUrl || null);
  const raw = fromUrl ?? safeGet(globalThis.sessionStorage, 'jarvis:diag') ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter((s): s is DiagFlag => (DIAG_FLAGS as readonly string[]).includes(s)));
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onGraphicsChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Aplica o nível como atributo no <html>: o CSS reduz os efeitos conforme o nível e as flags. */
export function applyGraphics() {
  const { level } = currentLevel();
  const root = document.documentElement;
  root.dataset.gfx = level;
  const flags = diagFlags();
  root.dataset.diag = [...flags].join(' ');
  listeners.forEach((l) => l());
}

export function webglAllowed(): boolean {
  return currentLevel().level !== 'economy' && !diagFlags().has('nowebgl') && probeWebGL().ok;
}
