/**
 * Cliente da API pública do n8n (/api/v1, cabeçalho X-N8N-API-KEY).
 * Importante: a API pública NÃO executa workflows diretamente — execução é feita por Webhook.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ConnectionStatus = 'connected' | 'disconnected' | 'unauthorized' | 'unavailable' | 'misconfigured';

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
  projectId: string | null;
  description: string | null;
  triggers: ('webhook' | 'schedule' | 'manual' | 'other')[];
  webhookPaths: string[];
  updatedAt: string | null;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: 'canceled' | 'crashed' | 'error' | 'new' | 'running' | 'success' | 'unknown' | 'waiting';
  mode: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export class N8nError extends Error {
  constructor(message: string, readonly status: ConnectionStatus, readonly httpStatus?: number) {
    super(message);
  }
}

export function normalizeBaseUrl(url: string): string {
  const u = new URL(url.trim());
  if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw new N8nError('A URL do n8n precisa usar HTTPS.', 'misconfigured');
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}`;
}

interface RawNode { type?: string; parameters?: Record<string, unknown>; disabled?: boolean }
interface RawWorkflow { id: string; name: string; active?: boolean; activeVersionId?: string | null; tags?: { name: string }[]; nodes?: RawNode[]; description?: string | null; updatedAt?: string; shared?: { projectId?: string }[] }

export function summarizeWorkflow(w: RawWorkflow): N8nWorkflowSummary {
  const nodes = (w.nodes ?? []).filter((n) => !n.disabled);
  const triggers = new Set<N8nWorkflowSummary['triggers'][number]>();
  const webhookPaths: string[] = [];
  for (const n of nodes) {
    const t = String(n.type ?? '');
    if (t === 'n8n-nodes-base.webhook') {
      triggers.add('webhook');
      if (n.parameters?.path) webhookPaths.push(String(n.parameters.path));
    } else if (/scheduleTrigger|cron/i.test(t)) triggers.add('schedule');
    else if (/manualTrigger/i.test(t)) triggers.add('manual');
    else if (/Trigger$/i.test(t)) triggers.add('other');
  }
  return {
    id: String(w.id),
    name: w.name,
    active: Boolean(w.activeVersionId ?? w.active),
    tags: (w.tags ?? []).map((t) => t.name),
    projectId: w.shared?.[0]?.projectId ?? null,
    description: w.description ?? null,
    triggers: [...triggers],
    webhookPaths,
    updatedAt: w.updatedAt ?? null,
  };
}

export class N8nClient {
  private base: string;
  constructor(baseUrl: string, private apiKey: string, private fetcher: FetchLike = fetch, private timeoutMs = 15000) {
    this.base = `${normalizeBaseUrl(baseUrl)}/api/v1`;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.base}${path}`, {
        ...init,
        headers: { 'X-N8N-API-KEY': this.apiKey, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new N8nError(`n8n inacessível: ${e instanceof Error ? e.message : String(e)}`, 'unavailable');
    }
    if (res.status === 401 || res.status === 403) throw new N8nError('Chave da API do n8n recusada ou sem permissão para esta operação.', 'unauthorized', res.status);
    if (res.status === 404) throw new N8nError('Recurso não encontrado nesta instância/versão do n8n.', 'misconfigured', 404);
    if (res.status >= 500) throw new N8nError(`n8n respondeu com erro ${res.status}.`, 'unavailable', res.status);
    if (!res.ok) throw new N8nError(`n8n recusou a requisição (${res.status}).`, 'misconfigured', res.status);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Teste real de conexão: lista 1 workflow. */
  async test(): Promise<{ status: ConnectionStatus; detail: string }> {
    try {
      await this.req('/workflows?limit=1');
      return { status: 'connected', detail: 'Conexão verificada com a API pública do n8n.' };
    } catch (e) {
      if (e instanceof N8nError) return { status: e.status, detail: e.message };
      return { status: 'disconnected', detail: String(e) };
    }
  }

  async listWorkflows(opts: { projectId?: string; maxPages?: number } = {}): Promise<N8nWorkflowSummary[]> {
    const out: N8nWorkflowSummary[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < (opts.maxPages ?? 10); page++) {
      const q = new URLSearchParams({ limit: '100' });
      if (cursor) q.set('cursor', cursor);
      if (opts.projectId) q.set('projectId', opts.projectId);
      const r: { data: RawWorkflow[]; nextCursor?: string | null } = await this.req(`/workflows?${q}`);
      out.push(...r.data.map(summarizeWorkflow));
      cursor = r.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
  }

  async listExecutions(opts: { workflowId?: string; status?: N8nExecution['status']; limit?: number } = {}): Promise<N8nExecution[]> {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 20) });
    if (opts.workflowId) q.set('workflowId', opts.workflowId);
    if (opts.status) q.set('status', opts.status);
    const r: { data: (N8nExecution & { id: string | number; workflowId: string | number })[] } = await this.req(`/executions?${q}`);
    return r.data.map((e) => ({ id: String(e.id), workflowId: String(e.workflowId), status: e.status, mode: e.mode, startedAt: e.startedAt ?? null, stoppedAt: e.stoppedAt ?? null }));
  }

  async getExecution(id: string): Promise<N8nExecution> {
    const e: N8nExecution & { id: string | number; workflowId: string | number } = await this.req(`/executions/${encodeURIComponent(id)}`);
    return { id: String(e.id), workflowId: String(e.workflowId), status: e.status, mode: e.mode, startedAt: e.startedAt ?? null, stoppedAt: e.stoppedAt ?? null };
  }

  /** Interromper execução. Nem toda versão do n8n oferece; o chamador trata o erro. */
  async stopExecution(id: string): Promise<void> {
    await this.req(`/executions/${encodeURIComponent(id)}/stop`, { method: 'POST' });
  }

  /** Cria o workflow INATIVO (rascunho). Ativação é uma etapa separada e explícita. */
  async createWorkflow(def: { name: string; nodes: unknown[]; connections: Record<string, unknown>; settings: Record<string, unknown> }): Promise<{ id: string }> {
    const r: { id: string | number } = await this.req('/workflows', { method: 'POST', body: JSON.stringify(def) });
    return { id: String(r.id) };
  }

  async activateWorkflow(id: string): Promise<void> {
    await this.req(`/workflows/${encodeURIComponent(id)}/activate`, { method: 'POST' });
  }
}

/** Converte o status do n8n no ciclo de vida das execuções do JARVIS. */
export function mapExecutionStatus(s: N8nExecution['status']): 'running' | 'succeeded' | 'failed' | 'cancelled' | 'started' {
  switch (s) {
    case 'success': return 'succeeded';
    case 'error':
    case 'crashed': return 'failed';
    case 'canceled': return 'cancelled';
    case 'running':
    case 'waiting': return 'running';
    default: return 'started';
  }
}
