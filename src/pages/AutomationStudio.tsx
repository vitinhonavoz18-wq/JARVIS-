import { useMemo, useState } from 'react';
import { Workflow, Plug, RefreshCw, Play, Plus, Star, Sparkles, AlertTriangle, CheckCircle2, Clock, XCircle, KeyRound, Ban, Inbox, Copy } from 'lucide-react';
import type { Automation, AutomationConnection, AutomationRun, AutomationWorkflow, Risk } from '@/core/types.ts';
import { RISK_LABEL, requiresConfirmation } from '@/core/connectors/types.ts';
import { RUN_STATUS_LABEL, validateInput } from '@/core/integration/services.ts';
import { buildWorkflowDraft } from '@/core/integration/workflowBuilder.ts';
import { formatRelativeDay, formatTimeSpoken } from '@/core/time.ts';
import { useApp, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useNow } from '@/lib/hooks.ts';
import { gateway } from '@/lib/integrationServices.ts';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Segmented, Select, Switch, Textarea } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';

const STATUS_TONE: Record<AutomationRun['status'], 'success' | 'danger' | 'warn' | 'cyan' | 'default'> = {
  succeeded: 'success', failed: 'danger', timeout: 'warn', cancelled: 'default', queued: 'default', requested: 'cyan', started: 'cyan', running: 'cyan',
};
const CONN_LABEL: Record<AutomationConnection['status'], { label: string; tone: 'success' | 'danger' | 'warn' | 'default' }> = {
  connected: { label: 'Conectado', tone: 'success' }, disconnected: { label: 'Desconectado', tone: 'default' }, unauthorized: { label: 'Sem autorização', tone: 'danger' },
  unavailable: { label: 'Indisponível', tone: 'warn' }, misconfigured: { label: 'Erro de configuração', tone: 'danger' },
};
const riskTone = (r: Risk) => (r === 'read' ? 'success' : r === 'reversible' ? 'cyan' : r === 'destructive' ? 'danger' : 'warn');

