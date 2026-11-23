/**
 * Processador da fila de lembretes. Chamado a cada minuto pelo Supabase Cron (ver supabase/setup/cron.sql).
 * - Reivindica lembretes vencidos com bloqueio (FOR UPDATE SKIP LOCKED): nunca envia o mesmo lembrete duas vezes.
 * - Respeita o horário de silêncio de cada usuário (adia para o fim do silêncio).
 * - Envia Web Push (navegador) e FCM (Android/iOS), registra cada entrega e faz novas tentativas com limite.
 */
import webpush from 'web-push';
import { SignJWT, importPKCS8 } from 'jose';
import { adminClient, json, log } from '../_shared/http.ts';
import { processQueue } from '../_shared/automation.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
const FCM_SA = Deno.env.get('FCM_SERVICE_ACCOUNT'); // JSON da conta de serviço do Firebase (opcional)
const MAX_ATTEMPTS = 5;

if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', VAPID_PUBLIC, VAPID_PRIVATE);

interface Reminder { id: string; user_id: string; title: string; body: string | null; remind_at: string; attempts: number; entity_type: string; entity_id: string | null }
interface Device { id: string; platform: 'web' | 'android' | 'ios'; token: string }
interface Prefs { user_id: string; timezone: string; quiet_hours_start: string | null; quiet_hours_end: string | null }

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Se agora estiver no horário de silêncio do usuário, devolve quando ele termina. */
export function quietUntil(now: Date, p: Prefs | undefined): Date | null {
  if (!p?.quiet_hours_start || !p.quiet_hours_end) return null;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: p.timezone || 'America/Bahia', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  const [h, m] = fmt.format(now).split(':').map(Number);
  const cur = h * 60 + m;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const s = toMin(p.quiet_hours_start);
  const e = toMin(p.quiet_hours_end);
  const inQuiet = s < e ? cur >= s && cur < e : cur >= s || cur < e;
  if (!inQuiet) return null;
  const wait = (e - cur + 1440) % 1440;
  return new Date(now.getTime() + wait * 60000);
}

let fcmToken: { value: string; exp: number } | null = null;
async function getFcmAccessToken(sa: { client_email: string; private_key: string }) {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const data = await res.json();
  fcmToken = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return fcmToken.value;
}

async function send(r: Reminder, d: Device): Promise<{ ok: boolean; error?: string; gone?: boolean }> {
  const payload = { title: r.title, body: r.body ?? 'Lembrete do JARVIS', tag: r.id, url: r.entity_type === 'event' ? '/agenda' : r.entity_type === 'task' ? '/tarefas' : '/' };
  if (d.platform === 'web') {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { ok: false, error: 'VAPID não configurado' };
    try {
      await webpush.sendNotification(JSON.parse(d.token), JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return { ok: false, error: `webpush ${status ?? 'erro'}`, gone: status === 404 || status === 410 };
    }
  }
  if (!FCM_SA) return { ok: false, error: 'FCM não configurado' };
  const sa = JSON.parse(FCM_SA);
  const token = await getFcmAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: { token: d.token, notification: { title: payload.title, body: payload.body }, data: { url: payload.url, reminderId: r.id }, android: { priority: 'high' }, apns: { headers: { 'apns-priority': '10' } } } }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `fcm ${res.status}`, gone: res.status === 404 };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const secret = req.headers.get('x-cron-secret') ?? '';
  if (!CRON_SECRET || !constantTimeEqual(secret, CRON_SECRET)) return json({ error: 'não autorizado' }, 401);

  const db = adminClient();
  const now = new Date();
  // Fila de automações (despacho, retentativas, prazos) roda no mesmo agendamento.
  const automations = await processQueue(db).catch((e) => {
    log('automation_queue_error', { error: String(e) });
    return { dispatched: 0, expired: 0 };
  });
  const { data: claimed, error } = await db.rpc('claim_due_reminders', { p_limit: 200 });
  if (error) {
    log('reminders_claim_error', { error: error.message });
    return json({ error: 'falha ao reivindicar' }, 500);
  }
  const reminders = (claimed ?? []) as Reminder[];
  if (!reminders.length) return json({ processed: 0, automations });

  const users = [...new Set(reminders.map((r) => r.user_id))];
  const [{ data: prefs }, { data: devices }] = await Promise.all([
    db.from('user_preferences').select('user_id,timezone,quiet_hours_start,quiet_hours_end').in('user_id', users),
    db.from('device_tokens').select('id,user_id,platform,token').in('user_id', users).eq('enabled', true),
  ]);
  const prefMap = new Map((prefs ?? []).map((p: Prefs) => [p.user_id, p]));

  const stats = { sent: 0, deferred: 0, retry: 0, failed: 0, noDevice: 0 };
  for (const r of reminders) {
    const until = quietUntil(now, prefMap.get(r.user_id));
    if (until) {
      await db.from('reminders').update({ status: 'pending', remind_at: until.toISOString(), attempts: r.attempts - 1 }).eq('id', r.id);
      stats.deferred++;
      continue;
    }
    const mine = ((devices ?? []) as (Device & { user_id: string })[]).filter((d) => d.user_id === r.user_id);
    if (!mine.length) {
      // Sem aparelho com push: o aviso aparece quando o app estiver aberto.
      await db.from('reminder_deliveries').insert({ user_id: r.user_id, reminder_id: r.id, channel: 'in_app', status: 'skipped', error: 'nenhum aparelho com push ativo' });
      await db.from('reminders').update({ status: 'sent', sent_at: now.toISOString(), last_error: 'sem push: entregue apenas no app' }).eq('id', r.id);
      stats.noDevice++;
      continue;
    }
    let anyOk = false;
    let lastErr = '';
    for (const d of mine) {
      // Idempotência: pula aparelhos que já receberam este lembrete.
      const { data: prev } = await db.from('reminder_deliveries').select('id').eq('reminder_id', r.id).eq('device_token_id', d.id).eq('status', 'sent').maybeSingle();
      if (prev) {
        anyOk = true;
        continue;
      }
      const res = await send(r, d).catch((e) => ({ ok: false, error: String(e).slice(0, 200), gone: false }));
      await db.from('reminder_deliveries').insert({ user_id: r.user_id, reminder_id: r.id, device_token_id: d.id, channel: d.platform === 'web' ? 'web_push' : 'fcm', status: res.ok ? 'sent' : 'failed', error: res.error ?? null });
      if (res.gone) await db.from('device_tokens').update({ enabled: false }).eq('id', d.id);
      if (res.ok) anyOk = true;
      else lastErr = res.error ?? 'erro';
    }
    if (anyOk) {
      await db.from('reminders').update({ status: 'sent', sent_at: now.toISOString(), last_error: null }).eq('id', r.id);
      stats.sent++;
    } else if (r.attempts >= MAX_ATTEMPTS) {
      await db.from('reminders').update({ status: 'failed', last_error: lastErr }).eq('id', r.id);
      stats.failed++;
    } else {
      // Nova tentativa com espera crescente (1, 2, 4, 8 min).
      const retryAt = new Date(now.getTime() + 2 ** (r.attempts - 1) * 60000);
      await db.from('reminders').update({ status: 'pending', remind_at: retryAt.toISOString(), last_error: lastErr }).eq('id', r.id);
      stats.retry++;
    }
  }
  log('reminders_processed', { total: reminders.length, ...stats });
  return json({ processed: reminders.length, ...stats, automations });
});
