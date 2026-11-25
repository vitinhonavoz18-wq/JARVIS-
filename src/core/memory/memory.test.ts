import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepo } from '../data/memoryRepo.ts';
import { TOOL_MAP, type ToolContext } from '../agent/tools.ts';
import '../agent/agent.ts'; // registra as ferramentas
import { MEMORY_LIMITS, memoryBlock, rankMemories, secretReason } from './engine.ts';
import type { UserMemory } from '../types.ts';

const NOW = new Date('2026-11-25T13:00:00Z');
let repo: MemoryRepo;
const ctx = (extra: Partial<ToolContext> = {}): ToolContext => ({
  repo, now: NOW, tz: 'America/Bahia', source: 'ai',
  prefs: { display_name: 'Franklin', assistant_name: 'JARVIS', default_reminder_minutes: 15, memory_enabled: true, memory_categories: [], timezone: 'America/Bahia' } as never,
  ...extra,
});
const run = (name: string, input: Record<string, unknown>, extra?: Partial<ToolContext>) => TOOL_MAP.get(name)!.run(ctx(extra), input as never);

beforeEach(() => {
  repo = new MemoryRepo('franklin');
});

describe('Memory Engine — cenários de aceitação', () => {
  it('1. registra numa conversa e recupera em outra, com a origem', async () => {
    const conv = await repo.table('conversations').insert({ title: 'A', state: null });
    const r = await run('remember_preference', { category: 'trabalho', content: 'A TG Baterias fica no bairro Pituba', importance: 4 }, { conversationId: conv.id });
    expect(r.ok).toBe(true);
    // "outra conversa": busca por relevância, sem histórico
    const hits = await repo.searchMemories('onde fica a TG Baterias?');
    expect(hits[0].content).toContain('Pituba');
    expect(hits[0].source_conversation_id).toBe(conv.id);
    const found = await run('search_memory', { query: 'TG Baterias' });
    expect(found.message).toContain('Pituba');
  });

  it('2. corrige uma memória antiga: só a nova é recuperada', async () => {
    await run('remember_preference', { category: 'horarios', content: 'Prefiro reuniões pela manhã' });
    const [old] = await repo.searchMemories('reuniões');
    const r = await run('update_memory', { memory_id: old.id, new_content: 'Prefiro reuniões à tarde' });
    expect(r.ok).toBe(true);
    const hits = await repo.searchMemories('reuniões');
    expect(hits.map((h) => h.content)).toEqual(['Prefiro reuniões à tarde']);
  });

  it('3. exclui uma memória e ela não é mais recuperada', async () => {
    await run('remember_preference', { category: 'geral', content: 'Meu time do coração é o Bahia' });
    const [m] = await repo.searchMemories('time coração');
    expect((await run('forget_memory', { memory_id: m.id })).ok).toBe(true);
    expect(await repo.searchMemories('time coração')).toEqual([]);
  });

  it('4. recupera uma decisão tomada em conversa antiga', async () => {
    await run('record_decision', { decision: 'Contratar um designer para a FlyDelivery', reason: 'melhorar a conversão do app', review_date: '2026-12-20' });
    const r = await run('retrieve_decision', { query: 'designer' });
    expect(r.message).toContain('Contratar um designer');
    expect(r.message).toContain('melhorar a conversão');
  });

  it('nunca guarda senhas, chaves ou cartões', async () => {
    for (const content of ['minha senha do banco é 1234abcd', 'chave sk-proj-abcdefghijklmnop123', 'cartão de crédito 4111 1111 1111 1111']) {
      const r = await run('remember_preference', { category: 'geral', content });
      expect(r.ok).toBe(false);
    }
    expect(await repo.table('user_memories').list()).toEqual([]);
    expect(secretReason('Prefiro café sem açúcar')).toBeNull();
  });

  it('conversa privada não cria memórias nem decisões', async () => {
    expect((await run('remember_preference', { category: 'geral', content: 'Gosto de jazz' }, { privateConversation: true })).ok).toBe(false);
    expect((await run('record_decision', { decision: 'Vender o carro' }, { privateConversation: true })).ok).toBe(false);
    expect(await repo.table('user_memories').list()).toEqual([]);
  });

  it('conversa privada fica fora da busca de conversas', async () => {
    const pub = await repo.table('conversations').insert({ title: 'Pública', state: null });
    const priv = await repo.table('conversations').insert({ title: 'Privada', state: null, private: true });
    await repo.table('conversation_messages').insert({ conversation_id: pub.id, role: 'user', content: 'Plano de marketing da FlyDelivery', meta: null });
    await repo.table('conversation_messages').insert({ conversation_id: priv.id, role: 'user', content: 'Assunto secreto de marketing', meta: null });
    const hits = await repo.searchConversations('marketing');
    expect(hits).toHaveLength(1);
    expect(hits[0].conversation_title).toBe('Pública');
  });

  it('isolamento: outro usuário não enxerga as memórias', async () => {
    await run('remember_preference', { category: 'geral', content: 'Prefiro café sem açúcar' });
    expect(await new MemoryRepo('intruso').searchMemories('café')).toEqual([]);
  });

  it('não duplica a mesma memória', async () => {
    await run('remember_preference', { category: 'geral', content: 'Prefiro café sem açúcar' });
    const r = await run('remember_preference', { category: 'geral', content: 'prefiro  CAFÉ sem açúcar' });
    expect(r.message).toMatch(/já tinha/);
    expect(await repo.table('user_memories').list()).toHaveLength(1);
  });
});

describe('montagem de contexto', () => {
  const mem = (content: string, extra: Partial<UserMemory> = {}): UserMemory => ({ id: content, user_id: 'u', content, category: 'geral', active: true, source: 'manual', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...extra });

  it('recupera só o relevante (top-k) e ignora inativas e substituídas', () => {
    const rows = [mem('Gosto de pizza'), mem('Reunião da FlyDelivery às segundas'), mem('FlyDelivery antiga', { active: false }), mem('FlyDelivery velha', { superseded_by: 'x' })];
    expect(rankMemories(rows, 'quando é a reunião da FlyDelivery?', MEMORY_LIMITS.topK, NOW).map((h) => h.content)).toEqual(['Reunião da FlyDelivery às segundas']);
  });

  it('respeita o teto de caracteres do bloco de memória', () => {
    const block = memoryBlock(Array.from({ length: 20 }, (_, i) => ({ content: `memória ${i} `.repeat(20) })), 500);
    expect(block.join('').length).toBeLessThanOrEqual(500);
  });
});
