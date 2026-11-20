/**
 * Contrato versionado de eventos entre o n8n (ou outros sistemas) e o JARVIS.
 * Formato interno do JARVIS — não é um esquema nativo do n8n.
 */
import { z } from 'zod';

export const EVENT_SCHEMA_VERSION = '1.0';

export const EVENT_TYPES = [
  'workflow.execution.started',
  'workflow.execution.completed',
  'workflow.execution.failed',
  'project.alert',
  'project.metrics.snapshot',
  'project.activity',
] as const;

export const JarvisEvent = z.object({
  event_id: z.string().min(8).max(100),
  event_type: z.enum(EVENT_TYPES),
  schema_version: z.literal(EVENT_SCHEMA_VERSION),
  source: z.string().min(1).max(60),
  project_id: z.string().max(100).nullish(),
  workflow_id: z.string().max(100).nullish(),
  execution_id: z.string().max(100).nullish(),
  occurred_at: z.string().datetime({ offset: true }),
  correlation_id: z.string().uuid().nullish(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type JarvisEvent = z.infer<typeof JarvisEvent>;

/** Conteúdo esperado em alguns tipos de evento. */
export const AlertPayload = z.object({
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
  title: z.string().min(1).max(200),
  message: z.string().max(2000).optional(),
  link: z.string().url().optional(),
});
export const CompletionPayload = z.object({
  summary: z.string().max(2000).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(2000).optional(),
});
export const MetricsPayload = z.object({
  capability: z.string().min(1).max(80).default('metrics.summary'),
  data: z.record(z.string(), z.unknown()),
  period: z.string().max(60).optional(),
});

export const REPLAY_WINDOW_SECONDS = 300;

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Assinatura: hex(HMAC-SHA256(secret, `${timestamp}.${corpo}`)). Envie como `sha256=<hex>`. */
export async function signPayload(secret: string, timestamp: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(`${timestamp}.${body}`));
  return `sha256=${toHex(sig)}`;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'bad_signature' };

/** Verifica assinatura e janela de tempo (proteção contra replay). */
export async function verifySignature(secret: string, timestamp: string | null, signature: string | null, body: string, now = Date.now()): Promise<VerifyResult> {
  if (!timestamp || !signature) return { ok: false, reason: 'missing' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > REPLAY_WINDOW_SECONDS) return { ok: false, reason: 'stale' };
  const expected = await signPayload(secret, timestamp, body);
  return safeEqual(expected, signature.trim()) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
