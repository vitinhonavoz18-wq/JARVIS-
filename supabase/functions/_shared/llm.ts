/**
 * Provedores de IA compartilhados pelas funções de servidor.
 * As chaves vêm apenas das secrets do Supabase.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const PROVIDER = (Deno.env.get('AI_PROVIDER') ?? (Deno.env.get('ANTHROPIC_API_KEY') ? 'anthropic' : Deno.env.get('OPENAI_API_KEY') ? 'openai' : 'none')).toLowerCase();
// Roteamento por complexidade: modelo rápido/barato para pedidos simples, o mais capaz para planejamento.
const MODEL_COMPLEX = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
const MODEL_SIMPLE = Deno.env.get('ANTHROPIC_MODEL_FAST') ?? 'claude-haiku-5-5';

const ToolCall = z.object({ id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) });
export const Body = z.object({
  system: z.string().max(20_000),
  complexity: z.enum(['simple', 'complex']).default('simple'),
  tools: z.array(z.object({ name: z.string().max(64), description: z.string().max(2000), input_schema: z.record(z.string(), z.unknown()) })).max(40),
  turns: z
    .array(
      z.discriminatedUnion('role', [
        z.object({ role: z.literal('user'), text: z.string().max(20_000) }),
        z.object({ role: z.literal('assistant'), text: z.string().max(20_000), toolCalls: z.array(ToolCall).optional(), raw: z.unknown().optional() }),
        z.object({ role: z.literal('tool'), results: z.array(z.object({ id: z.string(), content: z.string().max(12_000), isError: z.boolean().optional() })) }),
      ]),
    )
    .min(1)
    .max(40),
});
export type BodyT = z.infer<typeof Body>;

export function callLlm(b: BodyT): Promise<Out> {
  return PROVIDER === 'openai' ? callOpenAI(b) : callAnthropic(b);
}

export function isRateLimit(e: unknown) {
  return e instanceof Anthropic.RateLimitError;
}

export function isProviderDown(e: unknown) {
  return e instanceof Anthropic.APIError && (e.status ?? 500) >= 500;
}

export interface Out {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  raw: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/* ------------------------------- Claude ------------------------------- */

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), maxRetries: 2, timeout: 60_000 });

async function callAnthropic(b: BodyT): Promise<Out> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of b.turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') {
      // Devolve o conteúdo original (inclui blocos de raciocínio), exigido entre chamadas de ferramenta.
      if (Array.isArray(t.raw)) messages.push({ role: 'assistant', content: t.raw as Anthropic.Beta.BetaContentBlockParam[] });
      else {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (t.text) content.push({ type: 'text', text: t.text });
        for (const c of t.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        if (content.length) messages.push({ role: 'assistant', content });
      }
    } else {
      // Todos os resultados de ferramenta em uma única mensagem.
      messages.push({ role: 'user', content: t.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })) });
    }
  }
  const model = b.complexity === 'complex' ? MODEL_COMPLEX : MODEL_SIMPLE;
  const usesFallback = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
  const res = await anthropic.beta.messages.create({
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: b.system }],
    tools: b.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema })),
    messages,
    output_config: { effort: b.complexity === 'complex' ? 'medium' : 'low' },
    ...(usesFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (res.stop_reason === 'refusal') {
    return { text: 'Não posso ajudar com esse pedido.', toolCalls: [], raw: undefined, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
  const toolCalls: Out['toolCalls'] = [];
  let text = '';
  for (const block of res.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
  }
  return { text, toolCalls, raw: res.content, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
}

/* ------------------------------- OpenAI ------------------------------- */
// Alternativa opcional (AI_PROVIDER=openai), via API HTTP oficial de Chat Completions.

async function callOpenAI(b: BodyT): Promise<Out> {
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
  const messages: unknown[] = [{ role: 'system', content: b.system }];
  for (const t of b.turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: t.text || null,
        ...(t.toolCalls?.length ? { tool_calls: t.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      });
    } else for (const r of t.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: JSON.stringify({ model, messages, tools: b.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: string } }) => {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(c.function.arguments || '{}');
    } catch {
      /* argumentos inválidos: a validação do app rejeita */
    }
    return { id: c.id, name: c.function.name, input };
  });
  return { text: msg.content ?? '', toolCalls, raw: undefined, model, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
}
