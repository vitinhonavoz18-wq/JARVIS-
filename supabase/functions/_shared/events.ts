/** Processamento de eventos recebidos (idempotente). Separado para ser testável. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AlertPayload, CompletionPayload, MetricsPayload, type JarvisEvent } from '../../../src/core/integration/contract.ts';

export async function handleEvent(db: SupabaseClient, uid: string, connectionId: string, ev: JarvisEvent): Promise<{ duplicate: boolean }> {
  const { error: dupErr } = await db.from('integration_events').insert({
    user_id: uid, connection_id: connectionId, event_id: ev.event_id, event_type: ev.event_type, schema_version: ev.schema_version, source: ev.source,
    project_ref: ev.project_id ?? null, workflow_id: ev.workflow_id ?? null, correlation_id: ev.correlation_id ?? null, occurred_at: ev.occurred_at, payload: ev.payload,
  });
  if (dupErr?.code === '23505') return { duplicate: true };
  if (dupErr) throw new Error(dupErr.message);

  if (ev.event_type.startsWith('workflow.execution.') && ev.correlation_id) {
    const c = CompletionPayload.safeParse(ev.payload);
    const status = ev.event_type === 'workflow.execution.completed' ? 'succeeded' : ev.event_type === 'workflow.execution.failed' ? 'failed' : 'running';
    const patch: Record<string, unknown> = { status };
    if (ev.execution_id) patch.n8n_execution_id = ev.execution_id;
    if (status !== 'running') patch.finished_at = new Date().toISOString();
    if (c.success) {
      patch.output_summary = c.data.summary ?? null;
      patch.output = c.data.output ?? null;
      if (status === 'failed') patch.error = c.data.error ?? c.data.summary ?? 'Falha informada pelo workflow.';
    }
    const { data: run } = await db.from('automation_runs').update(patch).eq('correlation_id', ev.correlation_id).eq('user_id', uid)
      .in('status', ['requested', 'started', 'running', 'queued', 'timeout']).select('automation_id').maybeSingle();
    if (run && status === 'failed') {
      const { data: auto } = await db.from('automations').select('name,alert_on_failure').eq('id', run.automation_id).single();
      if (auto?.alert_on_failure) await db.from('alerts').insert({ user_id: uid, severity: 'warning', title: `Automação falhou: ${auto.name}`, body: String(patch.error ?? ''), source: 'n8n', link: '/automacoes' });
    }
  } else if (ev.event_type === 'workflow.execution.failed') {
    await db.from('alerts').insert({ user_id: uid, severity: 'warning', title: 'Uma automação do n8n apresentou falha', body: String((ev.payload as { error?: string }).error ?? ev.workflow_id ?? ''), source: 'n8n', link: '/automacoes' });
  }

  if (ev.event_type === 'project.alert') {
    const a = AlertPayload.safeParse(ev.payload);
    if (a.success) {
      await db.from('alerts').insert({ user_id: uid, severity: a.data.severity, title: a.data.title, body: a.data.message ?? null, source: ev.source, link: a.data.link ?? '/executivo' });
      // Alertas críticos também vão por push (mesma fila dos lembretes).
      if (a.data.severity === 'critical') await db.from('reminders').insert({ user_id: uid, entity_type: 'custom', title: `⚠ ${a.data.title}`, body: a.data.message ?? null, remind_at: new Date().toISOString() });
    }
  }

  if (ev.event_type === 'project.metrics.snapshot' && ev.project_id) {
    const m = MetricsPayload.safeParse(ev.payload);
    const projects = (await db.from('connected_projects').select('id,name,template').eq('user_id', uid)).data ?? [];
    const proj = projects.find((x: { id: string; template: string }) => x.id === ev.project_id || x.template === ev.project_id);
    if (m.success && proj) await db.from('project_snapshots').insert({ user_id: uid, project_id: proj.id, capability: m.data.capability, data: m.data.data, source: `${proj.name} via n8n`, fetched_at: ev.occurred_at });
  }
  return { duplicate: false };
}
