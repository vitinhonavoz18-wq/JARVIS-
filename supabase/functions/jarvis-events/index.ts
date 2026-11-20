/**
 * Entrada de eventos do n8n (e outros sistemas) para o JARVIS.
 *
 *   POST /functions/v1/jarvis-events
 *   X-Jarvis-Connection: <id da conexão>        X-Jarvis-Timestamp: <unix segundos>
 *   X-Jarvis-Signature: sha256=<HMAC-SHA256(segredo, "<timestamp>.<corpo>")>
 *   Corpo: contrato JarvisEvent v1.0 (src/core/integration/contract.ts)
 *
 * Proteções: assinatura HMAC por conexão, janela de 5 minutos contra replay, idempotência por event_id.
 */
import { adminClient, json, log } from '../_shared/http.ts';
import { getSecret } from '../_shared/automation.ts';
import { handleEvent } from '../_shared/events.ts';
import { JarvisEvent, verifySignature } from '../../../src/core/integration/contract.ts';

const MAX_BODY = 256 * 1024;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const connectionId = req.headers.get('x-jarvis-connection') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return json({ error: 'conexão inválida' }, 401);
  const body = await req.text();
  if (body.length > MAX_BODY) return json({ error: 'corpo muito grande' }, 413);

  const db = adminClient();
  const { data: conn } = await db.from('automation_connections').select('id,user_id').eq('id', connectionId).maybeSingle();
  if (!conn) return json({ error: 'não autorizado' }, 401);
  const secret = await getSecret(db, conn.user_id, 'automation_connection', conn.id, 'events_secret').catch(() => null);
  if (!secret) return json({ error: 'não autorizado' }, 401);
  const v = await verifySignature(secret, req.headers.get('x-jarvis-timestamp'), req.headers.get('x-jarvis-signature'), body);
  if (!v.ok) {
    log('events_rejected', { connection: conn.id, reason: v.reason });
    return json({ error: v.reason === 'stale' ? 'timestamp fora da janela' : 'assinatura inválida' }, 401);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const p = JarvisEvent.safeParse(parsedJson);
  if (!p.success) return json({ error: 'evento fora do contrato', issues: p.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`) }, 422);
  const result = await handleEvent(db, conn.user_id, conn.id, p.data);
  log('event_received', { connection: conn.id, type: p.data.event_type, duplicate: result.duplicate });
  return json({ ok: true, ...result });
});
