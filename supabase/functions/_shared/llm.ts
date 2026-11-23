/**
 * AI Engine — camada de abstração de provedores (OpenAI Responses API e Anthropic Messages API).
 * Modelos vêm das configurações do usuário (tabela ai_settings) ou de variáveis de ambiente:
 * padrões OpenAI: OPENAI_MODEL (gpt-5-mini) e OPENAI_MODEL_COMPLEX (gpt-5).
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProviderId = 'openai' | 'anthropic';
const HAS = { openai: Boolean(Deno.env.get('OPENAI_API_KEY')), anthropic: Boolean(Deno.env.get('ANTHROPIC_API_KEY')) };
export const PROVIDER: ProviderId | 'none' = ((): ProviderId | 'none' => {
  const forced = (Deno.env.get('AI_PROVIDER') ?? '').toLowerCase();
  if (forced === 'openai' && HAS.openai) return 'openai';
  if (forced === 'anthropic' && HAS.anthropic) return 'anthropic';
  // OpenAI é o provedor principal quando a chave existe; Claude fica como alternativa/fallback.
  return HAS.openai ? 'openai' : HAS.anthropic ? 'anthropic' : 'none';
})();
export const availableProviders = (): ProviderId[] => (['anthropic', 'openai'] as const).filter((p) => HAS[p]);

const ToolCall = z.object({ id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) });
const Att = z.object({ kind: z.enum(['image', 'file']), name: z.string().max(200), mime: z.string().regex(/^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/(plain|csv|markdown))$/), data: z.string().max(14_000_000) });
export const Body = z.object({
  system: z.string().max(24_000),
  complexity: z.enum(['simple', 'complex']).default('simple'),
  specialist: z.string().max(30).optional(),
  tools: z.array(z.object({ name: z.string().max(64), description: z.string().max(2000), input_schema: z.record(z.string(), z.unknown()) })).max(60),
  turns: z
    .array(
      z.discriminatedUnion('role', [
        z.object({ role: z.literal('user'), text: z.string().max(20_000), attachments: z.array(Att).max(4).optional() }),
        z.object({ role: z.literal('assistant'), text: z.string().max(20_000), toolCalls: z.array(ToolCall).optional(), raw: z.unknown().optional() }),
        z.object({ role: z.literal('tool'), results: z.array(z.object({ id: z.string(), content: z.string().max(12_000), isError: z.boolean().optional() })) }),
      ]),
    )
    .min(1)
    .max(40),
});
export type BodyT = z.infer<typeof Body>;

export interface Settings {
  provider: 'auto' | ProviderId;
  simple_model: string | null;
  complex_model: string | null;
  daily_request_limit: number;
  monthly_budget_usd: number | null;
  web_search_enabled: boolean;
  fallback_enabled: boolean;
  response_style: string;
  model_prices: Record<string, { input_per_m: number; output_per_m: number }>;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'auto', simple_model: null, complex_model: null, daily_request_limit: Number(Deno.env.get('AI_DAILY_LIMIT') ?? 300),
  monthly_budget_usd: null, web_search_enabled: false, fallback_enabled: true, response_style: 'objetivo', model_prices: {},
};

export async function loadSettings(db: SupabaseClient, userId: string): Promise<Settings> {
  const { data, error } = await db.from('ai_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Não foi possível consultar as configurações de IA.');
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) } as Settings;
}

export interface Out {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  raw: unknown;
  sources: { title?: string; url: string }[];
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class ConfigError extends Error {}

/** Escolhe provedor e modelo: configurações do usuário > variáveis de ambiente > padrão documentado. */
export function resolveModel(s: Settings, complexity: 'simple' | 'complex', provider?: ProviderId): { provider: ProviderId; model: string } {
  const p: ProviderId | 'none' = provider ?? (s.provider !== 'auto' && HAS[s.provider] ? s.provider : PROVIDER);
  if (p === 'none') throw new ConfigError('Nenhum provedor de IA configurado no servidor.');
  const userModel = complexity === 'complex' ? s.complex_model ?? s.simple_model : s.simple_model ?? s.complex_model;
  const sameProvider = userModel && (p === 'anthropic' ? userModel.startsWith('claude') : !userModel.startsWith('claude'));
  if (userModel && sameProvider) return { provider: p, model: userModel };
  if (p === 'anthropic') {
    return { provider: p, model: complexity === 'complex' ? Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5' : Deno.env.get('ANTHROPIC_MODEL_FAST') ?? 'claude-haiku-5-5' };
  }
  // Padrão: modelo rápido e econômico para o dia a dia e um mais forte para pedidos complexos (ambos trocáveis por env).
  const fast = Deno.env.get('OPENAI_MODEL') ?? 'gpt-5-mini';
  return { provider: p, model: complexity === 'complex' ? Deno.env.get('OPENAI_MODEL_COMPLEX') ?? 'gpt-5' : fast };
}

export function estimateCost(s: Settings, model: string, input: number, output: number): number | null {
  const p = s.model_prices?.[model];
  if (!p) return null;
  return (input / 1e6) * p.input_per_m + (output / 1e6) * p.output_per_m;
}

export function isTransient(e: unknown): boolean {
  // Chave inválida/sem permissão em um provedor também libera a troca para o outro.
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return true;
  if (e instanceof ProviderHttpError && (e.status === 401 || e.status === 403)) return true;
  if (e instanceof Anthropic.RateLimitError) return true;
  if (e instanceof Anthropic.APIError) return (e.status ?? 500) >= 500;
  if (e instanceof ProviderHttpError) return e.status === 429 || e.status >= 500;
  return e instanceof TypeError; // falha de rede
}
export const isRateLimit = (e: unknown) => e instanceof Anthropic.RateLimitError || (e instanceof ProviderHttpError && e.status === 429);
export class ProviderHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function callLlm(b: BodyT, s: Settings, provider?: ProviderId): Promise<Out> {
  const { provider: p, model } = resolveModel(s, b.complexity, provider);
  return p === 'openai' ? callOpenAI(b, model, s) : callAnthropic(b, model, s);
}

/** Chamada com troca automática de provedor em falhas temporárias (quando habilitada). */
export async function callWithFallback(b: BodyT, s: Settings): Promise<Out & { fellBack: boolean }> {
  try {
    return { ...(await callLlm(b, s)), fellBack: false };
  } catch (e) {
    const primary = resolveModel(s, b.complexity).provider;
    const other = availableProviders().find((x) => x !== primary);
    if (!s.fallback_enabled || !other || !isTransient(e)) throw e;
    // Conteúdo bruto de um provedor não é válido no outro: reenvia só texto e chamadas.
    const stripped: BodyT = { ...b, turns: b.turns.map((t) => (t.role === 'assistant' ? { ...t, raw: undefined } : t)) };
    return { ...(await callLlm(stripped, { ...s, simple_model: null, complex_model: null }, other)), fellBack: true };
  }
}

const b64ToText = (d: string) => new TextDecoder().decode(Uint8Array.from(atob(d), (c) => c.charCodeAt(0)));

/* ------------------------------- Anthropic ------------------------------- */

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), maxRetries: 2, timeout: 90_000 });

