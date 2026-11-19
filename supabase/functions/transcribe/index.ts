/**
 * Transcrição de voz para navegadores sem reconhecimento nativo (ex.: Safari/Firefox).
 * O áudio é processado em memória e descartado — nada é armazenado.
 * Requer OPENAI_API_KEY (modelo de transcrição configurável).
 */
import { cors, json, requireUser, log } from '../_shared/http.ts';

const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const user = await requireUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return json({ error: 'Transcrição no servidor não configurada. Use Chrome/Edge para voz nativa.' }, 503);

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof File)) return json({ error: 'Áudio ausente' }, 400);
  if (audio.size > MAX_BYTES) return json({ error: 'Áudio muito longo' }, 413);
  if (!/^audio\//.test(audio.type || 'audio/webm')) return json({ error: 'Formato não suportado' }, 415);

  const body = new FormData();
  body.append('file', audio, 'fala.webm');
  body.append('model', Deno.env.get('OPENAI_TRANSCRIBE_MODEL') ?? 'gpt-4o-mini-transcribe');
  body.append('language', 'pt');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    log('transcribe_error', { user: user.id, status: res.status });
    return json({ error: 'Falha na transcrição' }, 502);
  }
  const data = await res.json();
  return json({ text: data.text ?? '' });
});
