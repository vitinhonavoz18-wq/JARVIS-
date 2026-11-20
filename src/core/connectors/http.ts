/**
 * Conector HTTP — “Jarvis Connector Protocol” (ver docs/CONNECTOR-PROTOCOL.md).
 * O projeto expõe:
 *   GET  {base}/jarvis/health        → { status, detail }
 *   GET  {base}/jarvis/capabilities  → { capabilities: Capability[] }
 *   POST {base}/jarvis/actions/{id}  → { ok, data | error }
 * Autenticação: Authorization: Bearer <token do projeto> (guardado criptografado no servidor).
 */
import type { FetchLike } from '../integration/n8n.ts';
import { authorize, type ActionResult, type AuthorizedContext, type Capability, type ConnectorHealth, type JarvisProjectConnector } from './types.ts';

export class HttpConnector implements JarvisProjectConnector {
  private caps: Capability[] | null = null;
  constructor(
    readonly id: string,
    readonly name: string,
    private baseUrl: string,
    private token: string,
    private fetcher: FetchLike = fetch,
    private timeoutMs = 15000,
  ) {
    if (!/^https:\/\//.test(baseUrl)) throw new Error('O conector exige HTTPS.');
  }

  private async call(path: string, init: RequestInit = {}) {
    return this.fetcher(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const r = await this.call('/jarvis/health');
      if (r.status === 401 || r.status === 403) return { status: 'unauthorized', detail: 'Token recusado pelo projeto.', checkedAt };
      if (!r.ok) return { status: 'down', detail: `Projeto respondeu ${r.status}.`, checkedAt };
      const body = (await r.json().catch(() => ({}))) as { status?: string; detail?: string };
      const status = body.status === 'degraded' ? 'degraded' : 'healthy';
      return { status, detail: body.detail ?? 'Operacional.', checkedAt, latencyMs: Date.now() - started };
    } catch (e) {
      return { status: 'down', detail: `Sem resposta: ${e instanceof Error ? e.message : String(e)}`, checkedAt };
    }
  }

  async listCapabilities(): Promise<Capability[]> {
    if (this.caps) return this.caps;
    const r = await this.call('/jarvis/capabilities');
    if (!r.ok) throw new Error(`Não foi possível listar capacidades (${r.status}).`);
    const body = (await r.json()) as { capabilities?: Capability[] };
    this.caps = (body.capabilities ?? []).filter((c) => c && typeof c.id === 'string' && typeof c.risk === 'string');
    return this.caps;
  }

  async executeAction(action: string, input: unknown, ctx: AuthorizedContext): Promise<ActionResult> {
    const fetchedAt = new Date().toISOString();
    const cap = (await this.listCapabilities()).find((c) => c.id === action);
    const auth = authorize(cap, ctx);
    if (!auth.ok) return { ok: false, error: auth.reason, source: this.name, fetchedAt };
    const r = await this.call(`/jarvis/actions/${encodeURIComponent(action)}`, {
      method: 'POST',
      body: JSON.stringify({ input: input ?? {}, correlation_id: ctx.correlationId }),
    });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; data?: unknown; error?: string };
    if (!r.ok || body.ok === false) return { ok: false, error: body.error ?? `Falha (${r.status}).`, source: this.name, fetchedAt };
    return { ok: true, data: body.data, source: this.name, fetchedAt };
  }
}
