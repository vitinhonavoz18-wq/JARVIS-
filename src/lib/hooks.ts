import { useEffect, useState } from 'react';

/** Relógio que atualiza periodicamente (para saudações, linha do tempo e contadores). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useQueryParam(name: string): string | null {
  const [v, setV] = useState(() => new URLSearchParams(window.location.search).get(name));
  useEffect(() => {
    const on = () => setV(new URLSearchParams(window.location.search).get(name));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, [name]);
  return v;
}
