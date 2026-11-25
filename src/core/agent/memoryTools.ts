/**
 * Ferramentas do JARVIS Memory Engine: buscar, corrigir e esquecer memórias, pesquisar
 * conversas antigas e registrar/consultar decisões. Todas usam o repositório do próprio
 * usuário (RLS no Modo Nuvem).
 */
import { z } from 'zod';
import { secretReason } from '../memory/engine.ts';
import { formatWhen } from '../time.ts';
import { registerTools, tool, type ToolDef } from './tools.ts';

const searchMemory = tool({
  name: 'search_memory',
  description: 'Busca nas memórias do usuário (preferências, fatos, procedimentos) as mais relevantes para um assunto. Use quando o usuário perguntar o que você sabe/lembra sobre algo.',
  readOnly: true,
  schema: z.object({ query: z.string().min(2).max(300), limit: z.number().int().min(1).max(10).optional() }),
  async run(ctx, i) {
    const hits = await ctx.repo.searchMemories(i.query, i.limit ?? 5);
    if (!hits.length) return { ok: true, message: `Não tenho nada guardado sobre “${i.query}”.`, data: [] };
    return { ok: true, message: `O que eu sei sobre “${i.query}”:\n${hits.map((h) => `• ${h.content}`).join('\n')}`, data: hits.map((h) => ({ id: h.id, content: h.content, kind: h.kind, source_conversation_id: h.source_conversation_id })) };
  },
});

const updateMemory = tool({
  name: 'update_memory',
  description: 'Corrige uma memória desatualizada: guarda a versão nova e marca a antiga como substituída (a antiga deixa de ser usada). Use o id vindo de search_memory.',
  risk: 'sensitive',
  confirm: true,
  schema: z.object({ memory_id: z.string().uuid(), new_content: z.string().min(3).max(500) }),
  async run(ctx, i) {
    if (ctx.privateConversation) return { ok: false, message: 'Esta é uma conversa privada: não altero memórias nela.' };
    const secret = secretReason(i.new_content);
    if (secret) return { ok: false, message: `Não guardei isso porque ${secret}.` };
    const t = ctx.repo.table('user_memories');
    const old = await t.get(i.memory_id);
    if (!old || !old.active) return { ok: false, message: 'Não encontrei essa memória.' };
    const row = await t.insert({ category: old.category, content: i.new_content.trim(), active: true, source: ctx.source, kind: old.kind ?? 'semantic', importance: old.importance ?? 3, source_conversation_id: ctx.conversationId ?? null });
    await t.update(old.id, { superseded_by: row.id, active: false });
    return { ok: true, message: `Memória corrigida: “${old.content}” → “${row.content}”.`, data: { old_id: old.id, new_id: row.id }, link: '/conhecimento' };
  },
});

const forgetMemory = tool({
  name: 'forget_memory',
  description: 'Apaga definitivamente uma memória do usuário (use o id vindo de search_memory).',
  risk: 'destructive',
  confirm: true,
  schema: z.object({ memory_id: z.string().uuid() }),
  async run(ctx, i) {
    const t = ctx.repo.table('user_memories');
    const old = await t.get(i.memory_id);
    if (!old) return { ok: false, message: 'Não encontrei essa memória.' };
    await t.remove(old.id);
    return { ok: true, message: `Esqueci: “${old.content}”.`, data: { id: old.id } };
  },
});

const searchConversations = tool({
  name: 'search_conversations',
  description: 'Pesquisa trechos de conversas antigas do usuário (exceto conversas privadas). Use para “o que eu falei sobre…”, “aquela conversa sobre…”.',
  readOnly: true,
  schema: z.object({ query: z.string().min(2).max(300), limit: z.number().int().min(1).max(20).optional() }),
  async run(ctx, i) {
    const hits = await ctx.repo.searchConversations(i.query, i.limit ?? 8);
    if (!hits.length) return { ok: true, message: `Não encontrei conversas sobre “${i.query}”.`, data: [] };
    return {
      ok: true,
      message: `Conversas sobre “${i.query}”:\n${hits.map((h) => `• ${formatWhen(h.created_at, true, ctx.now, ctx.tz)} — “${h.conversation_title}”: ${h.snippet.slice(0, 160)}`).join('\n')}`,
      data: hits,
    };
  },
});

const recordDecision = tool({
  name: 'record_decision',
  description: 'Registra uma decisão tomada pelo usuário, com motivo, resultado esperado e data de revisão opcional.',
  schema: z.object({
    decision: z.string().min(3).max(1000),
    reason: z.string().max(2000).optional(),
    context: z.string().max(4000).optional(),
    expected_result: z.string().max(2000).optional(),
    review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
  }),
  async run(ctx, i) {
    if (ctx.privateConversation) return { ok: false, message: 'Esta é uma conversa privada: não registro decisões nela.' };
    const row = await ctx.repo.table('decision_history').insert({
      decision: i.decision.trim(), reason: i.reason ?? null, context: i.context ?? null, expected_result: i.expected_result ?? null,
      decided_at: ctx.now.toISOString(), review_at: i.review_date ? `${i.review_date}T12:00:00Z` : null, status: 'open', outcome: null,
      source_conversation_id: ctx.conversationId ?? null,
    });
    return { ok: true, message: `Decisão registrada: “${row.decision}”${i.review_date ? `, com revisão em ${i.review_date.split('-').reverse().join('/')}` : ''}.`, data: { id: row.id }, link: '/conhecimento' };
  },
});

const retrieveDecision = tool({
  name: 'retrieve_decision',
  description: 'Consulta decisões registradas anteriormente (por assunto, ou as mais recentes).',
  readOnly: true,
  schema: z.object({ query: z.string().max(300).optional(), limit: z.number().int().min(1).max(20).optional() }),
  async run(ctx, i) {
    const rows = await ctx.repo.table('decision_history').list({
      ...(i.query ? { search: { fields: ['decision', 'reason', 'context'], q: i.query } } : {}),
      order: [{ field: 'decided_at', asc: false }],
      limit: i.limit ?? 5,
    });
    if (!rows.length) return { ok: true, message: i.query ? `Não encontrei decisões sobre “${i.query}”.` : 'Nenhuma decisão registrada ainda.', data: [] };
    return {
      ok: true,
      message: `Decisões${i.query ? ` sobre “${i.query}”` : ''}:\n${rows.map((r) => `• ${formatWhen(r.decided_at, true, ctx.now, ctx.tz)}: ${r.decision}${r.reason ? ` — motivo: ${r.reason}` : ''}${r.outcome ? ` — resultado: ${r.outcome}` : ''}`).join('\n')}`,
      data: rows.map((r) => ({ id: r.id, decision: r.decision, reason: r.reason, decided_at: r.decided_at, status: r.status })),
    };
  },
});

registerTools([searchMemory, updateMemory, forgetMemory, searchConversations, recordDecision, retrieveDecision] as unknown as ToolDef[]);
