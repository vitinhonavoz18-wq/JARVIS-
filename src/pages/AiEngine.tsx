import { useEffect, useMemo, useState } from 'react';
import { Cpu, Gauge, ListChecks, Users, DollarSign, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AiSettings } from '@/core/types.ts';
import { TOOLS, toolRisk } from '@/core/agent/tools.ts';
import '@/core/agent/businessTools.ts';
import { SPECIALISTS } from '@/core/agent/specialists.ts';
import { RISK_LABEL, requiresConfirmation } from '@/core/connectors/types.ts';
import { formatRelativeDay, formatTimeSpoken } from '@/core/time.ts';
import { useApp, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { supabase } from '@/lib/supabase.ts';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Switch } from '@/components/ui/index.tsx';

type Draft = Pick<AiSettings, 'provider' | 'simple_model' | 'complex_model' | 'voice_model' | 'response_style' | 'daily_request_limit' | 'monthly_budget_usd' | 'web_search_enabled' | 'fallback_enabled' | 'model_prices'>;
const EMPTY: Draft = { provider: 'auto', simple_model: null, complex_model: null, voice_model: null, response_style: 'objetivo', daily_request_limit: 300, monthly_budget_usd: null, web_search_enabled: false, fallback_enabled: true, model_prices: {} };

