/** Implementação no navegador: tudo passa pela Edge Function `automation-gateway` (credenciais nunca chegam aqui). */
import type { IntegrationServices } from '@/core/integration/services.ts';
import type { ActionResult, ConnectorHealth } from '@/core/connectors/types.ts';
import type { AutomationRun } from '@/core/types.ts';
import { supabase } from './supabase.ts';

export async function gateway<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Requer o Modo Nuvem (Supabase conectado).');
  const { data, error } = await supabase.functions.invoke('automation-gateway', { body });
  if (error) {
    let detail = error.message;
    try {
      const b = await (error as { context?: Response }).context?.json();
      if (b?.error) detail = b.error;
    } catch {
      /* corpo não é JSON */
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const cloudServices: IntegrationServices = {
  runAutomation: (req) => gateway<{ ok: boolean; run?: AutomationRun; message: string }>({ action: 'run', automation_id: req.automationId, input: req.input, source: req.source, idempotency_key: req.idempotencyKey }),
  refreshRun: (runId) => gateway<{ ok: boolean; run?: AutomationRun; message: string }>({ action: 'refresh_run', run_id: runId }),
  projectAction: (projectId, capability, input, confirmed) => gateway<ActionResult>({ action: 'project_action', project_id: projectId, capability, input, confirmed }),
  projectHealth: (projectId) => gateway<ConnectorHealth>({ action: 'project_health', project_id: projectId }),
  async createWorkflowDraft(connectionId, goal, tz) {
    const r = await gateway<{ ok?: boolean; workflowId?: string; message?: string }>({ action: 'draft_workflow', connection_id: connectionId, goal, tz, create: true });
    return { ok: Boolean(r.ok), workflowId: r.workflowId, message: r.message ?? 'ok' };
  },
};
