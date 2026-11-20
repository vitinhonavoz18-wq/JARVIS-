import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { CalendarClock, ListChecks, Target, Zap, Clock, AlertTriangle, Volume2, NotebookPen, CheckSquare, CalendarPlus, Play, Sparkles, Mic, Bell, Wand2 } from 'lucide-react';
import { useApp, useDerived, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useNow } from '@/lib/hooks.ts';
import { buildBriefing, completeTaskById } from '@/core/agent/tools.ts';
import { focusSeconds } from '@/core/agent/insights.ts';
import { greetingFor, formatTimeSpoken, WEEKDAYS_PT, MONTHS_PT, zonedParts, localDateKey, localDateOf, formatRelativeDay } from '@/core/time.ts';
import { JarvisCore } from '@/components/core/JarvisCore.tsx';
import { CommandBar } from '@/components/CommandBar.tsx';
import { Card, CardHeader, Spinner, Button } from '@/components/ui/index.tsx';
import { PriorityBadge } from '@/components/forms.tsx';
import { speak } from '@/lib/voice.ts';
import { cn } from '@/lib/cn.ts';

const fade = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.04 * i, duration: 0.3 } });

export default function Dashboard() {
  const app = useApp();
  const { prefs } = app;
  const tz = prefs.timezone;
  const jarvis = useJarvis();
  const navigate = useNavigate();
  const now = useNow();
  const todayKey = localDateKey(localDateOf(now, tz));
  const briefing = useDerived(['briefing', todayKey, app.version, Math.floor(now.getTime() / 300000)], () => buildBriefing(app.toolCtx(), todayKey));
  const activeFocus = useRows('focus_sessions', { in: { status: ['active', 'paused'] }, limit: 1 });
  const anyTask = useRows('tasks', { limit: 1 });
  const anyNote = useRows('notes', { limit: 1 });
  const anyEvent = useRows('calendar_events', { limit: 1 });
  const alerts = useRows('alerts', { isNull: ['read_at'], order: [{ field: 'created_at', asc: false }], limit: 3 });
  const p = zonedParts(now, tz);
  const snap = briefing.data?.snapshot;
  const isNewUser = anyTask.data && anyNote.data && anyEvent.data && !anyTask.data.length && !anyNote.data.length && !anyEvent.data.length;
  const coreSize = typeof window !== 'undefined' && window.innerWidth < 640 ? 184 : 248;

  const done = snap?.doneTasks.length ?? 0;
  const total = snap ? snap.tasks.length : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const upcoming = snap?.events.filter((e) => e.end > now) ?? [];
  const timeline = [
    ...(snap?.events.map((e) => ({ id: e.key, title: e.event.title, at: e.start, end: e.end as Date | null, kind: 'event' as const, done: false })) ?? []),
    ...(snap?.tasks.filter((t) => t.due_at && !t.all_day).map((t) => ({ id: t.id, title: t.title, at: new Date(t.due_at!), end: null, kind: 'task' as const, done: t.status === 'done' })) ?? []),
  ].filter((i) => (i.end ?? i.at) >= new Date(now.getTime() - 30 * 60000)).sort((a, b) => a.at.getTime() - b.at.getTime());
  const nextItem = timeline.find((i) => i.at > now && !i.done);
  const dayIsEmpty = snap && !snap.pendingTasks.length && !upcoming.length && !snap.overdue.length;

  return (
    <div className="space-y-5">
      {/* 1–2. Saudação + assistente */}
      <section className="grid grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <motion.div {...fade(0)} className="text-center lg:text-left">
          <p className="label-tech">{WEEKDAYS_PT[p.weekday]}, {p.day} de {MONTHS_PT[p.month - 1]}</p>
          <h1 className="mt-2 font-display text-[2rem] leading-tight md:text-5xl font-semibold tracking-tight">
            <span className="text-gradient">{greetingFor(now, tz)}, {prefs.display_name}.</span>
          </h1>
          {briefing.isLoading ? (
            <div className="mt-3 flex justify-center lg:justify-start"><Spinner /></div>
          ) : (
            <p className="mx-auto mt-2 max-w-md text-[15px] text-muted lg:mx-0">{briefing.data?.facts[0]}</p>
          )}
          {briefing.data && (
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => speak([briefing.data!.greeting, ...briefing.data!.facts, ...briefing.data!.suggestions.slice(0, 1).map((s) => `Sugestão: ${s}`)].join(' '), { rate: prefs.tts_rate, voice: prefs.tts_voice })}>
              <Volume2 className="h-4 w-4" /> Ouvir briefing
            </Button>
          )}
        </motion.div>
        <motion.div {...fade(1)} className="flex justify-center">
          <button onClick={() => jarvis.startListening()} className="rounded-full cursor-pointer" aria-label="Tocar para falar com o JARVIS">
            <JarvisCore state={jarvis.core} level={jarvis.level} size={coreSize} />
          </button>
        </motion.div>
        <motion.div {...fade(2)} className="hidden lg:block">
          <InsightsCard suggestions={briefing.data?.suggestions ?? []} />
        </motion.div>
      </section>

      <motion.div {...fade(3)} className="mx-auto max-w-2xl">
        <CommandBar onSent={() => navigate('/conversar')} />
        {jarvis.listening && <p className="mt-2 text-center text-sm text-cyan">{jarvis.interim || 'Pode falar…'}</p>}
      </motion.div>

      {isNewUser && (
        <motion.div {...fade(4)}>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold"><Zap className="h-5 w-5 text-cyan" /> Vamos configurar seu centro de comando</h2>
            <p className="mt-1 text-sm text-muted">Fale ou digite naturalmente. Experimente:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Academia amanhã às 7, me avise 30 minutos antes', 'Marque reunião com a equipe sexta às 10h', 'Anote que preciso revisar meus objetivos do mês', 'Crie uma rotina de leitura todos os dias às 21h'].map((ex) => (
                <button key={ex} onClick={() => jarvis.send(ex)} className="rounded-full border border-line px-3 py-2 text-xs text-muted hover:border-cyan/50 hover:text-cyan transition cursor-pointer">“{ex}”</button>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* 3. Resumo do dia */}
        <motion.div {...fade(5)}>
          <Card interactive className="glow-border h-full">
            <CardHeader title="Resumo do dia" icon={<ListChecks className="h-4 w-4" />} action={<Link to="/tarefas" className="text-xs text-cyan hover:underline">ver tudo</Link>} />
            <div className="space-y-3 px-5 pb-5">
              {briefing.isLoading ? <Spinner /> : dayIsEmpty ? (
                <div className="py-2 text-center">
                  <p className="text-sm">Seu dia está livre de tarefas.</p>
                  <p className="text-sm text-muted">Quer planejar sua próxima missão?</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button size="sm" variant="soft" onClick={() => navigate('/tarefas?novo=1')}><CheckSquare className="h-4 w-4" /> Nova tarefa</Button>
                    <Button size="sm" variant="outline" onClick={() => jarvis.send('organize meu dia')}><Wand2 className="h-4 w-4" /> Planejar</Button>
                  </div>
                </div>
              ) : (
                <>
                  {snap?.pendingTasks.length ? (
                    <ul className="space-y-0.5">
                      {snap.pendingTasks.slice(0, 5).map((t) => (
                        <li key={t.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-white/[0.03]">
                          <button onClick={() => completeTaskById(app.toolCtx('manual'), t)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md cursor-pointer" aria-label={`Concluir ${t.title}`}>
                            <span className="h-4.5 w-4.5 rounded-md border border-cyan/50" />
                          </button>
                          <Link to={`/tarefas?id=${t.id}`} className="min-w-0 flex-1 truncate text-sm">{t.title}</Link>
                          {t.due_at && !t.all_day && <span className="font-mono text-[11px] text-muted">{formatTimeSpoken(t.due_at, tz)}</span>}
                          <PriorityBadge p={t.priority} />
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">Nenhuma tarefa pendente para hoje.</p>}
                  {Boolean(snap?.overdue.length) && (
                    <Link to="/tarefas?view=overdue" className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">
                      <AlertTriangle className="h-4 w-4" /> {snap!.overdue.length} pendência(s) de dias anteriores
                    </Link>
                  )}
                  {Boolean(snap?.freeSlots.length) && (
                    <div>
                      <p className="label-tech mb-1.5">Horários livres</p>
                      <div className="flex flex-wrap gap-1.5">
                        {snap!.freeSlots.slice(0, 4).map((s, i) => <span key={i} className="rounded-lg bg-success/10 px-2 py-1 font-mono text-[11px] text-success">{formatTimeSpoken(s.start, tz)}–{formatTimeSpoken(s.end, tz)}</span>)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </motion.div>

        {/* 4. Missões */}
        <motion.div {...fade(6)}>
          <Card interactive className="glow-border h-full">
            <CardHeader title="Minhas missões" icon={<Target className="h-4 w-4" />} subtitle={snap ? `${snap.focusMinutes} min de foco hoje` : undefined} />
            <div className="flex items-center gap-5 px-5">
              <ProgressRing pct={pct} />
              <div className="min-w-0 space-y-1 text-sm">
                <p><span className="font-display text-2xl font-semibold">{done}</span><span className="text-muted"> de {total} tarefas de hoje</span></p>
                {snap?.routines.some((r) => r.scheduledToday) && <p className="text-muted">Hábitos: {snap.routines.filter((r) => r.scheduledToday && r.doneToday).length}/{snap.routines.filter((r) => r.scheduledToday).length} feitos</p>}
                <p className="truncate text-muted">Próxima: {nextItem ? <span className="text-ink">{nextItem.title} · {formatTimeSpoken(nextItem.at, tz)}</span> : 'nada agendado'}</p>
              </div>
            </div>
            <div className="px-5 pb-5 pt-4">
              {activeFocus.data?.[0] ? (
                <Link to="/foco" className="flex items-center justify-between rounded-xl border border-cyan/30 bg-cyan/5 px-4 py-3">
                  <span className="text-sm font-medium">{activeFocus.data[0].title}</span>
                  <span className="text-xs text-cyan">{Math.round(focusSeconds(activeFocus.data[0], now) / 60)}/{activeFocus.data[0].planned_minutes} min</span>
                </Link>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[25, 45, 90].map((m) => (
                    <Button key={m} variant="outline" size="sm" onClick={async () => { await jarvis.send(`iniciar modo foco por ${m} minutos`); navigate('/foco'); }}><Play className="h-3.5 w-3.5" /> Foco {m} min</Button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* 5. Próximos compromissos */}
        <motion.div {...fade(7)} className="md:col-span-2 xl:col-span-1">
          <Card interactive className="glow-border h-full">
            <CardHeader title="Próximos compromissos" icon={<CalendarClock className="h-4 w-4" />} action={<Link to="/agenda" className="text-xs text-cyan hover:underline">agenda</Link>} />
            <div className="px-5 pb-5">
              {!timeline.length ? (
                <div className="flex items-center gap-3 py-2 text-sm text-muted"><Clock className="h-5 w-5 text-cyan" /> Nenhum compromisso ou tarefa com horário pelo resto do dia.</div>
              ) : (
                <ol className="relative ml-2 space-y-3 border-l border-line pl-5">
                  {timeline.slice(0, 6).map((i) => {
                    const live = i.at <= now && (i.end ?? i.at) >= now;
                    return (
                      <li key={i.id} className="relative">
                        <span className={cn('absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-void', live ? 'bg-success' : i.kind === 'event' ? 'bg-cyan' : 'bg-violet')} />
                        <p className="font-mono text-[11px] text-muted">{formatTimeSpoken(i.at, tz)}{i.end ? `–${formatTimeSpoken(i.end, tz)}` : ''} · {i.kind === 'event' ? 'compromisso' : 'tarefa'}{live ? ' · agora' : ''}</p>
                        <p className={cn('text-sm', i.done && 'line-through text-muted')}>{i.title}</p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </Card>
        </motion.div>

        {/* 6. Ações rápidas */}
        <motion.div {...fade(8)}>
          <Card className="h-full">
            <CardHeader title="Ações rápidas" icon={<Zap className="h-4 w-4" />} />
            <div className="grid grid-cols-2 gap-2 px-5 pb-5">
              {[
                { label: 'Tarefa', icon: CheckSquare, to: '/tarefas?novo=1' },
                { label: 'Nota', icon: NotebookPen, to: '/notas?novo=1' },
                { label: 'Compromisso', icon: CalendarPlus, to: '/agenda?novo=1' },
              ].map((b) => (
                <button key={b.label} onClick={() => navigate(b.to)} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm text-muted hover:border-cyan/40 hover:text-ink hover:bg-cyan/5 transition cursor-pointer">
                  <b.icon className="h-4 w-4 text-cyan" /> {b.label}
                </button>
              ))}
              <button onClick={() => jarvis.startListening()} className="flex min-h-11 items-center gap-2 rounded-xl bg-cyan/10 px-3 py-2.5 text-sm text-cyan hover:bg-cyan/15 cursor-pointer">
                <Mic className="h-4 w-4" /> Falar
              </button>
            </div>
          </Card>
        </motion.div>

        {/* 7. Alertas relevantes (só aparece se houver) */}
        {Boolean(alerts.data?.length) && (
          <motion.div {...fade(9)}>
            <Card className="h-full">
              <CardHeader title="Alertas" icon={<Bell className="h-4 w-4" />} action={<Link to="/executivo" className="text-xs text-cyan hover:underline">central</Link>} />
              <ul className="space-y-2 px-5 pb-5">
                {alerts.data!.map((a) => (
                  <li key={a.id} className={cn('rounded-xl border px-3 py-2 text-sm', a.severity === 'critical' ? 'border-danger/40' : a.severity === 'warning' ? 'border-warn/40' : 'border-line')}>
                    <p>{a.title}</p>
                    <p className="text-[11px] text-muted">{a.source} · {formatRelativeDay(a.created_at, now, tz)} {formatTimeSpoken(a.created_at, tz)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
        )}

        <motion.div {...fade(10)} className="lg:hidden">
          <InsightsCard suggestions={briefing.data?.suggestions ?? []} />
        </motion.div>
      </div>
    </div>
  );
}

function InsightsCard({ suggestions }: { suggestions: string[] }) {
  return (
    <Card className="h-full p-5">
      <p className="label-tech mb-2 flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-violet" /> Insights do JARVIS</p>
      {suggestions.length ? (
        <ul className="space-y-2 text-sm">{suggestions.map((s, i) => <li key={i} className="flex gap-2"><span className="text-violet">›</span><span><span className="text-muted">Sugestão:</span> {s}</span></li>)}</ul>
      ) : (
        <p className="text-sm text-muted">Sem sugestões no momento. Elas aparecem conforme você registra tarefas e compromissos.</p>
      )}
    </Card>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0" role="img" aria-label={`${pct}% concluído`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="rgb(120 160 255 / 0.12)" strokeWidth="7" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="url(#ringG)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} transform="rotate(-90 44 44)" style={{ transition: 'stroke-dashoffset .8s ease' }} />
      <defs><linearGradient id="ringG" x1="0" x2="1"><stop offset="0" stopColor="#00A8FF" /><stop offset="1" stopColor="#00DBFF" /></linearGradient></defs>
      <text x="44" y="49" textAnchor="middle" className="fill-ink font-display text-[15px] font-semibold">{pct}%</text>
    </svg>
  );
}
