/**
 * Comando de voz sem abrir o app — usado pelos Atalhos da Siri e por apps de atalho no Android.
 *
 *   POST /functions/v1/jarvis-command[?format=text]
 *   Authorization: Bearer jfv_...        (chave pessoal criada em Configurações → Atalhos)
 *   { "text": "academia amanhã às 9" }
 *
 * Executa o MESMO agente do aplicativo no servidor, agindo apenas sobre os dados do dono da chave,
 * e devolve a resposta pronta para ser falada. Ações sensíveis continuam pedindo confirmação:
 * basta dizer “sim” no próximo comando.
 */
import { adminClient, cors, json, log } from '../_shared/http.ts';
import { Body, PROVIDER, callLlm } from '../_shared/llm.ts';
import { runAgent, metaFrom, type LlmProvider } from '../../../src/core/agent/agent.ts';
import { SupabaseRepo } from '../../../src/core/data/supabaseRepo.ts';
import { toSpeakable } from '../../../src/core/speech.ts';
import type { ToolContext } from '../../../src/core/agent/tools.ts';

const DAILY_LIMIT = Number(Deno.env.get('SHORTCUT_DAILY_LIMIT') ?? 500);
const CONVERSATION_TITLE = 'Atalhos de voz';

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function reply(text: string, status: number, asText: boolean, extra: Record<string, unknown> = {}) {
  if (asText) return new Response(toSpeakable(text), { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  return json({ reply: text, speech: toSpeakable(text), ...extra }, status);
}

const serverLlm: LlmProvider = {
  async chat(req) {
    const parsed = Body.safeParse(req);
    if (!parsed.success) throw new Error('requisição de IA inválida');
    const out = await callLlm(parsed.data);
    return { text: out.text, toolCalls: out.toolCalls, raw: out.raw };
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const asText = url.searchParams.get('format') === 'text' || (req.headers.get('accept') ?? '').startsWith('text/plain');
  if (req.method !== 'POST') return reply('Use o método POST.', 405, asText);

  // 1. Identifica o dono pela chave pessoal (comparada pelo hash).
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim() || req.headers.get('x-jarvis-token') || '';
  if (!/^jfv_[A-Za-z0-9_-]{30,80}$/.test(token)) return reply('Chave de acesso ausente ou inválida.', 401, asText);
  const db = adminClient();
  const { data: userId, error: tokErr } = await db.rpc('use_api_token', { p_hash: await sha256Hex(token), p_daily_limit: DAILY_LIMIT });
  if (tokErr) return reply(tokErr.code === 'P0429' ? 'Limite diário de comandos atingido.' : 'Não foi possível validar a chave.', tokErr.code === 'P0429' ? 429 : 500, asText);
  if (!userId) return reply('Chave de acesso inválida ou revogada.', 401, asText);

  // 2. Lê o comando (JSON, formulário ou texto puro).
  let text = '';
  const ctype = req.headers.get('content-type') ?? '';
  try {
    if (ctype.includes('application/json')) text = String((await req.json())?.text ?? '');
    else if (ctype.includes('form')) text = String((await req.formData()).get('text') ?? '');
    else text = await req.text();
  } catch {
    return reply('Não consegui ler o comando.', 400, asText);
  }
  text = text.trim().slice(0, 1000);
  if (!text) return reply('Não ouvi nenhum comando. Pode repetir?', 400, asText);

  // 3. Executa o agente com um repositório restrito ao dono da chave.
  const repo = new SupabaseRepo(db, userId as string);
  const started = Date.now();
  try {
    const prefs = (await repo.table('user_preferences').list({ limit: 1 }))[0];
    const tz = prefs?.timezone ?? 'America/Bahia';
    const ctx: ToolContext = {
      repo, now: new Date(), tz, source: 'voice',
      prefs: {
        display_name: prefs?.display_name ?? 'Franklin', assistant_name: prefs?.assistant_name ?? 'JARVIS',
        default_reminder_minutes: prefs?.default_reminder_minutes ?? 15, memory_enabled: prefs?.memory_enabled ?? true,
        memory_categories: prefs?.memory_categories ?? [], timezone: tz,
      },
    };
    const convs = await repo.table('conversations').list({ eq: { title: CONVERSATION_TITLE }, limit: 1 });
    const conv = convs[0] ?? (await repo.table('conversations').insert({ title: CONVERSATION_TITLE, state: null }));
    const history = (await repo.table('conversation_messages').list({ eq: { conversation_id: conv.id }, order: [{ field: 'created_at', asc: false }], limit: 10 })).reverse();
    const memories = ctx.prefs.memory_enabled ? (await repo.table('user_memories').list({ eq: { active: true }, limit: 25 })).map((m) => m.content) : [];
    const userMsg = await repo.table('conversation_messages').insert({ conversation_id: conv.id, role: 'user', content: text, meta: null });

    const out = await runAgent({
      text, ctx, state: conv.state, memories, requestId: userMsg.id, conversationId: conv.id,
      history: history.map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content })),
      llm: PROVIDER === 'none' ? null : serverLlm,
    });
    const finalText = out.proposal ? `${out.reply} ${out.proposal.items.join('; ')}. Diga “sim” para confirmar ou “não” para cancelar.` : out.reply;
    await repo.table('conversation_messages').insert({ conversation_id: conv.id, role: 'assistant', content: finalText.slice(0, 20000), meta: metaFrom(out) });
    await repo.table('conversations').update(conv.id, { state: out.state });
    log('jarvis_command', { user: userId, ms: Date.now() - started, via: out.via, actions: out.actions.length, ok: !out.error });
    return reply(finalText, out.error ? 502 : 200, asText, {
      actions: out.actions.map((a) => ({ tool: a.tool, ok: a.ok, summary: a.summary })),
      needs_confirmation: Boolean(out.proposal),
      needs_answer: Boolean(out.state.pending),
    });
  } catch (e) {
    log('jarvis_command_error', { user: userId, ms: Date.now() - started, error: e instanceof Error ? e.message.slice(0, 120) : 'erro' });
    return reply('Tive um problema ao executar o comando. Nada foi confirmado.', 500, asText);
  }
});
