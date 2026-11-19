import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepo } from './supabaseRepo.ts';
import { toSpeakable } from '../speech.ts';

/** Cliente falso que registra os filtros aplicados. */
function fakeClient(calls: string[][]) {
  const builder = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const rec = (name: string) => (...args: unknown[]) => {
      calls[calls.length - 1].push(`${name}:${args.map(String).join(',')}`);
      return chain;
    };
    for (const m of ['select', 'eq', 'is', 'in', 'gte', 'lt', 'lte', 'not', 'or', 'order', 'limit', 'update', 'delete', 'insert']) chain[m] = rec(m);
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: {}, error: null });
    chain.then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return chain;
  };
  return { from: (t: string) => { calls.push([`from:${t}`]); return builder(); } } as unknown as SupabaseClient;
}

describe('SupabaseRepo — filtro por dono em todas as operações', () => {
  it('list, get, update e remove sempre filtram por user_id', async () => {
    const calls: string[][] = [];
    const repo = new SupabaseRepo(fakeClient(calls), 'user-a');
    const t = repo.table('tasks');
    await t.list({ eq: { status: 'todo' } });
    await t.get('x');
    await t.update('x', { title: 'novo', user_id: 'hacker' } as never);
    await t.remove('x');
    expect(calls).toHaveLength(4);
    for (const c of calls) expect(c).toContain('eq:user_id,user-a');
    // O user_id enviado num patch é descartado.
    expect(calls[2].some((x) => x.includes('hacker'))).toBe(false);
  });
});

describe('texto falado', () => {
  it('remove marcadores e lê horários naturalmente', () => {
    expect(toSpeakable('Tarefas hoje (2):\n• Academia — hoje, às 8h30\n• Ler ✓')).toBe('Tarefas hoje (2): Academia — hoje, às 8 e 30. Ler');
  });
});
