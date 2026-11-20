import { useEffect, useState, type ReactNode } from 'react';
import { User, Mic, Bell, Brain, Sparkles, Plug, History, Database, LogOut, Download, Trash2, ShieldCheck, Volume2 } from 'lucide-react';
import { useApp, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import type { TableName, UserPreferences } from '@/core/types.ts';
import { ptVoices, speak, voiceSupport } from '@/lib/voice.ts';
import { enablePush, notificationSupport, permissionState, disablePush } from '@/lib/notifications.ts';
import { executeCall } from '@/core/agent/agent.ts';
import { toLocalIso, formatRelativeDay, formatTime } from '@/core/time.ts';
import { supabase } from '@/lib/supabase.ts';
import { clearLocalData } from '@/lib/localStore.ts';
import { Button, Card, Field, Input, PageHeader, Select, Switch, Badge } from '@/components/ui/index.tsx';
import { ShortcutSettings } from '@/components/ShortcutSettings.tsx';
import { GraphicsSettings } from '@/components/GraphicsSettings.tsx';

const TZS = ['America/Bahia', 'America/Sao_Paulo', 'America/Recife', 'America/Fortaleza', 'America/Belem', 'America/Manaus', 'America/Cuiaba', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'America/New_York', 'UTC'];
const MEM_CATS: [string, string][] = [['tratamento', 'Forma de tratamento'], ['horarios', 'Horários habituais'], ['comunicacao', 'Comunicação'], ['trabalho', 'Trabalho'], ['projetos', 'Projetos'], ['notificacoes', 'Notificações'], ['rotinas', 'Rotinas'], ['geral', 'Geral']];
const ALL_TABLES: TableName[] = ['user_preferences', 'tasks', 'task_subtasks', 'notes', 'note_versions', 'calendar_events', 'reminders', 'projects', 'routines', 'routine_logs', 'focus_sessions', 'user_memories', 'conversations', 'conversation_messages', 'ai_action_logs'];

function Section({ icon, title, desc, children }: { icon: ReactNode; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 text-cyan">{icon}</span>
        <div><h2 className="font-display text-lg font-semibold">{title}</h2>{desc && <p className="text-sm text-muted">{desc}</p>}</div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div><p className="text-sm">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
      {children}
    </div>
  );
}

export default function Settings() {
  const app = useApp();
  const { prefs, updatePrefs } = app;
  const { toast } = useJarvis();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [perm, setPerm] = useState(permissionState());
  const logs = useRows('ai_action_logs', { order: [{ field: 'created_at', asc: false }], limit: 30 });
  const devices = useRows('device_tokens', { eq: { enabled: true } });
  const sup = notificationSupport();

  useEffect(() => {
    const load = () => setVoices(ptVoices());
    load();
    if (voiceSupport.tts()) speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      if (voiceSupport.tts()) speechSynthesis.removeEventListener('voiceschanged', load);
    };
  }, []);

  const set = (patch: Partial<UserPreferences>) => updatePrefs(patch).catch((e) => toast({ title: 'Erro ao salvar', body: String(e), tone: 'error' }));
  const consent = async (type: string, granted: boolean) => {
    if (app.mode === 'cloud') await supabase!.from('consent_records').insert({ consent_type: type, granted }).then(() => {});
  };

  const exportAll = async () => {
    const out: Record<string, unknown> = { exportado_em: new Date().toISOString(), modo: app.mode };
    for (const t of ALL_TABLES) {
      try { out[t] = await app.repo.table(t).list(); } catch { out[t] = 'indisponível'; }
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jarvis-dados-${toLocalIso(new Date(), prefs.timezone).slice(0, 10)}.json`;
    a.click();
  };

  const deleteAll = async () => {
    const word = app.mode === 'cloud' ? 'EXCLUIR CONTA' : 'APAGAR';
    const typed = window.prompt(`Esta ação é irreversível e apaga todos os seus dados${app.mode === 'cloud' ? ' e sua conta' : ' deste aparelho'}. Digite ${word} para confirmar:`);
    if (typed !== word) return;
    if (app.mode === 'cloud') {
      const { error } = await supabase!.rpc('delete_my_account');
      if (error) return toast({ title: 'Não foi possível excluir', body: error.message, tone: 'error' });
      await app.signOut();
    } else {
      clearLocalData();
      window.location.reload();
    }
  };

  const testReminder = async () => {
    const at = toLocalIso(new Date(Date.now() + 2 * 60000), prefs.timezone);
    const r = await executeCall(app.toolCtx('manual'), { tool: 'create_reminder', input: { title: 'Teste de notificação do JARVIS', at, body: 'Se você está vendo isso, os lembretes funcionam.' } });
    toast({ title: r.ok ? 'Lembrete de teste agendado' : 'Erro', body: r.ok ? 'Chegará em cerca de 2 minutos. Experimente fechar o app para testar o push.' : r.message, tone: r.ok ? 'success' : 'error' });
  };

  return (
    <div>
      <PageHeader title="Configurações" subtitle={app.mode === 'cloud' ? `Conectado como ${app.session?.user.email ?? ''}` : 'Modo Local — dados salvos apenas neste aparelho'} actions={app.mode === 'cloud' && <Button variant="ghost" onClick={app.signOut}><LogOut className="h-4 w-4" /> Sair</Button>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section icon={<User className="h-5 w-5" />} title="Perfil">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Como devo te chamar?"><Input defaultValue={prefs.display_name} onBlur={(e) => e.target.value.trim() && set({ display_name: e.target.value.trim().slice(0, 80) })} /></Field>
            <Field label="Nome do assistente"><Input defaultValue={prefs.assistant_name} onBlur={(e) => e.target.value.trim() && set({ assistant_name: e.target.value.trim().slice(0, 40) })} /></Field>
            <Field label="Fuso horário"><Select value={prefs.timezone} onChange={(e) => set({ timezone: e.target.value })}>{[...new Set([prefs.timezone, ...TZS])].map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Idioma"><Select value="pt-BR" disabled><option value="pt-BR">Português (Brasil)</option></Select></Field>
          </div>
        </Section>

        <GraphicsSettings />

        <Section icon={<Mic className="h-5 w-5" />} title="Voz" desc="O microfone só é usado quando você toca no botão ou ativa a palavra “Jarvis”. Nenhum áudio é armazenado.">
          <Row label="Comandos por voz" hint={voiceSupport.recognition() ? 'Reconhecimento nativo do navegador disponível' : 'Este navegador não reconhece voz nativamente (use Chrome ou Edge)'}><Switch checked={prefs.voice_enabled} onCheckedChange={(v) => set({ voice_enabled: v })} label="Comandos por voz" /></Row>
          <Row label="Palavra de ativação “Jarvis”" hint="Funciona apenas com o app aberto e visível. Consome mais bateria. Desative quando quiser.">
            <Switch checked={prefs.wake_word_enabled} disabled={!prefs.voice_enabled || !voiceSupport.recognition()} onCheckedChange={async (v) => {
              if (v && !window.confirm('Ativar a escuta da palavra “Jarvis”? O microfone ficará ativo enquanto o app estiver aberto e visível. O áudio é processado pelo serviço de voz do navegador e não é gravado pelo JARVIS.')) return;
              await consent('wake_word', v);
              set({ wake_word_enabled: v });
            }} label="Palavra de ativação" />
          </Row>
          <Row label="Respostas faladas"><Switch checked={prefs.tts_enabled} onCheckedChange={(v) => set({ tts_enabled: v })} label="Respostas faladas" /></Row>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Voz"><Select value={prefs.tts_voice ?? ''} onChange={(e) => set({ tts_voice: e.target.value || null })}><option value="">Automática (pt-BR)</option>{voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</Select></Field>
            <Field label={`Velocidade: ${prefs.tts_rate.toFixed(1)}x`}><input type="range" min={0.7} max={1.5} step={0.1} value={prefs.tts_rate} onChange={(e) => set({ tts_rate: Number(e.target.value) })} className="w-full accent-cyan-400" /></Field>
          </div>
          <Button variant="outline" size="sm" onClick={() => speak(`Olá, ${prefs.display_name}. Sistemas operacionais e prontos.`, { rate: prefs.tts_rate, voice: prefs.tts_voice })}><Volume2 className="h-4 w-4" /> Testar voz</Button>
        </Section>

        <Section icon={<Bell className="h-5 w-5" />} title="Notificações" desc="Lembretes ficam salvos e são processados pelo servidor a cada minuto.">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone={perm === 'granted' ? 'success' : perm === 'denied' ? 'danger' : 'default'}>Permissão: {perm === 'granted' ? 'concedida' : perm === 'denied' ? 'negada' : perm === 'unsupported' ? 'não suportado' : 'não solicitada'}</Badge>
            <Badge tone={sup.serverConfigured ? 'success' : 'warn'}>Push com app fechado: {sup.serverConfigured ? 'configurado' : 'servidor não configurado'}</Badge>
            {app.mode === 'cloud' && <Badge>{devices.data?.length ?? 0} aparelho(s) registrados</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { const r = await enablePush(app.repo); setPerm(permissionState()); if (r.ok) await set({ push_enabled: true }); await consent('push', r.ok); toast({ title: r.ok ? 'Notificações' : 'Atenção', body: r.message, tone: r.ok ? 'success' : 'error' }); }}>Ativar notificações</Button>
            {prefs.push_enabled && <Button size="sm" variant="ghost" onClick={async () => { await disablePush(app.repo); await set({ push_enabled: false }); }}>Desativar push neste aparelho</Button>}
            <Button size="sm" variant="outline" onClick={testReminder}>Enviar lembrete de teste (2 min)</Button>
          </div>
          {app.mode === 'local' && <p className="text-xs text-warn">No Modo Local, os avisos aparecem apenas com o app aberto. Para receber com o app fechado, conecte o Supabase (veja o README).</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Silêncio a partir de"><Input type="time" value={prefs.quiet_hours_start?.slice(0, 5) ?? ''} onChange={(e) => set({ quiet_hours_start: e.target.value || null })} /></Field>
            <Field label="Silêncio até"><Input type="time" value={prefs.quiet_hours_end?.slice(0, 5) ?? ''} onChange={(e) => set({ quiet_hours_end: e.target.value || null })} /></Field>
            <Field label="Antecedência padrão"><Select value={prefs.default_reminder_minutes} onChange={(e) => set({ default_reminder_minutes: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} min` : 'Na hora'}</option>)}</Select></Field>
          </div>
          <Row label="Briefing da manhã ao abrir o app"><Switch checked={prefs.morning_briefing} onCheckedChange={(v) => set({ morning_briefing: v })} label="Briefing da manhã" /></Row>
        </Section>

        <Section icon={<Brain className="h-5 w-5" />} title="Memória" desc="O JARVIS só guarda preferências que você aprovar. Gerencie o conteúdo em Conhecimento.">
          <Row label="Memória pessoal"><Switch checked={prefs.memory_enabled} onCheckedChange={(v) => { consent('memory', v); set({ memory_enabled: v }); }} label="Memória pessoal" /></Row>
          <div>
            <p className="mb-2 text-xs text-muted">Categorias que podem ser lembradas (nenhuma marcada = todas):</p>
            <div className="flex flex-wrap gap-2">
              {MEM_CATS.map(([k, label]) => {
                const on = prefs.memory_categories.includes(k);
                return <button key={k} aria-pressed={on} onClick={() => set({ memory_categories: on ? prefs.memory_categories.filter((x) => x !== k) : [...prefs.memory_categories, k] })} className={`rounded-full border px-3 py-1 text-xs cursor-pointer ${on ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-line text-muted'}`}>{label}</button>;
              })}
            </div>
          </div>
          <Field label="Manter histórico de conversas por"><Select value={prefs.history_retention_days} onChange={(e) => set({ history_retention_days: Number(e.target.value) })}>{[7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} dias</option>)}</Select></Field>
        </Section>

        <Section icon={<Sparkles className="h-5 w-5" />} title="Inteligência artificial">
          <Row label="Comandos locais (sem custo)" hint="Tarefas, notas, agenda, lembretes, foco, busca e briefings em português."><Badge tone="success">ativo</Badge></Row>
          <Row label="IA avançada (Claude / OpenAI)" hint={app.aiAvailable ? 'Conectada pelo servidor. As chaves nunca ficam no aplicativo.' : app.mode === 'local' ? 'Requer o Supabase configurado e uma chave de IA no servidor.' : 'Configure ANTHROPIC_API_KEY ou OPENAI_API_KEY nas secrets das Edge Functions.'}>
            <Badge tone={app.aiAvailable ? 'violet' : 'warn'}>{app.aiAvailable ? 'conectada' : 'não configurada'}</Badge>
          </Row>
          <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" /> Ações que apagam dados, guardam memórias ou criam várias coisas de uma vez sempre pedem sua confirmação.</p>
        </Section>

        <ShortcutSettings />

        <Section icon={<Plug className="h-5 w-5" />} title="Integrações">
          <Row label="Google Calendar" hint="Requer credenciais OAuth do Google (ainda não configuradas). O calendário próprio funciona sem ela."><Badge tone="warn">não configurado</Badge></Row>
          <Row label="Gmail" hint="Planejado. Envio de e-mails sempre exigirá pré-visualização e aprovação."><Badge>indisponível</Badge></Row>
        </Section>

        <Section icon={<History className="h-5 w-5" />} title="Histórico de ações da IA" desc="Tudo que o JARVIS executou nos seus dados.">
          {logs.data?.length ? (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto scroll-thin pr-1 text-sm">
              {logs.data.map((l) => {
                const res = l.result as { message?: string } | null;
                return (
                  <li key={l.id} className="rounded-lg border border-line px-3 py-2">
                    <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-cyan">{l.tool}</span><span className="text-[11px] text-muted">{formatRelativeDay(l.created_at, new Date(), prefs.timezone)} {formatTime(l.created_at, prefs.timezone)}</span></div>
                    <p className={l.status === 'error' ? 'text-danger text-xs' : 'text-xs text-muted'}>{res?.message ?? l.status}</p>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted">Nenhuma ação registrada ainda.</p>}
        </Section>

        <Section icon={<Database className="h-5 w-5" />} title="Seus dados (LGPD)">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportAll}><Download className="h-4 w-4" /> Exportar todos os dados</Button>
            <Button variant="danger" onClick={deleteAll}><Trash2 className="h-4 w-4" /> {app.mode === 'cloud' ? 'Excluir conta e dados' : 'Apagar dados deste aparelho'}</Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