async function callAnthropic(b: BodyT, model: string, s: Settings): Promise<Out> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of b.turns) {
    if (t.role === 'user') {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      for (const a of t.attachments ?? []) {
        if (a.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: a.data } });
        else if (a.mime === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name });
        else content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: b64ToText(a.data) }, title: a.name });
      }
      content.push({ type: 'text', text: t.text });
      messages.push({ role: 'user', content });
    } else if (t.role === 'assistant') {
      const raw = t.raw as { provider?: string; items?: unknown } | undefined;
      if (raw?.provider === 'anthropic' && Array.isArray(raw.items)) messages.push({ role: 'assistant', content: raw.items as Anthropic.Beta.BetaContentBlockParam[] });
      else {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (t.text) content.push({ type: 'text', text: t.text });
        for (const c of t.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        if (content.length) messages.push({ role: 'assistant', content });
      }
    } else {
      messages.push({ role: 'user', content: t.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })) });
    }
  }
  const tools: Anthropic.Beta.BetaToolUnion[] = b.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema }));
  if (s.web_search_enabled && /opus|sonnet|fable/.test(model)) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 3 } as unknown as Anthropic.Beta.BetaToolUnion);
  const usesFallback = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
  const res = await anthropic.beta.messages.create({
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: b.system }],
    tools,
    messages,
    output_config: { effort: b.complexity === 'complex' ? 'medium' : 'low' },
    ...(usesFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  if (res.stop_reason === 'refusal') return { text: 'Não posso ajudar com esse pedido.', toolCalls: [], raw: undefined, sources: [], provider: 'anthropic', model: res.model, ...usage };
  const toolCalls: Out['toolCalls'] = [];
  const sources: Out['sources'] = [];
  let text = '';
  for (const block of res.content) {
    if (block.type === 'text') {
      text += block.text;
      for (const c of (block as { citations?: { url?: string; title?: string }[] }).citations ?? []) if (c.url) sources.push({ url: c.url, title: c.title });
    } else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
  }
  return { text, toolCalls, raw: { provider: 'anthropic', items: res.content }, sources: dedupe(sources), provider: 'anthropic', model: res.model, ...usage };
}

/* -------------------------------- OpenAI -------------------------------- */
// Responses API: POST /v1/responses — input items, tools {type:'function'}, saída output[] com
// itens 'message' (output_text) e 'function_call' (call_id, name, arguments JSON).

interface OAItem { type: string; role?: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[]; call_id?: string; name?: string; arguments?: string; id?: string }

