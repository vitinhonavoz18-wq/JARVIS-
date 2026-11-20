import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Radar, Bell, Target, Wallet, Zap, Plus, RefreshCw, Sparkles, Check, ShieldCheck, Activity, Settings2 } from 'lucide-react';
import type { ConnectedProject, ProjectTemplateId } from '@/core/types.ts';
import { PROJECT_TEMPLATES } from '@/core/connectors/templates.ts';
import { buildBusinessBriefing, buildRadar } from '@/core/agent/businessTools.ts';
import { formatRelativeDay, formatTimeSpoken, localDateKey, localDateOf } from '@/core/time.ts';
import { useApp, useDerived, useRows, queryClient } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useNow } from '@/lib/hooks.ts';
import { gateway } from '@/lib/integrationServices.ts';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';

const P_STATUS: Record<ConnectedProject['status'], { label: string; tone: 'success' | 'warn' | 'danger' | 'default' }> = {
  not_configured: { label: 'não configurado', tone: 'default' }, healthy: { label: 'operacional', tone: 'success' }, degraded: { label: 'instável', tone: 'warn' },
  down: { label: 'fora do ar', tone: 'danger' }, unauthorized: { label: 'sem autorização', tone: 'danger' },
};
const SEV = { critical: 'border-danger/40 text-danger', warning: 'border-warn/40 text-warn', info: 'border-line text-muted' };
const parseAmount = (s: string) => Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Executive() {
  const app = useApp();
  const { send, toast } = useJarvis();
  const now = useNow(60_000);
  const tz = app.prefs.timezone;
  const cloud = app.mode === 'cloud';
  const projects = useRows('connected_projects', { order: [{ field: 'name' }] });
  const snaps = useRows('project_snapshots', { order: [{ field: 'fetched_at', asc: false }], limit: 200 });
  const alerts = useRows('alerts', { order: [{ field: 'created_at', asc: false }], limit: 30 });
  const goals = useRows('goals', { eq: { status: 'active' }, order: [{ field: 'due_date' }] });
  const monthStart = `${localDateKey(localDateOf(now, tz)).slice(0, 7)}-01`;
  const expenses = useRows('expenses', { gte: { spent_on: monthStart }, order: [{ field: 'spent_on', asc: false }] });
  const shortcuts = useRows('automations', { eq: { is_shortcut: true, enabled: true } });
  const brief = useDerived(['exec-brief', app.version, Math.floor(now.getTime() / 300000)], () => buildBusinessBriefing(app.toolCtx()));
  const radar = useDerived(['radar', app.version, Math.floor(now.getTime() / 300000)], () => buildRadar(app.toolCtx()));
  const [projDialog, setProjDialog] = useState<ConnectedProject | 'new' | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, body: Record<string, unknown>, title: string) => {
    setBusy(key);
    try {
      const r = await gateway<{ ok?: boolean; status?: string; detail?: string; error?: string; source?: string }>(body);
      toast({ title, body: r.detail ?? r.error ?? (r.ok ? `Fonte: ${r.source}` : undefined), tone: r.ok === false || r.status === 'down' ? 'error' : 'success' });
    } catch (e) {
      toast({ title: 'Não foi possível concluir', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries();
    }
  };
  const total = (expenses.data ?? []).reduce((a, e) => a + Number(e.amount), 0);
  const unread = (alerts.data ?? []).filter((a) => !a.read_at);

  return (
    <div>
      <PageHeader
        title="Executive Command Center"
        subtitle="Visão consolidada das empresas e projetos. Cada número mostra a fonte e o horário."
        actions={<>
          <Button variant="outline" onClick={() => send('faça meu briefing empresarial')}><Sparkles className="h-4 w-4" /> Briefing por voz/chat</Button>
          <Button onClick={() => setProjDialog('new')}><Plus className="h-4 w-4" /> Conectar projeto</Button>
        </>}
      />

      {/* Resumo operacional */}
      <Card className="mb-4 p-5">
        <p className="label-tech mb-2 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Resumo operacional</p>
        {brief.isLoading ? <Spinner /> : <ul className="space-y-1 text-sm">{brief.data?.lines.map((l, i) => <li key={i}>• {l}</li>)}</ul>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Projetos */}
        <div className="space-y-4 xl:col-span-2">
          {!projects.data?.length ? (
            <Card><EmptyState icon={<Building2 className="h-5 w-5" />} title="Nenhuma empresa conectada" text="Conecte Connectfly, FlyDelivery, Farmácia Preço Bom, TG Baterias ou SiteCreatorFly. Sem conexão, o JARVIS mostra o dado como indisponível — nunca inventa números." action={<Button variant="soft" onClick={() => setProjDialog('new')}><Plus className="h-4 w-4" /> Conectar projeto</Button>} /></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {projects.data.map((p) => {
                const snap = snaps.data?.find((s) => s.project_id === p.id && s.capability === 'metrics.summary') ?? snaps.data?.find((s) => s.project_id === p.id);
                return (
                  <Card key={p.id} interactive className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                        <p className="text-xs text-muted">{p.connector_type === 'none' ? 'sem conector' : p.connector_type === 'http' ? 'API (Connector Protocol)' : 'via n8n'} · {p.privacy_level === 'aggregated' ? 'dados agregados' : 'dados detalhados'}</p>
                      </div>
                      <Badge tone={P_STATUS[p.status].tone}>{P_STATUS[p.status].label}</Badge>
                    </div>
                    {snap ? (
                      <div className="mt-3 rounded-xl border border-line bg-void/40 p-3">
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                          {Object.entries(snap.data).slice(0, 6).map(([k, v]) => <div key={k} className="contents"><dt className="truncate text-muted">{k.replace(/_/g, ' ')}</dt><dd className="truncate text-right font-medium">{typeof v === 'object' ? JSON.stringify(v).slice(0, 30) : String(v)}</dd></div>)}
                        </dl>
                        <p className="mt-2 text-[11px] text-muted">Fonte: {snap.source} · {formatRelativeDay(snap.fetched_at, now, tz)} {formatTimeSpoken(snap.fetched_at, tz)}</p>
                      </div>
                    ) : <p className="mt-3 text-sm text-muted">Indicadores indisponíveis — nenhum dado recebido ainda.</p>}
                    {p.status_detail && <p className="mt-2 text-xs text-muted">{p.status_detail}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={!cloud || p.connector_type === 'none'} loading={busy === `h${p.id}`} onClick={() => act(`h${p.id}`, { action: 'project_health', project_id: p.id }, `${p.name}: verificação`)}><ShieldCheck className="h-3.5 w-3.5" /> Verificar</Button>
                      <Button size="sm" variant="outline" disabled={!cloud || p.connector_type === 'none'} loading={busy === `m${p.id}`} onClick={() => act(`m${p.id}`, { action: 'project_action', project_id: p.id, capability: 'metrics.summary' }, `${p.name}: indicadores`)}><RefreshCw className="h-3.5 w-3.5" /> Atualizar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setProjDialog(p)}><Settings2 className="h-3.5 w-3.5" /> Configurar</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Radar */}
          <Card>
            <CardHeader title="Radar de pendências" icon={<Radar className="h-4 w-4" />} subtitle="Tarefas atrasadas, prioridades, alertas, falhas de automação, projetos fora do ar e metas em risco." />
            <div className="px-5 pb-5">
              {radar.isLoading ? <Spinner /> : !radar.data?.length ? <p className="text-sm text-muted">Radar limpo: nada crítico nos seus registros.</p> : (
                <ul className="space-y-2">
                  {radar.data.slice(0, 12).map((r, i) => (
                    <li key={i}><Link to={r.link} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2 text-sm hover:bg-white/[0.02]', SEV[r.severity])}>
                      <span className="flex-1 text-ink">{r.title}</span><span className="text-xs">{r.detail}</span>
                    </Link></li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Ações rápidas */}
          <Card>
            <CardHeader title="Ações rápidas" icon={<Zap className="h-4 w-4" />} />
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              {shortcuts.data?.map((a) => <Button key={a.id} size="sm" variant="soft" disabled={!cloud} onClick={() => send(`execute a automação ${a.name}`)}>{a.name}</Button>)}
              <Button size="sm" variant="outline" onClick={() => send('relatório semanal')}>Relatório semanal</Button>
              <Button size="sm" variant="outline" onClick={() => send('organize meu dia')}>Organizar meu dia</Button>
              <Link to="/automacoes" className="text-xs text-cyan self-center hover:underline">Automation Studio →</Link>
            </div>
          </Card>

          {/* Alertas */}
          <Card>
            <CardHeader title={`Alertas${unread.length ? ` (${unread.length})` : ''}`} icon={<Bell className="h-4 w-4" />} action={unread.length > 0 && <Button size="sm" variant="ghost" onClick={async () => { for (const a of unread) await app.repo.table('alerts').update(a.id, { read_at: new Date().toISOString() }); }}>Marcar lidos</Button>} />
            <div className="space-y-2 px-5 pb-5">
              {!alerts.data?.length ? <p className="text-sm text-muted">Nenhum alerta.</p> : alerts.data.slice(0, 8).map((a) => (
                <div key={a.id} className={cn('rounded-xl border px-3 py-2 text-sm', SEV[a.severity], a.read_at && 'opacity-50')}>
                  <p className="text-ink">{a.title}</p>
                  {a.body && <p className="text-xs">{a.body}</p>}
                  <p className="mt-0.5 text-[11px] text-muted">{a.source} · {formatRelativeDay(a.created_at, now, tz)} {formatTimeSpoken(a.created_at, tz)}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Metas */}
          <Card>
            <CardHeader title="Metas" icon={<Target className="h-4 w-4" />} action={<Button size="sm" variant="ghost" onClick={() => setGoalOpen(true)}><Plus className="h-3.5 w-3.5" /></Button>} />
            <div className="space-y-3 px-5 pb-5">
              {!goals.data?.length ? <p className="text-sm text-muted">Nenhuma meta ativa.</p> : goals.data.map((g) => {
                const pct = g.target ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
                return (
                  <div key={g.id}>
                    <div className="flex justify-between text-sm"><span>{g.title}</span><span className="text-muted">{g.current}{g.target ? `/${g.target}` : ''} {g.unit ?? ''}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-graphite"><div className="h-full rounded-full bg-gradient-to-r from-violet to-cyan" style={{ width: `${pct}%` }} /></div>
                    <div className="mt-1 flex items-center gap-2">
                      {g.due_date && <span className="text-[11px] text-muted">prazo {g.due_date.split('-').reverse().join('/')}</span>}
                      <input type="number" aria-label={`Progresso de ${g.title}`} defaultValue={g.current} onBlur={(e) => Number(e.target.value) !== g.current && app.repo.table('goals').update(g.id, { current: Number(e.target.value), ...(g.target && Number(e.target.value) >= g.target ? { status: 'achieved' } : {}) })} className="ml-auto w-20 rounded-lg border border-line bg-void/60 px-2 py-0.5 text-right text-xs" />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Despesas */}
          <Card>
            <CardHeader title="Despesas do mês" icon={<Wallet className="h-4 w-4" />} subtitle={brl(total)} action={<Button size="sm" variant="ghost" onClick={() => setExpOpen(true)}><Plus className="h-3.5 w-3.5" /></Button>} />
            <ul className="space-y-1 px-5 pb-5 text-sm">
              {!expenses.data?.length ? <li className="text-muted">Nenhuma despesa registrada neste mês.</li> : expenses.data.slice(0, 8).map((e) => (
                <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{e.description ?? e.category}{e.project_label ? ` · ${e.project_label}` : ''}</span><span className="shrink-0 text-muted">{brl(Number(e.amount))}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {projDialog && <ProjectDialog project={projDialog === 'new' ? null : projDialog} onClose={() => setProjDialog(null)} />}
      {goalOpen && <GoalDialog onClose={() => setGoalOpen(false)} />}
      {expOpen && <ExpenseDialog onClose={() => setExpOpen(false)} />}
    </div>
  );
}

function ProjectDialog({ project, onClose }: { project: ConnectedProject | null; onClose: () => void }) {
  const app = useApp();
  const { toast } = useJarvis();
  const conns = useRows('automation_connections');
  const [f, setF] = useState({
    template: (project?.template ?? 'flydelivery') as ProjectTemplateId, name: project?.name ?? 'FlyDelivery', connector_type: project?.connector_type ?? 'none',
    base_url: project?.base_url ?? '', connection_id: project?.connection_id ?? '', privacy_level: project?.privacy_level ?? 'aggregated',
    scopes: (project?.scopes ?? ['metrics:read', 'alerts:read']).join(', '), token: '',
  });
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === f.template)!;
  const save = async () => {
    const row = {
      template: f.template, name: f.name.trim(), connector_type: f.connector_type as ConnectedProject['connector_type'], base_url: f.connector_type === 'http' ? f.base_url.trim() || null : null,
      connection_id: f.connector_type === 'n8n' ? f.connection_id || null : null, privacy_level: f.privacy_level as 'aggregated' | 'detailed',
      scopes: f.scopes.split(',').map((x) => x.trim()).filter(Boolean),
    };
    try {
      const saved = project ? await app.repo.table('connected_projects').update(project.id, row) : await app.repo.table('connected_projects').insert(row);
      if (f.token && app.mode === 'cloud') await gateway({ action: 'set_project_token', project_id: saved.id, token: f.token });
      else if (app.mode === 'cloud' && row.connector_type !== 'none') await gateway({ action: 'project_health', project_id: saved.id }).catch(() => null);
      toast({ title: 'Projeto salvo', tone: 'success' });
      onClose();
    } catch (e) {
      toast({ title: 'Não foi possível salvar', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={project ? `Configurar ${project.name}` : 'Conectar projeto'} description="Cada projeto expõe só o necessário. Credenciais ficam criptografadas no servidor." wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Modelo"><Select value={f.template} onChange={(e) => { const t = PROJECT_TEMPLATES.find((x) => x.id === e.target.value)!; setF({ ...f, template: t.id, name: project ? f.name : t.name }); }}>{PROJECT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="sm:col-span-2 rounded-xl border border-line bg-void/40 p-3 text-xs text-muted">
          <p>{tpl.description}</p>
          <p className="mt-1 text-success">Privacidade: {tpl.privacyNote}</p>
          <p className="mt-1">Capacidades sugeridas: {tpl.suggestedCapabilities.map((c) => `${c.id} (${c.risk === 'read' ? 'leitura' : c.risk})`).join(', ')}</p>
        </div>
        <Field label="Tipo de conector">
          <Select value={f.connector_type} onChange={(e) => setF({ ...f, connector_type: e.target.value as ConnectedProject['connector_type'] })}>
            <option value="none">Nenhum ainda (só eventos do n8n)</option>
            <option value="http">API do projeto (Jarvis Connector Protocol)</option>
            <option value="n8n">Via automações síncronas do n8n</option>
          </Select>
        </Field>
        <Field label="Privacidade"><Select value={f.privacy_level} onChange={(e) => setF({ ...f, privacy_level: e.target.value as 'aggregated' | 'detailed' })}><option value="aggregated">Somente dados agregados (recomendado)</option><option value="detailed">Permitir registros individuais</option></Select></Field>
        {f.connector_type === 'http' && <>
          <Field label="URL base da API (HTTPS)" hint="O projeto deve expor /jarvis/health, /jarvis/capabilities e /jarvis/actions/{id}. Veja docs/CONNECTOR-PROTOCOL.md."><Input value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder="https://api.flydelivery.app" /></Field>
          <Field label="Token do projeto"><Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} placeholder={project ? 'deixe vazio para manter' : ''} /></Field>
        </>}
        {f.connector_type === 'n8n' && <Field label="Instância n8n"><Select value={f.connection_id} onChange={(e) => setF({ ...f, connection_id: e.target.value })}><option value="">—</option>{conns.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Escopos autorizados" hint="Ex.: metrics:read, alerts:read, stock:read, tasks:read"><Input value={f.scopes} onChange={(e) => setF({ ...f, scopes: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex justify-between">
        {project ? <Button variant="danger" onClick={async () => { if (window.confirm(`Desconectar ${project.name}? Os dados de origem não são afetados.`)) { await app.repo.table('connected_projects').remove(project.id); onClose(); } }}>Desconectar</Button> : <span />}
        <Button onClick={save} disabled={!f.name.trim() || (f.connector_type === 'http' && !/^https:\/\//.test(f.base_url))}><Check className="h-4 w-4" /> Salvar</Button>
      </div>
    </Dialog>
  );
}

function GoalDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ title: '', target: '', unit: '', due_date: '', project_label: '' });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Nova meta">
      <div className="space-y-3">
        <Field label="Meta"><Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: 30 novas empresas no FlyDelivery" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Alvo"><Input type="number" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="Unidade"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="empresas, R$, %" /></Field>
          <Field label="Prazo"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Projeto"><Input value={f.project_label} onChange={(e) => setF({ ...f, project_label: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end"><Button disabled={!f.title.trim()} onClick={async () => { await app.repo.table('goals').insert({ title: f.title.trim(), target: f.target ? Number(f.target) : null, unit: f.unit || null, due_date: f.due_date || null, project_label: f.project_label || null, current: 0 }); onClose(); }}>Criar</Button></div>
      </div>
    </Dialog>
  );
}

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ amount: '', description: '', category: 'Geral', spent_on: localDateKey(localDateOf(new Date(), app.prefs.timezone)), project_label: '' });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Registrar despesa">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)"><Input autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Data"><Input type="date" value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></Field>
        <Field label="Categoria"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Projeto"><Input value={f.project_label} onChange={(e) => setF({ ...f, project_label: e.target.value })} /></Field>
        <div className="col-span-2"><Field label="Descrição"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      </div>
      <div className="mt-4 flex justify-end"><Button disabled={!(parseAmount(f.amount) > 0)} onClick={async () => { await app.repo.table('expenses').insert({ amount: parseAmount(f.amount), description: f.description || null, category: f.category || 'Geral', spent_on: f.spent_on, project_label: f.project_label || null }); onClose(); }}>Salvar</Button></div>
    </Dialog>
  );
}
