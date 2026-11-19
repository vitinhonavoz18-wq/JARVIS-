import type { StorageAdapter } from '@/core/data/memoryRepo.ts';

const PREFIX = 'jarvis:v1:';

/** Persistência do Modo Local no próprio aparelho (localStorage). */
export const localAdapter: StorageAdapter = {
  load(table) {
    try {
      const raw = localStorage.getItem(PREFIX + table);
      return raw ? (JSON.parse(raw) as unknown[]) : null;
    } catch {
      return null;
    }
  },
  save(table, rows) {
    try {
      localStorage.setItem(PREFIX + table, JSON.stringify(rows));
    } catch (e) {
      console.error('Falha ao salvar localmente', e);
    }
  },
};

export function clearLocalData() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`jarvis:pref:${key}`);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`jarvis:pref:${key}`, JSON.stringify(value));
  } catch {
    /* sem armazenamento disponível */
  }
}