async function callOpenAI(b: BodyT, model: string, s: Settings): Promise<Out> {
  const input: unknown[] = [];
  for (const t of b.turns) {
    if (t.role === 'user') {
      const parts: unknown[] = [{ type: 'input_text', text: t.text }];
      for (const a of t.attachments ?? []) {
        if (a.kind === 'image') parts.push({ type: 'input_image', image_url: `data:${a.mime};base64,${a.data}` });
        else parts.push({ type: 'input_file', filename: a.name, file_data: `data:${a.mime};base64,${a.data}` });
      }
      input.push({ role: 'user', content: parts });
    } else if (t.role === 'assistant') {
      const raw = t.raw as { provider?: string; items?: OAItem[] } | undefined;
      if (raw?.provider === 'openai' && Array.isArray(raw.items)) {
        for (const it of raw.items) {
          if (it.type === 'function_call') input.push({ type: 'function_call', call_id: it.call_id, name: it.name, arguments: it.arguments });
          else if (it.type === 'message') input.push({ role: 'assistant', content: (it.content ?? []).map((c) => c.text ?? '').join('') });
        }
      } else {
        if (t.text) input.push({ role: 'assistant', content: t.text });
        for (const c of t.toolCalls ?? []) input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) });
      }
    } else for (const r of t.results) input.push({ type: 'function_call_output', call_id: r.id, output: r.content });
  }
  const tools: unknown[] = b.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema, strict: false }));
  if (s.web_search_enabled) tools.push({ type: 'web_search' });
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: JSON.stringify({ model, instructions: b.system, input, tools, store: false, max_output_tokens: 8000 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new ProviderHttpError(res.status, `openai ${res.status}`);
  const data = (await res.json()) as { output?: OAItem[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
  const toolCalls: Out['toolCalls'] = [];
  const sources: Out['sources'] = [];
  let text = '';
  for (const it of data.output ?? []) {
    if (it.type === 'message') {
      for (const c of it.content ?? []) {
        if (c.type === 'output_text') text += c.text ?? '';
        for (const an of c.annotations ?? []) if (an.type === 'url_citation' && an.url) sources.push({ url: an.url, title: an.title });
      }
    } else if (it.type === 'function_call') {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(it.arguments || '{}');
      } catch {
        /* argumentos inválidos: a validação do app rejeita */
      }
      toolCalls.push({ id: it.call_id!, name: it.name!, input: args });
    }
  }
  return { text, toolCalls, raw: { provider: 'openai', items: data.output ?? [] }, sources: dedupe(sources), provider: 'openai', model: data.model ?? model, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
}

function dedupe(s: Out['sources']) {
  return [...new Map(s.map((x) => [x.url, x])).values()].slice(0, 8);
}

/** Lista modelos disponíveis nas contas configuradas (para a tela AI Engine). */
export async function listModels(): Promise<{ provider: ProviderId; id: string }[]> {
  const out: { provider: ProviderId; id: string }[] = [];
  if (HAS.anthropic) {
    try {
      for await (const m of anthropic.models.list()) out.push({ provider: 'anthropic', id: m.id });
    } catch { /* lista indisponível */ }
  }
  if (HAS.openai) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` }, signal: AbortSignal.timeout(15_000) });
      if (r.ok) for (const m of ((await r.json()) as { data?: { id: string }[] }).data ?? []) out.push({ provider: 'openai', id: m.id });
    } catch { /* lista indisponível */ }
  }
  return out;
}

/** Registra consumo e custo estimado (tabela ai_calls). */
export async function logCall(db: SupabaseClient, userId: string, s: Settings, o: Partial<Out> & { status: 'ok' | 'error' | 'fallback'; specialist?: string; ms: number; error?: string }) {
  await db.from('ai_calls').insert({
    user_id: userId, provider: o.provider ?? 'desconhecido', model: o.model ?? 'desconhecido', specialist: o.specialist ?? null,
    input_tokens: o.inputTokens ?? 0, output_tokens: o.outputTokens ?? 0,
    est_cost_usd: o.model ? estimateCost(s, o.model, o.inputTokens ?? 0, o.outputTokens ?? 0) : null,
    latency_ms: o.ms, status: o.status, error: o.error?.slice(0, 300) ?? null,
  });
  if (o.status !== 'error') await db.rpc('increment_ai_usage', { p_user: userId, p_input: o.inputTokens ?? 0, p_output: o.outputTokens ?? 0 });
}

/** Limites: requisições por dia e orçamento mensal (custo estimado). */
export async function checkLimits(db: SupabaseClient, userId: string, s: Settings): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage, error } = await db.from('ai_usage').select('requests').eq('user_id', userId).eq('day', today).maybeSingle();
  if (error) throw new Error('Não foi possível verificar o consumo de IA.');
  if ((usage?.requests ?? 0) >= s.daily_request_limit) return 'Limite diário de uso da IA atingido (ajuste no AI Engine).';
  if (s.monthly_budget_usd != null) {
    const start = `${today.slice(0, 7)}-01T00:00:00Z`;
    const { data, error: costError } = await db.from('ai_calls').select('est_cost_usd').eq('user_id', userId).gte('created_at', start);
    if (costError) throw new Error('Não foi possível verificar o orçamento de IA.');
    const spent = (data ?? []).reduce((a: number, r: { est_cost_usd: number | null }) => a + Number(r.est_cost_usd ?? 0), 0);
    if (spent >= s.monthly_budget_usd) return `Orçamento mensal de IA atingido (US$ ${spent.toFixed(2)} de US$ ${s.monthly_budget_usd}).`;
  }
  return null;
}
