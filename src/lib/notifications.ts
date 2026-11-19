/**
 * Notificações.
 * - Servidor (Supabase Cron + Edge Function) envia Web Push / FCM mesmo com o app fechado.
 * - No celular (Capacitor), os lembretes também são agendados localmente no sistema.
 * - Com o app aberto, um verificador interno mostra o aviso na tela (e é o único canal no Modo Local).
 */
import { Capacitor } from '@capacitor/core';
import type { Repo } from '@/core/data/repo.ts';
import type { Reminder } from '@/core/types.ts';
import { supabase } from './supabase.ts';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export interface NotificationSupport {
  native: boolean;
  browserNotifications: boolean;
  webPush: boolean;
  serverConfigured: boolean;
}

export function notificationSupport(): NotificationSupport {
  const native = Capacitor.isNativePlatform();
  return {
    native,
    browserNotifications: typeof Notification !== 'undefined',
    webPush: 'serviceWorker' in navigator && 'PushManager' in window,
    serverConfigured: Boolean(supabase && (VAPID || native)),
  };
}

export function permissionState(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.warn('Service worker não registrado', e);
    return null;
  }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Pede permissão e registra este aparelho para receber push do servidor. */
export async function enablePush(repo: Repo): Promise<{ ok: boolean; message: string }> {
  const sup = notificationSupport();
  if (sup.native) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.requestPermissions();
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return { ok: false, message: 'Permissão de notificação negada no aparelho.' };
    const token = await new Promise<string>((resolve, reject) => {
      PushNotifications.addListener('registration', (t) => resolve(t.value));
      PushNotifications.addListener('registrationError', (e) => reject(new Error(e.error)));
      PushNotifications.register();
    });
    await saveToken(repo, Capacitor.getPlatform() as 'android' | 'ios', token);
    return { ok: true, message: 'Notificações ativadas neste celular.' };
  }
  if (!sup.browserNotifications) return { ok: false, message: 'Este navegador não suporta notificações.' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, message: 'Permissão de notificação negada. Libere em Configurações do site no navegador.' };
  if (!supabase || !VAPID || !sup.webPush) {
    return { ok: true, message: 'Notificações ativadas com o app aberto. Para receber com o app fechado, é preciso configurar o servidor (Supabase + chave VAPID).' };
  }
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) return { ok: true, message: 'Notificações ativas com o app aberto (service worker indisponível neste modo).' };
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) }));
  await saveToken(repo, 'web', JSON.stringify(sub.toJSON()));
  return { ok: true, message: 'Push ativado: você receberá lembretes mesmo com o app fechado (navegador aberto em segundo plano).' };
}

async function saveToken(repo: Repo, platform: 'web' | 'android' | 'ios', token: string) {
  const t = repo.table('device_tokens');
  const existing = (await t.list({ eq: { token } }))[0];
  if (existing) await t.update(existing.id, { enabled: true, last_seen_at: new Date().toISOString() });
  else await t.insert({ platform, token, enabled: true, last_seen_at: new Date().toISOString() });
}

export async function disablePush(repo: Repo) {
  const t = repo.table('device_tokens');
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const token = JSON.stringify(sub.toJSON());
      for (const row of await t.list({ eq: { token } })) await t.remove(row.id);
      await sub.unsubscribe();
    }
  }
}

/** No celular: espelha os próximos lembretes como notificações locais do sistema. */
export async function syncNativeLocalNotifications(repo: Repo) {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const pending = await repo.table('reminders').list({ eq: { status: 'pending' }, gte: { remind_at: new Date().toISOString() }, order: [{ field: 'remind_at' }], limit: 60 });
  const scheduled = await LocalNotifications.getPending();
  if (scheduled.notifications.length) await LocalNotifications.cancel({ notifications: scheduled.notifications.map((n) => ({ id: n.id })) });
  if (!pending.length) return;
  await LocalNotifications.schedule({
    notifications: pending.map((r) => ({
      id: hashId(r.id),
      title: r.title,
      body: r.body ?? 'Lembrete do JARVIS',
      schedule: { at: new Date(r.remind_at), allowWhileIdle: true },
      extra: { reminderId: r.id },
    })),
  });
}

function hashId(uuid: string) {
  let h = 0;
  for (const c of uuid) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Mostra uma notificação do sistema (aba aberta). */
export async function showSystemNotification(r: Pick<Reminder, 'id' | 'title' | 'body'>) {
  if (permissionState() !== 'granted') return false;
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  const opts: NotificationOptions = { body: r.body ?? 'Lembrete do JARVIS', tag: r.id, icon: '/icon.svg', badge: '/icon.svg', data: { url: '/' } };
  if (reg) await reg.showNotification(r.title, opts);
  else new Notification(r.title, opts);
  return true;
}

const SEEN_KEY = 'jarvis:seen-reminders';
function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}
function markSeen(ids: string[]) {
  const s = seen();
  ids.forEach((i) => s.add(i));
  localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500)));
}

/**
 * Verificador interno (app aberto). No Modo Local ele é responsável por marcar o lembrete como enviado.
 * Na nuvem, quem marca é o servidor; aqui só exibimos o aviso na tela.
 */
export function startInAppReminderLoop(repo: Repo, onDue: (r: Reminder) => void): () => void {
  let stopped = false;
  const check = async () => {
    if (stopped) return;
    try {
      const now = new Date();
      const due = await repo.table('reminders').list({
        in: { status: repo.mode === 'local' ? ['pending'] : ['pending', 'processing', 'sent'] },
        lte: { remind_at: now.toISOString() },
        gte: { remind_at: new Date(now.getTime() - 6 * 3600_000).toISOString() },
      });
      const s = seen();
      const fresh = due.filter((r) => !s.has(r.id));
      for (const r of fresh) {
        onDue(r);
        if (repo.mode === 'local') {
          await showSystemNotification(r);
          await repo.table('reminders').update(r.id, { status: 'sent', sent_at: now.toISOString() });
        }
      }
      if (repo.mode === 'local') {
        // Lembretes antigos (app fechado por muito tempo) ficam registrados como perdidos.
        const stale = await repo.table('reminders').list({ eq: { status: 'pending' }, lt: { remind_at: new Date(now.getTime() - 6 * 3600_000).toISOString() } });
        for (const r of stale) await repo.table('reminders').update(r.id, { status: 'failed', last_error: 'App fechado no horário (Modo Local não envia push).' });
      }
      markSeen(fresh.map((r) => r.id));
    } catch (e) {
      console.warn('Falha ao verificar lembretes', e);
    }
  };
  check();
  const id = window.setInterval(check, 20_000);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}
