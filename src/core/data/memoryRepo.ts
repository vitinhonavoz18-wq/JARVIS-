import type { Conversation, ConversationMessage, TableMap, TableName, UserMemory } from '../types.ts';
import { rankConversations, rankMemories } from '../memory/engine.ts';
import { DEFAULTS, normalizeText, type Query, type Repo, type Table } from './repo.ts';

export interface StorageAdapter {
  load(table: string): unknown[] | null;
  save(table: string, rows: unknown[]): void;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type Row = Record<string, unknown> & { id: string; user_id: string };

export function matches<T>(row: T, q: Query<T> = {}): boolean {
  const r = row as Record<string, unknown>;
  for (const [k, v] of Object.entries(q.eq ?? {})) if (r[k] !== v) return false;
  for (const [k, v] of Object.entries(q.in ?? {})) if (!(v as unknown[]).includes(r[k])) return false;
  for (const [k, v] of Object.entries(q.gte ?? {})) if (r[k] == null || (r[k] as string) < (v as string)) return false;
  for (const [k, v] of Object.entries(q.lt ?? {})) if (r[k] == null || (r[k] as string) >= (v as string)) return false;
  for (const [k, v] of Object.entries(q.lte ?? {})) if (r[k] == null || (r[k] as string) > (v as string)) return false;
  for (const k of q.isNull ?? []) if (r[k as string] != null) return false;
  for (const k of q.notNull ?? []) if (r[k as string] == null) return false;
  if (q.search && q.search.q.trim()) {
    const terms = normalizeText(q.search.q).split(/\s+/).filter(Boolean);
    const hay = normalizeText(
      q.search.fields.map((f) => {
        const v = r[f as string];
        return Array.isArray(v) ? v.join(' ') : String(v ?? '');
      }).join(' '),
    );
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}

export function sortRows<T>(rows: T[], order: Query<T>['order']): T[] {
  if (!order?.length) return rows;
  return [...rows].sort((a, b) => {
    for (const o of order) {
      const av = (a as Record<string, unknown>)[o.field as string];
      const bv = (b as Record<string, unknown>)[o.field as string];
      if (av === bv) continue;
      // nulls por último
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : 1;
      return o.asc === false ? -cmp : cmp;
    }
    return 0;
  });
}

/**
 * Repositório local: dados ficam na memória e (opcionalmente) persistidos no aparelho.
 * Usado no "Modo Local" e nos testes automatizados.
 */
export class MemoryRepo implements Repo {
  readonly mode = 'local' as const;
  private data = new Map<string, Row[]>();
  private listeners = new Set<(table: string) => void>();

  constructor(readonly userId: string, private storage?: StorageAdapter) {}

  onChange(fn: (table: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private rows(name: string): Row[] {
    let rows = this.data.get(name);
    if (!rows) {
      rows = (this.storage?.load(name) as Row[] | null) ?? [];
      this.data.set(name, rows);
    }
    return rows;
  }

  private persist(name: string) {
    this.storage?.save(name, this.rows(name));
    this.listeners.forEach((l) => l(name));
  }

  async searchMemories(query: string, limit = 5) {
    return rankMemories(this.rows('user_memories') as unknown as UserMemory[], query, limit);
  }

  async searchConversations(query: string, limit = 10) {
    const convs = new Map((this.rows('conversations') as unknown as Conversation[]).map((c) => [c.id, c]));
    return rankConversations(this.rows('conversation_messages') as unknown as ConversationMessage[], convs, query, limit);
  }

  table<K extends TableName>(name: K): Table<TableMap[K]> {
    type T = TableMap[K];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const owned = () => self.rows(name).filter((r) => r.user_id === self.userId);
    return {
      async list(q?: Query<T>) {
        let out = owned().filter((r) => matches(r as unknown as T, q)) as unknown as T[];
        out = sortRows(out, q?.order);
        if (q?.limit) out = out.slice(0, q.limit);
        return out.map((r) => structuredClone(r));
      },
      async get(id: string) {
        const r = owned().find((x) => x.id === id);
        return r ? (structuredClone(r) as unknown as T) : null;
      },
      async insert(row) {
        const now = new Date().toISOString();
        const full = {
          ...(DEFAULTS[name] ?? {}),
          ...row,
          id: (row as { id?: string }).id ?? uuid(),
          user_id: self.userId,
          created_at: now,
          updated_at: now,
        } as unknown as Row;
        if (self.rows(name).some((r) => r.id === full.id)) throw new Error('duplicate key');
        self.rows(name).push(full);
        self.persist(name);
        return structuredClone(full) as unknown as T;
      },
      async update(id, patch) {
        const rows = self.rows(name);
        const i = rows.findIndex((x) => x.id === id && x.user_id === self.userId);
        if (i < 0) throw new Error('Registro não encontrado');
        const { id: _i, user_id: _u, created_at: _c, ...safe } = patch as Record<string, unknown>;
        rows[i] = { ...rows[i], ...safe, updated_at: new Date().toISOString() };
        self.persist(name);
        return structuredClone(rows[i]) as unknown as T;
      },
      async remove(id) {
        const rows = self.rows(name);
        const i = rows.findIndex((x) => x.id === id && x.user_id === self.userId);
        if (i >= 0) {
          rows.splice(i, 1);
          self.persist(name);
        }
      },
    };
  }
}
