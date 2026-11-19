import type { SupabaseClient } from '@supabase/supabase-js';
import type { TableMap, TableName } from '../types.ts';
import type { Query, Repo, Table } from './repo.ts';

/**
 * Repositório na nuvem. A segurança principal é o RLS do banco; além disso, toda consulta filtra
 * explicitamente por user_id (defesa em profundidade — essencial quando o servidor usa a chave de serviço).
 */
export class SupabaseRepo implements Repo {
  readonly mode = 'cloud' as const;
  constructor(private sb: SupabaseClient, readonly userId: string) {}

  table<K extends TableName>(name: K): Table<TableMap[K]> {
    type T = TableMap[K];
    const sb = this.sb;
    const userId = this.userId;
    const fail = (e: { message: string } | null) => {
      if (e) throw new Error(e.message);
    };
    return {
      async list(q: Query<T> = {}) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let b: any = sb.from(name).select('*').eq('user_id', userId);
        for (const [k, v] of Object.entries(q.eq ?? {})) b = v === null ? b.is(k, null) : b.eq(k, v);
        for (const [k, v] of Object.entries(q.in ?? {})) b = b.in(k, v as unknown[]);
        for (const [k, v] of Object.entries(q.gte ?? {})) b = b.gte(k, v);
        for (const [k, v] of Object.entries(q.lt ?? {})) b = b.lt(k, v);
        for (const [k, v] of Object.entries(q.lte ?? {})) b = b.lte(k, v);
        for (const k of q.isNull ?? []) b = b.is(k as string, null);
        for (const k of q.notNull ?? []) b = b.not(k as string, 'is', null);
        if (q.search?.q.trim()) {
          // Remove caracteres que poderiam alterar o filtro PostgREST.
          const term = q.search.q.replace(/[%,()*\\]/g, ' ').trim();
          const words = term.split(/\s+/).filter(Boolean).slice(0, 6);
          for (const w of words) {
            const ors = q.search.fields
              .filter((f) => !['tags', 'participants'].includes(f as string))
              .map((f) => `${String(f)}.ilike.%${w}%`);
            b = b.or(ors.join(','));
          }
        }
        for (const o of q.order ?? []) b = b.order(o.field as string, { ascending: o.asc !== false, nullsFirst: false });
        if (q.limit) b = b.limit(q.limit);
        const { data, error } = await b;
        fail(error);
        return (data ?? []) as T[];
      },
      async get(id) {
        const { data, error } = await sb.from(name).select('*').eq('id', id).eq('user_id', userId).maybeSingle();
        fail(error);
        return (data as T) ?? null;
      },
      async insert(row) {
        const { data, error } = await sb.from(name).insert({ ...row, user_id: userId }).select('*').single();
        fail(error);
        return data as T;
      },
      async update(id, patch) {
        const { id: _i, user_id: _u, created_at: _c, updated_at: _up, ...safe } = patch as Record<string, unknown>;
        const { data, error } = await sb.from(name).update(safe).eq('id', id).eq('user_id', userId).select('*').single();
        fail(error);
        return data as T;
      },
      async remove(id) {
        const { error } = await sb.from(name).delete().eq('id', id).eq('user_id', userId);
        fail(error);
      },
    };
  }
}
