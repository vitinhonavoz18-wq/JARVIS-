/**
 * Serviços externos que as ferramentas podem usar (n8n e conectores de projetos).
 * No navegador, chamam a Edge Function `automation-gateway`; no servidor, rodam direto.
 * Quando ausentes (Modo Local), as ferramentas informam que a integração exige o Modo Nuvem.
 */
import type { AutomationRun } from '../types.ts';
import type { ActionResult, ConnectorHealth } from '../connectors/types.ts';

export interface RunRequest {
  automationId: string;
  input: Record<string, unknown>;
  source: AutomationRun['source'];
  idempotencyKey?: string;
}

export interface IntegrationServices {
  runAutomation(req: RunRequest): Promise<{ ok: boolean; run?: AutomationRun; message: string }>;
  refreshRun(runId: string): Promise<{ ok: boolean; run?: AutomationRun; message: string }>;
  projectAction(projectId: string, capability: string, input: Record<string, unknown>, confirmed: boolean): Promise<ActionResult>;
  projectHealth(projectId: string): Promise<ConnectorHealth>;
  /** Monta (no servidor) e cria INATIVO no n8n um rascunho a partir do objetivo. */
  createWorkflowDraft(connectionId: string, goal: string, tz: string): Promise<{ ok: boolean; workflowId?: string; message: string }>;
}

/** Validação simples de entrada contra o input_schema registrado da automação. */
export function validateInput(schema: { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] }, input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const props = schema.properties ?? {};
  for (const r of schema.required ?? []) if (input[r] === undefined || input[r] === '' || input[r] === null) errors.push(`campo obrigatório “${r}” ausente`);
  for (const [k, v] of Object.entries(input)) {
    const p = props[k];
    if (!p) {
      errors.push(`campo “${k}” não é aceito por esta automação`);
      continue;
    }
    const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    if (p.type && p.type !== t && !(p.type === 'integer' && t === 'number' && Number.isInteger(v))) errors.push(`campo “${k}” deve ser ${p.type}`);
    if (p.enum && !p.enum.includes(v)) errors.push(`campo “${k}” fora das opções permitidas`);
  }
  return errors;
}

export const RUN_STATUS_LABEL: Record<AutomationRun['status'], string> = {
  queued: 'na fila',
  requested: 'solicitada',
  started: 'iniciada no n8n (aguardando resultado)',
  running: 'em andamento',
  succeeded: 'concluída com sucesso',
  failed: 'falhou',
  cancelled: 'cancelada',
  timeout: 'sem resposta no prazo',
};

export const ACTIVE_RUN = ['queued', 'requested', 'started', 'running'] as const;
