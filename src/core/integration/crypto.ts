/**
 * Criptografia de credenciais de integração (AES-256-GCM) — usada SOMENTE no servidor.
 * A chave mestra vem da secret INTEGRATIONS_ENCRYPTION_KEY (32 bytes em base64).
 */
function b64(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function importMasterKey(base64Key: string): Promise<CryptoKey> {
  const raw = unb64(base64Key);
  if (raw.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY deve ter 32 bytes (base64).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Formato: v1:<iv base64>:<cifra base64>. O `context` (ex.: id do dono) entra como dado autenticado. */
export async function encryptSecret(key: CryptoKey, plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(plain));
  return `v1:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

export async function decryptSecret(key: CryptoKey, enc: string, context: string): Promise<string> {
  const [v, iv, ct] = enc.split(':');
  if (v !== 'v1' || !iv || !ct) throw new Error('segredo em formato inválido');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(context) }, key, unb64(ct));
  return new TextDecoder().decode(pt);
}

export function randomSecret(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
