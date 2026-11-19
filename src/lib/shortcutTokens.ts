/** Chaves pessoais para atalhos (Siri/Android). A chave é gerada aqui e só o hash vai para o banco. */
export const TOKEN_PREFIX = 'jfv_';

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return TOKEN_PREFIX + b64;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function commandEndpoint(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return url && !url.includes('SEU-PROJETO') ? `${url.replace(/\/$/, '')}/functions/v1/jarvis-command` : null;
}
