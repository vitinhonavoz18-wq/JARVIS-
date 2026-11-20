/** Core Web Vitals medidos no aparelho real (LCP, CLS, INP aproximado, FCP) — guardados só localmente. */
export interface Vitals { lcp?: number; cls?: number; inp?: number; fcp?: number; at: string; gfx?: string; ua: string }
const KEY = 'jarvis:vitals';

export function readVitals(): Vitals[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function startVitals() {
  if (typeof PerformanceObserver === 'undefined') return;
  const v: Vitals = { at: new Date().toISOString(), ua: navigator.userAgent.slice(0, 120) };
  const obs = (type: string, cb: (e: PerformanceEntry) => void, opts: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
    } catch {
      /* tipo não suportado neste navegador */
    }
  };
  obs('largest-contentful-paint', (e) => (v.lcp = Math.round(e.startTime)));
  obs('paint', (e) => e.name === 'first-contentful-paint' && (v.fcp = Math.round(e.startTime)));
  obs('layout-shift', (e) => {
    const ls = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!ls.hadRecentInput) v.cls = +((v.cls ?? 0) + ls.value).toFixed(4);
  });
  obs('event', (e) => (v.inp = Math.max(v.inp ?? 0, Math.round(e.duration))), { durationThreshold: 40 });
  const save = () => {
    v.gfx = document.documentElement.dataset.gfx;
    try {
      localStorage.setItem(KEY, JSON.stringify([v, ...readVitals().filter((x) => x.at !== v.at)].slice(0, 10)));
    } catch {
      /* sem armazenamento */
    }
  };
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  setTimeout(save, 15000);
}
