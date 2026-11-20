/**
 * Project Connector SDK — contrato padrão para ligar projetos/empresas ao JARVIS.
 * Cada conector declara capacidades com nível de risco; o JARVIS nunca ultrapassa
 * as permissões do usuário nem executa escrita sensível sem confirmação.
 */
export type RiskLevel = 'read' | 'reversible' | 'sensitive' | 'external' | 'destructive';

export const RISK_LABEL: Record<RiskLevel, string> = {
  read: 'Somente leitura',
  reversible: 'Escrita reversível',
  sensitive: 'Escrita sensível',
  external: 'Operação externa',
  destructive: 'Operação destrutiva',
};

/** Risco que exige aprovação explícita do usuário antes de executar. */
export function requiresConfirmation(risk: RiskLevel): boolean {
  return risk === 'sensitive' || risk === 'external' || risk === 'destructive';
}

export interface Capability {
  id: string; // ex.: "metrics.summary"
  name: string;
  description: string;
  risk: RiskLevel;
  /** Escopo exigido (ex.: "metrics:read"). */
  scope: string;
  /** JSON Schema simples da entrada. */
  inputSchema?: Record<string, unknown>;
  /** Dados devolvidos são agregados (sem dados pessoais de clientes). */
  aggregatedOnly?: boolean;
}

export interface ConnectorHealth {
  status: 'healthy' | 'degraded' | 'down' | 'unauthorized' | 'not_configured';
  detail: string;
  checkedAt: string;
  latencyMs?: number;
}

export interface AuthorizedContext {
  userId: string;
  /** Escopos concedidos pelo usuário a este projeto. */
  scopes: string[];
  /** true apenas quando o usuário aprovou explicitamente esta ação. */
  confirmed: boolean;
  correlationId: string;
}

export interface ActionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Origem e horário — exigidos para tudo que aparece no painel executivo. */
  source: string;
  fetchedAt: string;
}

export interface JarvisProjectConnector {
  id: string;
  name: string;
  healthCheck(): Promise<ConnectorHealth>;
  listCapabilities(): Promise<Capability[]>;
  executeAction(action: string, input: unknown, context: AuthorizedContext): Promise<ActionResult>;
}

/** Verificação central de autorização, aplicada antes de qualquer conector executar. */
export function authorize(cap: Capability | undefined, ctx: AuthorizedContext): { ok: true } | { ok: false; reason: string } {
  if (!cap) return { ok: false, reason: 'Capacidade não oferecida por este projeto.' };
  if (!ctx.scopes.includes(cap.scope) && !ctx.scopes.includes('*')) return { ok: false, reason: `Escopo “${cap.scope}” não autorizado para este projeto.` };
  if (requiresConfirmation(cap.risk) && !ctx.confirmed) return { ok: false, reason: 'Esta ação exige sua confirmação explícita.' };
  return { ok: true };
}
