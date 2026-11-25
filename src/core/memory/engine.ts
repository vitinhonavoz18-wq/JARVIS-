/**
 * JARVIS Memory Engine — regras puras (sem banco): ranking local, proteção de segredos e
 * montagem do bloco de memória com limite de tamanho. O banco faz a busca híbrida no Modo Nuvem.
 */
import { normalizeText } from '../data/repo.ts';
import type { ConversationHit, ConversationMessage, MemoryHit, UserMemory } from '../types.ts';

/** Quantas memórias entram em cada mensagem e o teto de caracteres do bloco. */
export const MEMORY_LIMITS = { topK: 5, maxChars: 1200, minScore: 0.05 } as const;

const STOP = new Set('a o e de da do das dos em no na nos nas um uma para pra por com que se meu minha meus minhas eu voce ao aos as os sobre qual quais como quando onde isso esse essa este esta tem ter ja foi sao ser'.split(' '));

export function terms(text: string): string[] {
  return [...new Set(normalizeText(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}

/** Ranking no Modo Local (o banco faz o equivalente com vetor + texto + trigramas). */
export function rankMemories(rows: UserMemory[], query: string, limit: number = MEMORY_LIMITS.topK, now = new Date()): MemoryHit[] {
  const q = terms(query);
  return rows
    .filter((m) => m.active && !m.superseded_by)
    .map((m) => {
      const words = terms(m.content);
      const overlap = q.length ? q.filter((w) => words.some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))).length / q.length : 0;
      const ageDays = (now.getTime() - new Date(m.updated_at).getTime()) / 86_400_000;
      const score = 0.75 * overlap + 0.15 * ((m.importance ?? 3) / 5) + 0.1 * Math.exp(-ageDays / 90);
      return { m, overlap, score };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ m, score }) => ({
      id: m.id, content: m.content, category: m.category, kind: m.kind ?? 'semantic', importance: m.importance ?? 3,
      source_conversation_id: m.source_conversation_id ?? null, updated_at: m.updated_at, score,
    }));
}

export function rankConversations(messages: ConversationMessage[], titles: Map<string, { title: string; private?: boolean }>, query: string, limit = 10): ConversationHit[] {
  const q = terms(query);
  if (!q.length) return [];
  return messages
    .filter((m) => !titles.get(m.conversation_id)?.private)
    .map((m) => ({ m, hits: q.filter((w) => normalizeText(m.content).includes(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.m.created_at.localeCompare(a.m.created_at))
    .slice(0, limit)
    .map(({ m }) => ({ message_id: m.id, conversation_id: m.conversation_id, conversation_title: titles.get(m.conversation_id)?.title ?? 'Conversa', role: m.role, snippet: m.content.slice(0, 300), created_at: m.created_at }));
}

/**
 * Segredos nunca viram memória conversacional: senhas, chaves de API, tokens, cartões, CVV.
 * Retorna o motivo da recusa ou null.
 */
export function secretReason(text: string): string | null {
  const n = normalizeText(text);
  if (/\b(senha|password|passwd|pin|cvv|codigo de seguranca|token|api key|chave de api|chave secreta|secret)\b/.test(n)) return 'parece conter senha, chave ou token';
  if (/\b(sk|pk|rk)[-_][a-z0-9_-]{12,}|\bsbp_[a-z0-9]{10,}|\bghp_[a-z0-9]{10,}|\beyj[a-z0-9_-]{20,}\./i.test(text)) return 'parece conter uma chave de API';
  if (/\b(?:\d[ .-]?){13,19}\b/.test(text) && /(cartao|card|credito|debito|visa|master)/.test(n)) return 'parece conter número de cartão';
  return null;
}

/** Bloco de memória para o prompt: só o que é relevante, com teto de tamanho. */
export function memoryBlock(hits: Pick<MemoryHit, 'content'>[], maxChars: number = MEMORY_LIMITS.maxChars): string[] {
  const out: string[] = [];
  let used = 0;
  for (const h of hits) {
    const line = h.content.slice(0, 300);
    if (used + line.length > maxChars) break;
    out.push(line);
    used += line.length;
  }
  return out;
}
