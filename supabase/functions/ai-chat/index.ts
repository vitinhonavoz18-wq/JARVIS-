/**
 * AI Engine — proxy seguro para os modelos de IA.
 * - Chaves só nas secrets do servidor; o app nunca as vê.
 * - Usuário autenticado, entrada validada, limites diário e mensal, registro de consumo e custo.
 * - O app executa as ferramentas com as permissões (RLS) do próprio usuário.
 */
import { cors, json, requireUser, adminClient, log } from '../_shared/http.ts';
import { Body, PROVIDER, availableProviders, callWithFallback, checkLimits, ConfigError, isRateLimit, listModels, loadSettings, logCall, resolveModel } from '../_shared/llm.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const raw = await req.json().catch(() => null);
  if (raw?.ping) return json({ configured: PROVIDER !== 'none', provider: PROVIDER === 'none' ? null : PROVIDER, providers: availableProviders() });
  if (raw?.list_models) return json({ models: await listModels(), providers: availableProviders() });
  if (PROVIDER === 'none') return json({ error: 'IA avançada não configurada no servidor.' }, 503);

  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: 'Requisição inválida' }, 400);

  const db = adminClient();
  const settings = await loadSettings(db, user.id);
  const limit = await checkLimits(db, user.id, settings);
  if (limit) return json({ error: limit }, 429);

  const started = Date.now();
  try {
    const out = await callWithFallback(parsed.data, settings);
    await logCall(db, user.id, settings, { ...out, status: out.fellBack ? 'fallback' : 'ok', specialist: parsed.data.specialist, ms: Date.now() - started });
    log('ai_chat', { user: user.id, provider: out.provider, model: out.model, ms: Date.now() - started, fallback: out.fellBack, tools: out.toolCalls.length });
    const text = out.sources.length ? `${out.text}\n\nFontes:\n${out.sources.map((s) => `• ${s.title ?? s.url} — ${s.url}`).join('\n')}` : out.text;
    return json({ text, toolCalls: out.toolCalls, raw: out.raw });
  } catch (e) {
    let model = '';
    try { model = resolveModel(settings, parsed.data.complexity).model; } catch { /* sem modelo */ }
    await logCall(db, user.id, settings, { status: 'error', model, specialist: parsed.data.specialist, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) }).catch(() => {});
    log('ai_chat_error', { user: user.id, ms: Date.now() - started, error: e instanceof Error ? e.constructor.name : 'unknown' });
    if (e instanceof ConfigError) return json({ error: e.message }, 400);
    return json({ error: isRateLimit(e) ? 'O provedor de IA está sobrecarregado. Tente em instantes.' : 'O provedor de IA está indisponível no momento.' }, isRateLimit(e) ? 429 : 503);
  }
});
