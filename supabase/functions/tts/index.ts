/**
 * Voz premium (ElevenLabs) — texto → áudio em streaming.
 * - Chave só nas secrets do servidor (ELEVENLABS_API_KEY); o app nunca a vê.
 * - Usuário autenticado, texto limitado por pedido e por dia (memória da instância).
 * - O áudio é repassado em streaming (começa a tocar antes de terminar de gerar) e não é armazenado.
 * Secrets: ELEVENLABS_API_KEY (obrigatória), ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL, ELEVENLABS_DAILY_CHARS.
 */
import { cors, json, requireUser, log } from '../_shared/http.ts';

const KEY = Deno.env.get('ELEVENLABS_API_KEY');
// Voz padrão: barítono britânico (RP) calmo e elegante da biblioteca ElevenLabs — troque por ELEVENLABS_VOICE_ID.
const VOICE = Deno.env.get('ELEVENLABS_VOICE_ID') ?? 'K8RBkZM3VaxoGBaGvie0';
// Flash v2.5: menor latência e fala português; troque por eleven_multilingual_v2 para mais expressividade.
const MODEL = Deno.env.get('ELEVENLABS_MODEL') ?? 'eleven_flash_v2_5';
const MAX_CHARS = 1200;
const DAILY = Number(Deno.env.get('ELEVENLABS_DAILY_CHARS') ?? 20000);
const usage = new Map<string, { day: string; chars: number }>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const raw = await req.json().catch(() => null);
  if (raw?.ping) return json({ configured: Boolean(KEY) });
  if (!KEY) return json({ error: 'Voz premium não configurada no servidor.' }, 503);

  const text = typeof raw?.text === 'string' ? raw.text.trim().slice(0, MAX_CHARS) : '';
  if (!text) return json({ error: 'Texto ausente' }, 400);
  const speed = Math.min(1.2, Math.max(0.7, Number(raw?.speed) || 1));

  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(user.id);
  const used = u?.day === day ? u.chars : 0;
  if (used + text.length > DAILY) return json({ error: 'Limite diário da voz premium atingido.' }, 429);
  usage.set(user.id, { day, chars: used + text.length });

  const started = Date.now();
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE)}/stream?output_format=mp3_44100_64&optimize_streaming_latency=2`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      language_code: 'pt',
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed },
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok || !res.body) {
    log('tts_error', { user: user.id, status: res?.status ?? 0 });
    usage.set(user.id, { day, chars: used });
    return json({ error: 'Voz premium indisponível no momento.' }, res?.status === 429 ? 429 : 502);
  }
  log('tts', { user: user.id, chars: text.length, ms: Date.now() - started });
  return new Response(res.body, { headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
});
