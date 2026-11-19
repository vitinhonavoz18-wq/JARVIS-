/**
 * Proxy seguro para o modelo de IA.
 * - A chave da IA fica só aqui (secrets do Supabase); o app nunca a vê.
 * - Exige usuário autenticado, valida a entrada e aplica limite diário de uso.
 * - O app executa as ferramentas localmente com as permissões (RLS) do próprio usuário.
 */
import { cors, json, requireUser, adminClient, log } from '../_shared/http.ts';
import { Body, PROVIDER, callLlm, isProviderDown, isRateLimit } from '../_shared/llm.ts';

const DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? 300);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const user = await requireUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const raw = await req.json().catch(() => null);
  if (raw?.ping) return json({ configured: PROVIDER !== 'none', provider: PROVIDER === 'none' ? null : PROVIDER });
  if (PROVIDER === 'none') return json({ error: 'IA avançada não configurada no servidor.' }, 503);

  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: 'Requisição inválida' }, 400);

  const admin = adminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin.from('ai_usage').select('requests').eq('user_id', user.id).eq('day', today).maybeSingle();
  if ((usage?.requests ?? 0) >= DAILY_LIMIT) return json({ error: 'Limite diário de uso da IA atingido. Tente novamente amanhã.' }, 429);

  const started = Date.now();
  try {
    const out = await callLlm(parsed.data);
    await admin.rpc('increment_ai_usage', { p_user: user.id, p_input: out.inputTokens, p_output: out.outputTokens });
    log('ai_chat', { user: user.id, provider: PROVIDER, model: out.model, ms: Date.now() - started, in: out.inputTokens, out: out.outputTokens, tools: out.toolCalls.length });
    return json({ text: out.text, toolCalls: out.toolCalls, raw: out.raw });
  } catch (e) {
    log('ai_chat_error', { user: user.id, provider: PROVIDER, ms: Date.now() - started, error: e instanceof Error ? e.constructor.name : 'unknown' });
    const status = isRateLimit(e) ? 429 : isProviderDown(e) ? 503 : 502;
    return json({ error: status === 429 ? 'O provedor de IA está sobrecarregado. Tente em instantes.' : 'O provedor de IA está indisponível no momento.' }, status);
  }
});