export default function AutomationStudio() {
  const app = useApp();
  const { toast } = useJarvis();
  const now = useNow(30_000);
  const cloud = app.mode === 'cloud';
  const conns = useRows('automation_connections', { order: [{ field: 'name' }] });
  const workflows = useRows('automation_workflows', { order: [{ field: 'name' }] });
  const autos = useRows('automations', { order: [{ field: 'name' }] });
  const runs = useRows('automation_runs', { order: [{ field: 'requested_at', asc: false }], limit: 100 });
  const events = useRows('integration_events', { order: [{ field: 'received_at', asc: false }], limit: 20 });
  const projects = useRows('connected_projects', { order: [{ field: 'name' }] });
  const [connDialog, setConnDialog] = useState<AutomationConnection | 'new' | null>(null);
  const [autoDialog, setAutoDialog] = useState<{ auto?: Automation; prefill?: Partial<Automation> } | null>(null);
  const [runDialog, setRunDialog] = useState<Automation | null>(null);
  const [creator, setCreator] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed' | 'active' | 'succeeded'>('all');
  const [projectFilter, setProjectFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const since = now.getTime() - 24 * 3600_000;
  const recent = (runs.data ?? []).filter((r) => new Date(r.requested_at).getTime() >= since);
  const stats = {
    autos: autos.data?.filter((a) => a.enabled).length ?? 0,
    recent: recent.length,
    failed: recent.filter((r) => r.status === 'failed' || r.status === 'timeout').length,
    active: (runs.data ?? []).filter((r) => ['queued', 'requested', 'started', 'running'].includes(r.status)).length,
  };
  const autoName = (id: string) => autos.data?.find((a) => a.id === id)?.name ?? 'Automação';
  const filteredRuns = useMemo(() => (runs.data ?? []).filter((r) => {
    if (projectFilter && autos.data?.find((a) => a.id === r.automation_id)?.project_id !== projectFilter) return false;
    if (filter === 'failed') return r.status === 'failed' || r.status === 'timeout';
    if (filter === 'active') return ['queued', 'requested', 'started', 'running'].includes(r.status);
    if (filter === 'succeeded') return r.status === 'succeeded';
    return true;
  }), [runs.data, filter, projectFilter, autos.data]);

  const act = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try {
      const r = await gateway<Record<string, unknown>>(body);
      toast({ title: ok, body: (r.detail as string) ?? (r.message as string) ?? undefined, tone: r.ok === false ? 'error' : 'success' });
      return r;
    } catch (e) {
      toast({ title: 'Não foi possível concluir', body: e instanceof Error ? e.message : String(e), tone: 'error' });
      return null;
    } finally {
      setBusy(null);
      void (await import('@/lib/app.tsx')).queryClient.invalidateQueries();
    }
  };

  return (
    <div>
      <PageHeader
        title="Automation Studio"
        subtitle="Central de controle das automações do n8n: conexões, workflows, execuções e eventos."
        actions={<>
          <Button variant="outline" onClick={() => setCreator(true)}><Sparkles className="h-4 w-4" /> Criar automação com JARVIS</Button>
          <Button onClick={() => setConnDialog('new')} disabled={!cloud}><Plug className="h-4 w-4" /> Conectar n8n</Button>
        </>}
      />
      {!cloud && (
        <Card className="mb-5 border-warn/40 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-warn"><AlertTriangle className="h-4 w-4" /> Requer o Modo Nuvem</p>
          <p className="mt-1 text-muted">As credenciais do n8n ficam protegidas no servidor. Conecte o Supabase (docs/INSTALACAO.md) para cadastrar instâncias, executar automações e receber eventos. Nada aqui é simulado.</p>
        </Card>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { l: 'Automações autorizadas', v: stats.autos, i: Workflow },
          { l: 'Execuções (24h)', v: stats.recent, i: Clock },
          { l: 'Falhas (24h)', v: stats.failed, i: XCircle, tone: stats.failed ? 'text-danger' : '' },
          { l: 'Em andamento', v: stats.active, i: RefreshCw, tone: stats.active ? 'text-cyan' : '' },
        ].map((s) => (
          <Card key={s.l} className="p-4">
            <p className="label-tech flex items-center gap-1.5"><s.i className="h-3.5 w-3.5" /> {s.l}</p>
            <p className={cn('mt-1 font-display text-3xl font-semibold', s.tone)}>{s.v}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Conexões */}
        <Card>
          <CardHeader title="Instâncias n8n" icon={<Plug className="h-4 w-4" />} />
          <div className="space-y-2 px-5 pb-5">
            {!conns.data?.length && <EmptyState icon={<Plug className="h-5 w-5" />} title="Nenhuma instância conectada" text="Cadastre a URL do seu n8n e uma chave da API pública (Settings › n8n API)." />}
            {conns.data?.map((c) => (
              <div key={c.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{c.name}</p>
                  <Badge tone={CONN_LABEL[c.status].tone}>{CONN_LABEL[c.status].label}</Badge>
                  <Badge>{c.environment === 'production' ? 'produção' : 'desenvolvimento'}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted">{c.base_url}</p>
                {c.status_detail && <p className="mt-1 text-xs text-muted">{c.status_detail}</p>}
                <p className="mt-1 text-[11px] text-muted">Última sincronização: {c.last_sync_at ? `${formatRelativeDay(c.last_sync_at, now, app.prefs.timezone)} ${formatTimeSpoken(c.last_sync_at, app.prefs.timezone)}` : 'nunca'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" loading={busy === `t${c.id}`} onClick={() => act(`t${c.id}`, { action: 'test_connection', id: c.id }, 'Teste de conexão')}>Testar</Button>
                  <Button size="sm" variant="outline" loading={busy === `s${c.id}`} onClick={() => act(`s${c.id}`, { action: 'sync', id: c.id }, 'Workflows sincronizados')}><RefreshCw className="h-3.5 w-3.5" /> Sincronizar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConnDialog(c)}>Editar</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Automações executáveis */}
        <Card>
          <CardHeader title="Automações executáveis" icon={<Workflow className="h-4 w-4" />} action={<Button size="sm" variant="soft" disabled={!conns.data?.length} onClick={() => setAutoDialog({})}><Plus className="h-3.5 w-3.5" /> Registrar</Button>} />
          <div className="space-y-2 px-5 pb-5">
            {!autos.data?.length && <EmptyState icon={<Workflow className="h-5 w-5" />} title="Nenhuma automação registrada" text="Descobrir um workflow não o torna executável: registre explicitamente o webhook e os parâmetros permitidos." />}
            {autos.data?.map((a) => {
              const last = runs.data?.find((r) => r.automation_id === a.id);
              return (
                <div key={a.id} className={cn('rounded-xl border border-line p-3', !a.enabled && 'opacity-50')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => app.repo.table('automations').update(a.id, { is_shortcut: !a.is_shortcut })} aria-label={a.is_shortcut ? 'Remover atalho' : 'Criar atalho'} className="cursor-pointer"><Star className={cn('h-4 w-4', a.is_shortcut ? 'fill-warn text-warn' : 'text-muted')} /></button>
                    <p className="font-medium">{a.name}</p>
                    <Badge tone={riskTone(a.risk)}>{RISK_LABEL[a.risk]}</Badge>
                    <Badge>{a.mode === 'sync' ? 'síncrona' : 'assíncrona'}</Badge>
                    {a.project_id && <Badge tone="violet">{projects.data?.find((p) => p.id === a.project_id)?.name}</Badge>}
                  </div>
                  {a.description && <p className="mt-1 text-xs text-muted">{a.description}</p>}
                  <p className="mt-1 text-xs text-muted">{last ? `Última: ${RUN_STATUS_LABEL[last.status]} · ${formatRelativeDay(last.requested_at, now, app.prefs.timezone)} ${formatTimeSpoken(last.requested_at, app.prefs.timezone)}` : 'Nunca executada'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={!cloud || !a.enabled} onClick={() => setRunDialog(a)}><Play className="h-3.5 w-3.5" /> Executar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAutoDialog({ auto: a })}>Editar</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Workflows descobertos */}
        <Card className="xl:col-span-2">
          <CardHeader title="Workflows descobertos no n8n" icon={<RefreshCw className="h-4 w-4" />} subtitle="Somente leitura. Para executar pelo JARVIS, registre o webhook do workflow." />
          <div className="overflow-x-auto px-5 pb-5 scroll-thin">
            {!workflows.data?.length ? <p className="text-sm text-muted">Nenhum workflow sincronizado. Use “Sincronizar” em uma instância conectada.</p> : (
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="label-tech text-left"><th className="py-2">Nome</th><th>Status</th><th>Gatilhos</th><th>Última execução</th><th /></tr></thead>
                <tbody>
                  {workflows.data.map((w: AutomationWorkflow) => {
                    const registered = autos.data?.some((a) => a.workflow_n8n_id === w.n8n_id && a.connection_id === w.connection_id);
                    const conn = conns.data?.find((c) => c.id === w.connection_id);
                    return (
                      <tr key={w.id} className="border-t border-line">
                        <td className="py-2 pr-3"><p>{w.name}</p><p className="text-[11px] text-muted">{w.tags.map((t) => `#${t}`).join(' ')}</p></td>
                        <td><Badge tone={w.active ? 'success' : 'default'}>{w.active ? 'ativo' : 'inativo'}</Badge></td>
                        <td className="text-xs text-muted">{w.triggers.join(', ') || '—'}</td>
                        <td className="text-xs">{w.last_execution_status ? <span className={w.last_execution_status === 'error' ? 'text-danger' : 'text-muted'}>{w.last_execution_status} · {w.last_execution_at ? formatRelativeDay(w.last_execution_at, now, app.prefs.timezone) : ''}</span> : <span className="text-muted">—</span>}</td>
                        <td className="text-right">
                          {registered ? <Badge tone="cyan">registrado</Badge> : w.triggers.includes('webhook') && w.webhook_paths[0] ? (
                            <Button size="sm" variant="soft" onClick={() => setAutoDialog({ prefill: { name: w.name, connection_id: w.connection_id, workflow_n8n_id: w.n8n_id, webhook_url: `${conn?.base_url}/webhook/${w.webhook_paths[0]}`, description: w.description } })}>Registrar</Button>
                          ) : <span className="text-[11px] text-muted">sem webhook</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Execuções */}
        <Card className="xl:col-span-2">
          <CardHeader title="Histórico de execuções" icon={<Clock className="h-4 w-4" />} />
          <div className="px-5 pb-5">
            <div className="mb-3 flex flex-wrap gap-2">
              <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Todas' }, { value: 'active', label: 'Em andamento' }, { value: 'succeeded', label: 'Concluídas' }, { value: 'failed', label: 'Falhas' }]} />
              {Boolean(projects.data?.length) && <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-auto" aria-label="Projeto"><option value="">Todos os projetos</option>{projects.data!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
            </div>
            {!filteredRuns.length ? <p className="text-sm text-muted">Nenhuma execução neste filtro.</p> : (
              <ul className="space-y-2">
                {filteredRuns.slice(0, 40).map((r) => (
                  <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.status === 'succeeded' ? <CheckCircle2 className="h-4 w-4 text-success" /> : r.status === 'failed' || r.status === 'timeout' ? <XCircle className="h-4 w-4 text-danger" /> : <RefreshCw className="h-4 w-4 animate-spin text-cyan" />}
                      <span className="font-medium">{autoName(r.automation_id)}</span>
                      <Badge tone={STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
                      <span className="text-xs text-muted">{formatRelativeDay(r.requested_at, now, app.prefs.timezone)} {formatTimeSpoken(r.requested_at, app.prefs.timezone)} · origem: {r.source}</span>
                      <span className="ml-auto flex gap-1">
                        {['started', 'running', 'requested'].includes(r.status) && cloud && <Button size="sm" variant="ghost" onClick={() => act(`r${r.id}`, { action: 'refresh_run', run_id: r.id }, 'Status atualizado')}>Atualizar</Button>}
                        {['queued', 'started', 'running'].includes(r.status) && cloud && <Button size="sm" variant="ghost" onClick={() => window.confirm('Interromper esta execução?') && act(`c${r.id}`, { action: 'cancel_run', run_id: r.id }, 'Interrupção solicitada')}><Ban className="h-3.5 w-3.5" /> Interromper</Button>}
                      </span>
                    </div>
                    {r.output_summary && <p className="mt-1 text-xs">{r.output_summary}</p>}
                    {r.error && <p className="mt-1 text-xs text-danger">{r.error}</p>}
                    {Object.keys(r.input ?? {}).length > 0 && <p className="mt-1 font-mono text-[11px] text-muted">entrada: {JSON.stringify(r.input).slice(0, 200)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Eventos */}
        <Card className="xl:col-span-2">
          <CardHeader title="Eventos recebidos do n8n" icon={<Inbox className="h-4 w-4" />} subtitle="Assinados com HMAC, sem duplicidade (contrato JarvisEvent v1.0)." />
          <div className="px-5 pb-5">
            {!events.data?.length ? <p className="text-sm text-muted">Nenhum evento recebido ainda.</p> : (
              <ul className="space-y-1 text-sm">
                {events.data.map((e) => <li key={e.id} className="flex flex-wrap gap-2"><Badge tone="cyan">{e.event_type}</Badge><span className="text-muted">{e.source}{e.project_ref ? ` · ${e.project_ref}` : ''}</span><span className="ml-auto text-xs text-muted">{formatRelativeDay(e.received_at, now, app.prefs.timezone)} {formatTimeSpoken(e.received_at, app.prefs.timezone)}</span></li>)}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {connDialog && <ConnectionDialog conn={connDialog === 'new' ? null : connDialog} onClose={() => setConnDialog(null)} />}
      {autoDialog && <AutomationDialog init={autoDialog} conns={conns.data ?? []} projects={projects.data ?? []} onClose={() => setAutoDialog(null)} />}
      {runDialog && <RunDialog auto={runDialog} onClose={() => setRunDialog(null)} />}
      {creator && <CreatorDialog conns={conns.data ?? []} onClose={() => setCreator(false)} />}
    </div>
  );
}

function ConnectionDialog({ conn, onClose }: { conn: AutomationConnection | null; onClose: () => void }) {
  const { toast } = useJarvis();
  const [f, setF] = useState({ name: conn?.name ?? 'n8n Connectfly', base_url: conn?.base_url ?? 'https://', environment: conn?.environment ?? 'production', api_key: '', projects: conn?.authorized_projects.join(', ') ?? '' });
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const eventsUrl = `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/jarvis-events`;
  const save = async () => {
    setBusy(true);
    try {
      const r = await gateway<{ id: string; status: string; detail: string; events_secret: string | null }>({
        action: 'save_connection', id: conn?.id, name: f.name, base_url: f.base_url, environment: f.environment,
        ...(f.api_key ? { api_key: f.api_key } : {}), authorized_projects: f.projects.split(',').map((x) => x.trim()).filter(Boolean),
      });
      toast({ title: r.status === 'connected' ? 'n8n conectado' : 'Conexão salva, mas não verificada', body: r.detail, tone: r.status === 'connected' ? 'success' : 'error' });
      if (r.events_secret) setSecret({ id: r.id, value: r.events_secret });
      else onClose();
    } catch (e) {
      toast({ title: 'Erro', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={conn ? 'Editar instância n8n' : 'Conectar instância n8n'} description="A chave é enviada só ao servidor e guardada criptografada. Nunca volta para o aplicativo.">
      {secret ? (
        <div className="space-y-3 text-sm">
          <p className="text-warn">Copie agora — o segredo de eventos não será mostrado de novo. No n8n, crie a variável de ambiente <code>JARVIS_EVENTS_SECRET</code> com este valor.</p>
          {[['Segredo de eventos', secret.value], ['ID da conexão (X-Jarvis-Connection)', secret.id], ['URL de eventos', eventsUrl]].map(([l, v]) => (
            <div key={l}><p className="text-xs text-muted">{l}</p><div className="flex gap-2"><code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-void/60 px-3 py-2 text-xs">{v}</code><Button size="icon" variant="outline" aria-label={`Copiar ${l}`} onClick={() => navigator.clipboard.writeText(v)}><Copy className="h-4 w-4" /></Button></div></div>
          ))}
          <div className="flex justify-end"><Button onClick={onClose}>Concluir</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="URL base da instância (HTTPS)"><Input value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder="https://n8n.seudominio.com" /></Field>
          <Field label="Ambiente"><Select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as 'production' | 'development' })}><option value="production">Produção</option><option value="development">Desenvolvimento</option></Select></Field>
          <Field label={conn ? 'Nova chave da API (deixe vazio para manter)' : 'Chave da API pública do n8n'} hint="No n8n: Settings › n8n API › Create an API key. Prefira escopos de leitura de workflows e execuções."><Input type="password" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} autoComplete="off" /></Field>
          <Field label="Projetos autorizados do n8n (IDs, opcional)" hint="Se preenchido, só workflows desses projetos são descobertos."><Input value={f.projects} onChange={(e) => setF({ ...f, projects: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={save} loading={busy} disabled={!/^https:\/\/.+/.test(f.base_url) || (!conn && f.api_key.length < 10)}>Salvar e testar</Button></div>
        </div>
      )}
    </Dialog>
  );
}

function AutomationDialog({ init, conns, projects, onClose }: { init: { auto?: Automation; prefill?: Partial<Automation> }; conns: AutomationConnection[]; projects: { id: string; name: string }[]; onClose: () => void }) {
  const app = useApp();
  const { toast } = useJarvis();
  const a = { ...init.prefill, ...init.auto };
  const [f, setF] = useState({
    name: a.name ?? '', description: a.description ?? '', aliases: (a.aliases ?? []).join(', '), connection_id: a.connection_id ?? conns[0]?.id ?? '', project_id: a.project_id ?? '',
    category: a.category ?? '', webhook_url: a.webhook_url ?? '', auth_header_name: a.auth_header_name ?? '', auth_value: '', risk: (a.risk ?? 'external') as Risk,
    requires_confirmation: a.requires_confirmation ?? true, mode: a.mode ?? 'async', timeout_seconds: a.timeout_seconds ?? 900, enabled: a.enabled ?? true, alert_on_failure: a.alert_on_failure ?? true,
    input_schema: JSON.stringify(a.input_schema ?? { type: 'object', properties: {} }, null, 2),
  });
  const save = async () => {
    let schema;
    try {
      schema = JSON.parse(f.input_schema);
      if (schema.type !== 'object') throw new Error('o esquema deve ser do tipo object');
    } catch (e) {
      return toast({ title: 'Esquema de entrada inválido', body: String(e instanceof Error ? e.message : e), tone: 'error' });
    }
    const row = {
      name: f.name.trim(), description: f.description || null, aliases: f.aliases.split(',').map((x) => x.trim()).filter(Boolean), connection_id: f.connection_id,
      project_id: f.project_id || null, category: f.category || null, webhook_url: f.webhook_url.trim(), auth_header_name: f.auth_header_name || null, risk: f.risk,
      requires_confirmation: f.requires_confirmation || requiresConfirmation(f.risk), mode: f.mode as 'async' | 'sync', timeout_seconds: Number(f.timeout_seconds),
      enabled: f.enabled, alert_on_failure: f.alert_on_failure, input_schema: schema, workflow_n8n_id: a.workflow_n8n_id ?? null,
    };
    try {
      const saved = init.auto ? await app.repo.table('automations').update(init.auto.id, row) : await app.repo.table('automations').insert(row);
      if (f.auth_value) await gateway({ action: 'set_automation_secret', automation_id: saved.id, value: f.auth_value });
      toast({ title: 'Automação registrada', tone: 'success' });
      onClose();
    } catch (e) {
      toast({ title: 'Não foi possível salvar', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={init.auto ? 'Editar automação' : 'Registrar automação executável'} description="Só automações registradas aqui podem ser executadas pelo JARVIS." wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Outros nomes (para comandos de voz)"><Input value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} placeholder="vendas, relatório semanal" /></Field>
        <div className="sm:col-span-2"><Field label="URL do webhook de produção (HTTPS)"><Input value={f.webhook_url} onChange={(e) => setF({ ...f, webhook_url: e.target.value })} /></Field></div>
        <Field label="Instância"><Select value={f.connection_id} onChange={(e) => setF({ ...f, connection_id: e.target.value })}>{conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Projeto"><Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Nenhum</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Nível de risco"><Select value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value as Risk })}>{(Object.keys(RISK_LABEL) as Risk[]).map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}</Select></Field>
        <Field label="Modo"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'async' | 'sync' })}><option value="async">Assíncrono (retorno por evento)</option><option value="sync">Síncrono (responde com o resultado)</option></Select></Field>
        <Field label="Capacidade fornecida (opcional)" hint="Ex.: metrics.summary — usada pela Central Executiva."><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Prazo para concluir (segundos)"><Input type="number" min={10} max={86400} value={f.timeout_seconds} onChange={(e) => setF({ ...f, timeout_seconds: Number(e.target.value) })} /></Field>
        <Field label="Cabeçalho de autenticação do webhook (Header Auth)"><Input value={f.auth_header_name} onChange={(e) => setF({ ...f, auth_header_name: e.target.value })} placeholder="X-Webhook-Token" /></Field>
        <Field label="Valor do cabeçalho (guardado criptografado)"><Input type="password" value={f.auth_value} onChange={(e) => setF({ ...f, auth_value: e.target.value })} placeholder={init.auto ? 'deixe vazio para manter' : ''} /></Field>
        <div className="sm:col-span-2"><Field label="Descrição"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Parâmetros permitidos (JSON Schema)" hint={'Ex.: {"type":"object","properties":{"periodo":{"type":"string","enum":["semana","mes"]}},"required":["periodo"]}'}><Textarea rows={5} className="font-mono text-xs" value={f.input_schema} onChange={(e) => setF({ ...f, input_schema: e.target.value })} /></Field></div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={f.requires_confirmation || requiresConfirmation(f.risk)} disabled={requiresConfirmation(f.risk)} onCheckedChange={(v) => setF({ ...f, requires_confirmation: v })} label="Exigir confirmação" /> Exigir confirmação antes de executar</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={f.alert_on_failure} onCheckedChange={(v) => setF({ ...f, alert_on_failure: v })} label="Alertar em falhas" /> Alertar em falhas</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} label="Ativa" /> Ativa</label>
      </div>
      <div className="mt-4 flex justify-end"><Button onClick={save} disabled={!f.name.trim() || !/^https:\/\//.test(f.webhook_url) || !f.connection_id}>Salvar</Button></div>
    </Dialog>
  );
}

function RunDialog({ auto, onClose }: { auto: Automation; onClose: () => void }) {
  const { toast } = useJarvis();
  const props = Object.entries(auto.input_schema.properties ?? {});
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const input = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => [k, auto.input_schema.properties[k]?.type === 'number' || auto.input_schema.properties[k]?.type === 'integer' ? Number(v) : v]));
  const errors = validateInput(auto.input_schema, input);
  const run = async () => {
    setBusy(true);
    try {
      const r = await gateway<{ ok: boolean; run?: AutomationRun; message: string }>({ action: 'run', automation_id: auto.id, input, source: 'manual', idempotency_key: crypto.randomUUID() });
      toast({ title: r.run ? `${auto.name}: ${RUN_STATUS_LABEL[r.run.status]}` : 'Falha', body: r.run?.error ?? r.run?.output_summary ?? (r.ok ? undefined : r.message), tone: r.run?.status === 'failed' || !r.ok ? 'error' : 'success' });
      onClose();
    } catch (e) {
      toast({ title: 'Erro', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
      void (await import('@/lib/app.tsx')).queryClient.invalidateQueries();
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Executar: ${auto.name}`} description={`${RISK_LABEL[auto.risk]} · ${auto.mode === 'sync' ? 'resultado imediato' : 'o resultado chega quando o n8n terminar'}`}>
      <div className="space-y-3">
        {props.length ? props.map(([k, p]) => (
          <Field key={k} label={`${k}${auto.input_schema.required?.includes(k) ? ' *' : ''}`} hint={p.description}>
            {p.enum ? <Select value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })}><option value="">—</option>{p.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</Select>
              : <Input value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} type={p.type === 'number' || p.type === 'integer' ? 'number' : 'text'} />}
          </Field>
        )) : <p className="text-sm text-muted">Esta automação não recebe parâmetros.</p>}
        {errors.length > 0 && Object.keys(values).length > 0 && <p className="text-xs text-danger">{errors.join('; ')}</p>}
        {(auto.requires_confirmation || requiresConfirmation(auto.risk)) && <p className="rounded-lg border border-warn/40 bg-warn/5 p-2 text-xs text-warn">Ao confirmar, a automação será disparada no n8n ({RISK_LABEL[auto.risk].toLowerCase()}).</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={run} loading={busy} disabled={errors.length > 0}>Confirmar e executar</Button></div>
      </div>
    </Dialog>
  );
}

const TEMPLATES = [
  'Toda segunda-feira às 8h prepare um relatório das vendas da semana anterior',
  'Todos os dias às 7h30 verifique integrações com erro e me avise',
  'Toda sexta às 17h envie o resumo de leads da semana para revisão',
];

function CreatorDialog({ conns, onClose }: { conns: AutomationConnection[]; onClose: () => void }) {
  const app = useApp();
  const { toast } = useJarvis();
  const [goal, setGoal] = useState('');
  const [conn, setConn] = useState(conns.find((c) => c.environment === 'development')?.id ?? conns[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const draft = goal.trim().length >= 10 ? buildWorkflowDraft(goal, { now: new Date(), tz: app.prefs.timezone }, 'https://SEU-PROJETO.supabase.co/functions/v1/jarvis-events', conn || 'CONEXAO') : null;
  const create = async () => {
    setBusy(true);
    try {
      const r = await gateway<{ ok?: boolean; workflowId?: string; message?: string }>({ action: 'draft_workflow', connection_id: conn, goal, tz: app.prefs.timezone, create: true });
      toast({ title: r.ok ? 'Rascunho criado INATIVO no n8n' : 'Não foi possível criar', body: r.ok ? 'Configure a fonte de dados no n8n, teste e só então ative.' : r.message, tone: r.ok ? 'success' : 'error' });
      if (r.ok) onClose();
    } catch (e) {
      toast({ title: 'Erro', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Criar automação com JARVIS" description="Descreva o objetivo. O JARVIS propõe gatilho e etapas; o workflow é criado INATIVO e só vai para produção com sua aprovação no n8n." wide>
      <Textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex.: toda segunda-feira às 8h prepare um relatório das vendas da semana anterior" />
      <div className="mt-2 flex flex-wrap gap-1.5">{TEMPLATES.map((t) => <button key={t} onClick={() => setGoal(t)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-cyan cursor-pointer">{t}</button>)}</div>
      {draft && (
        <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan/5 p-3 text-sm">
          <p className="font-medium">{draft.name}</p>
          <ul className="mt-2 space-y-1">{draft.summary.map((s) => <li key={s}>› {s}</li>)}</ul>
          <p className="mt-2 text-xs text-muted">Etapas: {(draft.workflow.nodes as { name: string }[]).map((n) => n.name).join(' → ')}</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        {conns.length ? <Select value={conn} onChange={(e) => setConn(e.target.value)} className="w-auto" aria-label="Instância">{conns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.environment === 'development' ? 'dev' : 'produção'})</option>)}</Select> : <span className="text-xs text-muted">Conecte uma instância n8n para criar o rascunho.</span>}
        <Button onClick={create} loading={busy} disabled={!draft || !conn || app.mode !== 'cloud'}><KeyRound className="h-4 w-4" /> Criar rascunho inativo</Button>
      </div>
    </Dialog>
  );
}