export default function AiEngine() {
  const app = useApp();
  const { toast } = useJarvis();
  const rows = useRows('ai_settings', { limit: 1 });
  const calls = useRows('ai_calls', { order: [{ field: 'created_at', asc: false }], limit: 200 });
  const [d, setD] = useState<Draft>(EMPTY);
  const [models, setModels] = useState<{ provider: string; id: string }[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = rows.data?.[0];

  useEffect(() => {
    if (current) setD({ ...EMPTY, ...current });
  }, [current]);

  const loadModels = async () => {
    if (!supabase) return;
    setLoadingModels(true);
    try {
      const { data } = await supabase.functions.invoke('ai-chat', { body: { list_models: true } });
      setModels(data?.models ?? []);
      setProviders(data?.providers ?? []);
    } finally {
      setLoadingModels(false);
    }
  };
  useEffect(() => {
    loadModels();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      if (current) await app.repo.table('ai_settings').update(current.id, d);
      else await app.repo.table('ai_settings').insert(d);
      toast({ title: 'AI Engine atualizado', tone: 'success' });
    } catch (e) {
      toast({ title: 'Erro ao salvar', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const month = new Date().toISOString().slice(0, 7);
  const usage = useMemo(() => {
    const m = (calls.data ?? []).filter((c) => c.created_at.startsWith(month));
    return {
      requests: m.length,
      errors: m.filter((c) => c.status === 'error').length,
      fallbacks: m.filter((c) => c.status === 'fallback').length,
      tokens: m.reduce((a, c) => a + c.input_tokens + c.output_tokens, 0),
      cost: m.reduce((a, c) => a + Number(c.est_cost_usd ?? 0), 0),
      unpriced: m.some((c) => c.est_cost_usd == null && c.status !== 'error'),
    };
  }, [calls.data, month]);

  const usedModels = [...new Set([d.simple_model, d.complex_model, ...(calls.data ?? []).map((c) => c.model)].filter(Boolean))] as string[];
  const modelOptions = (filter?: string) => models.filter((m) => !filter || m.provider === filter);
  const modelField = (label: string, k: 'simple_model' | 'complex_model' | 'voice_model') => (
    <Field label={label} hint={models.length ? undefined : 'Lista indisponível: digite o identificador exato do modelo.'}>
      <Input list={`ml-${k}`} value={d[k] ?? ''} onChange={(e) => setD({ ...d, [k]: e.target.value || null })} placeholder="padrão do servidor" />
      <datalist id={`ml-${k}`}>{modelOptions(d.provider === 'auto' ? undefined : d.provider).map((m) => <option key={m.provider + m.id} value={m.id}>{m.provider}</option>)}</datalist>
    </Field>
  );

  return (
    <div>
      <PageHeader title="AI Engine" subtitle="Provedores, modelos, limites, consumo e o catálogo de ferramentas do JARVIS." actions={<Button onClick={save} loading={saving}>Salvar configurações</Button>} />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Badge tone={app.aiAvailable ? 'success' : 'warn'}>IA no servidor: {app.aiAvailable ? 'conectada' : app.mode === 'local' ? 'indisponível no Modo Local' : 'sem chave configurada'}</Badge>
        {providers.map((p) => <Badge key={p} tone="cyan">{p === 'openai' ? 'OpenAI (Responses API)' : 'Anthropic (Claude)'} disponível</Badge>)}
        <Badge>As chaves ficam somente no servidor</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Modelos e provedor" icon={<Cpu className="h-4 w-4" />} action={<Button size="sm" variant="ghost" onClick={loadModels} loading={loadingModels} disabled={!supabase}><RefreshCw className="h-3.5 w-3.5" /> Listar modelos</Button>} />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            <Field label="Provedor"><Select value={d.provider} onChange={(e) => setD({ ...d, provider: e.target.value as Draft['provider'] })}><option value="auto">Automático</option><option value="openai">OpenAI (GPT)</option><option value="anthropic">Anthropic (Claude)</option></Select></Field>
            <Field label="Estilo de resposta"><Select value={d.response_style} onChange={(e) => setD({ ...d, response_style: e.target.value as Draft['response_style'] })}><option value="objetivo">Objetivo</option><option value="detalhado">Detalhado</option><option value="executivo">Executivo</option></Select></Field>
            {modelField('Modelo para tarefas simples', 'simple_model')}
            {modelField('Modelo para raciocínio complexo', 'complex_model')}
            {modelField('Modelo de voz (reservado)', 'voice_model')}
            <div className="space-y-3 pt-6">
              <label className="flex items-center gap-2 text-sm"><Switch checked={d.web_search_enabled} onCheckedChange={(v) => setD({ ...d, web_search_enabled: v })} label="Pesquisa na internet" /> Pesquisa na internet (com fontes)</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={d.fallback_enabled} onCheckedChange={(v) => setD({ ...d, fallback_enabled: v })} label="Fallback" /> Trocar de provedor em falhas</label>
            </div>
            <p className="sm:col-span-2 text-xs text-muted">Os identificadores vêm da lista do provedor (botão “Listar modelos”); nada fica fixo no código. A assinatura do ChatGPT não equivale a créditos da API da OpenAI.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Limites e custos" icon={<Gauge className="h-4 w-4" />} />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            <Field label="Requisições por dia"><Input type="number" min={1} max={5000} value={d.daily_request_limit} onChange={(e) => setD({ ...d, daily_request_limit: Number(e.target.value) })} /></Field>
            <Field label="Orçamento mensal (US$, opcional)"><Input type="number" min={0} step="0.01" value={d.monthly_budget_usd ?? ''} onChange={(e) => setD({ ...d, monthly_budget_usd: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2">
              <p className="mb-2 text-xs text-muted">Preço por 1 milhão de tokens (consulte a página de preços do provedor; usado para estimar custos):</p>
              {usedModels.length ? usedModels.map((m) => (
                <div key={m} className="mb-2 grid grid-cols-[1fr_90px_90px] items-center gap-2 text-sm">
                  <span className="truncate font-mono text-xs">{m}</span>
                  <Input aria-label={`Entrada ${m}`} type="number" step="0.01" placeholder="entrada" value={d.model_prices[m]?.input_per_m ?? ''} onChange={(e) => setD({ ...d, model_prices: { ...d.model_prices, [m]: { input_per_m: Number(e.target.value), output_per_m: d.model_prices[m]?.output_per_m ?? 0 } } })} />
                  <Input aria-label={`Saída ${m}`} type="number" step="0.01" placeholder="saída" value={d.model_prices[m]?.output_per_m ?? ''} onChange={(e) => setD({ ...d, model_prices: { ...d.model_prices, [m]: { input_per_m: d.model_prices[m]?.input_per_m ?? 0, output_per_m: Number(e.target.value) } } })} />
                </div>
              )) : <p className="text-xs text-muted">Defina modelos acima ou use a IA para listar aqui.</p>}
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Uso neste mês" icon={<DollarSign className="h-4 w-4" />} />
          <div className="px-5 pb-5">
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              {[['Requisições', usage.requests], ['Tokens', usage.tokens.toLocaleString('pt-BR')], ['Custo estimado', `US$ ${usage.cost.toFixed(4)}${usage.unpriced ? '*' : ''}`], ['Trocas de provedor', usage.fallbacks], ['Erros', usage.errors]].map(([l, v]) => (
                <div key={String(l)} className="rounded-xl border border-line p-3"><p className="label-tech">{l}</p><p className="mt-1 font-display text-xl">{v}</p></div>
              ))}
            </div>
            {usage.unpriced && <p className="mb-2 text-xs text-muted">* Alguns modelos não têm preço cadastrado e não entram na estimativa.</p>}
            {!calls.data?.length ? <p className="text-sm text-muted">Nenhuma chamada de IA registrada{app.mode === 'local' ? ' (o Modo Local usa apenas o interpretador local, sem custo)' : ''}.</p> : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[600px] text-xs">
                  <thead><tr className="label-tech text-left"><th className="py-1">Quando</th><th>Provedor</th><th>Modelo</th><th>Especialista</th><th className="text-right">Tokens</th><th className="text-right">Custo</th><th>Status</th></tr></thead>
                  <tbody>{calls.data.slice(0, 30).map((c) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className="py-1">{formatRelativeDay(c.created_at, new Date(), app.prefs.timezone)} {formatTimeSpoken(c.created_at, app.prefs.timezone)}</td>
                      <td>{c.provider}</td><td className="font-mono">{c.model}</td><td>{c.specialist ?? '—'}</td>
                      <td className="text-right">{(c.input_tokens + c.output_tokens).toLocaleString('pt-BR')}</td>
                      <td className="text-right">{c.est_cost_usd != null ? `US$ ${Number(c.est_cost_usd).toFixed(4)}` : '—'}</td>
                      <td><Badge tone={c.status === 'ok' ? 'success' : c.status === 'fallback' ? 'warn' : 'danger'}>{c.status}</Badge></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Especialistas" icon={<Users className="h-4 w-4" />} subtitle="Roteamento lógico — sem chamadas extras de IA." />
          <ul className="space-y-2 px-5 pb-5 text-sm">
            {Object.values(SPECIALISTS).map((s) => <li key={s.id}><span className="font-medium">{s.name}</span> <Badge>{s.complexity === 'complex' ? 'modelo avançado' : 'modelo rápido'}</Badge><p className="text-xs text-muted">{s.prompt}</p></li>)}
          </ul>
        </Card>

        <Card>
          <CardHeader title={`Catálogo de ferramentas (${TOOLS.length})`} icon={<ListChecks className="h-4 w-4" />} subtitle="Cada ação tem esquema validado, nível de risco, tempo limite e política de confirmação." />
          <ul className="max-h-[420px] space-y-1.5 overflow-y-auto px-5 pb-5 scroll-thin text-xs">
            {TOOLS.filter((t) => t.name !== 'reschedule_item').map((t) => {
              const risk = toolRisk(t);
              return (
                <li key={t.name} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-cyan">{t.name}</span>
                    <Badge tone={risk === 'read' ? 'success' : risk === 'reversible' ? 'cyan' : 'warn'}>{RISK_LABEL[risk]}</Badge>
                    {(t.confirm || requiresConfirmation(risk) || t.needsConfirmation) && <Badge tone="warn"><ShieldCheck className="h-3 w-3" /> confirmação</Badge>}
                    <span className="ml-auto text-muted">{Math.round((t.timeoutMs ?? 20000) / 1000)}s{t.readOnly ? ` · ${t.retries ?? 1} retentativa` : ''}</span>
                  </div>
                  <p className="mt-0.5 text-muted">{t.description}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
