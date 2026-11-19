import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { CalendarClock, ListChecks, Target, Lightbulb, Zap, Clock, AlertTriangle, Volume2, NotebookPen, CheckSquare, CalendarPlus, Play, Sparkles, Mic } from 'lucide-react';
import { useApp, useDerived, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useNow } from '@/lib/hooks.ts';
import { buildBriefing, completeTaskById } from '@/core/agent/tools.ts';
import { focusSeconds } from '@/core/agent/insights.ts';
import { greetingFor, formatTimeSpoken, WEEKDAYS_PT, MONTHS_PT, zonedParts, localDateKey, localDateOf } from '@/core/time.ts';
import { JarvisCore } from '@/components/core/JarvisCore.tsx';
import { CommandBar } from '@/components/CommandBar.tsx';
import { Card, CardHeader, EmptyState, Spinner, Button } from '@/components/ui/index.tsx';
import { PriorityBadge } from '@/components/forms.tsx';
import { speak } from '@/lib/voice.ts';
import { cn } from '@/lib/cn.ts';

const fade = (i: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 * i, duration: 0.35 } });

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
  const p = zonedParts(now, tz);
  const snap = briefing.data?.snapshot;
  const anyTask = useRows('tasks', { limit: 1 });
  const anyNote = useRows('notes', { limit: 1 });
  const anyEvent = useRows('calendar_events', { limit: 1 });
  const isNewUser = anyTask.data && anyNote.data && anyEvent.data && !anyTask.data.length && !anyNote.data.length && !anyEvent.data.length;

  const done = snap?.doneTasks.length ?? 0;
  const total = snap ? snap.tasks.length : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const upcoming = snap?.events.filter((e) => e.end > now) ?? [];
  const nextItem = [...upcoming.map((e) => ({ title: e.event.title, at: e.start, kind: 'Compromisso' })), ...(snap?.pendingTasks.filter((t) => t.due_at && !t.all_day && new Date(t.due_at) > now).map((t) => ({ title: t.title, at: new Date(t.due_at!), kind: 'Tarefa' })) ?? [])].sort((a, b) => a.at.getTime() - b.at.getTime())[0];

  return (
    <div className="space-y-6">
      {/* Saudação + Núcleo */}
      <section className="relative grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <motion.div {...fade(0)} className="text-center lg:text-left">
          <p className="label-tech">{WEEKDAYS_PT[p.weekday]}, {p.day} de {MONTHS_PT[p.month - 1]}</p>
          <h1 className="mt-2 font-display text-3xl md:text-5xl font-semibold tracking-tight">
            <span className="text-gradient">{greetingFor(now, tz)}, {prefs.display_name}.</span>
          </h1>
          {briefing.isLoading ? (
            <div className="mt-4 flex justify-center lg:justify-start"><Spinner /></div>
          ) : (
            <p className="mt-3 max-w-md text-muted mx-auto lg:mx-0">{briefing.data?.facts[0]}</p>
          )}
          {briefing.data && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => speak([`${briefing.data!.greeting}`, ...briefing.data!.facts, ...briefing.data!.suggestions.slice(0, 1).map((s) => `Sugestão: ${s}`)].join(' '), { rate: prefs.tts_rate, voice: prefs.tts_voice })}
            >
              <Volume2 className="h-4 w-4" /> Ouvir briefing
            </Button>
          )}
        </motion.div>
        <motion.div {...fade(1)} className="flex justify-center">
          <button onClick={() => jarvis.startListening()} className="rounded-full cursor-pointer focus-visible:outline-none" aria-label="Tocar para falar com o JARVIS">
            <JarvisCore state={jarvis.core} level={jarvis.level} size={typeof window !== 'undefined' && window.innerWidth < 640 ? 200 : 260} />
          </button>
        </motion.div>
        <motion.div {...fade(2)} className="hidden lg:block">
          <Card className="p-4">
            <p className="label-tech mb-2 flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-violet" /> Insights do JARVIS</p>
            {briefing.data?.suggestions.length ? (
              <ul className="space-y-2 text-sm">
                {briefing.data.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-violet">›</span><span><span className="text-muted">Sugestão:</span> {s}</span></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Sem sugestões no momento. Elas aparecem conforme você registra tarefas e compromissos.</p>
            )}
          </Card>
        </motion.div>
      </section>

      <motion.div {...fade(3)} className="mx-auto max-w-2xl">
        <CommandBar onSent={() => navigate('/conversar')} />
        {jarvis.listening && <p className="mt-2 text-center text-sm text-cyan">{jarvis.interim || 'Pode falar…'}</p>}
      </motion.div>

      {isNewUser && (
        <motion.div {...fade(4)}>
          <Card className="p-6">
            <div className="grid gap-6 md:grid-cols-[auto_1fr] items-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-cyan/10 text-cyan"><Zap className="h-7 w-7" /></div>
              <div>
                <h2 className="font-display text-lg font-semibold">Vamos configurar seu centro de comando</h2>
                <p className="mt-1 text-sm text-muted">Fale ou digite naturalmente. Experimente:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {['Academia amanhã às 7, me avise 30 minutos antes', 'Marque reunião com a equipe sexta às 10h', 'Anote que preciso revisar meus objetivos do mês', 'Crie uma rotina de leitura todos os dias às 21h'].map((ex) => (
                    <button key={ex} onClick={() => jarvis.send(ex)} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:border-cyan/50 hover:text-cyan transition cursor-pointer">
                      “{ex}”
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* MEU DIA */}
        <motion.div {...fade(5)} className="xl:row-span-2">
          <Card interactive className="h-full">
            <CardHeader title="Meu dia" icon={<ListChecks className="h-4 w-4" />} action={<Link to="/tarefas" className="text-xs text-cyan hover:underline">ver tudo</Link>} />
            <div className="px-5 pb-5 space-y-4">
              <Stat label="Próximos compromissos" value={upcoming.length} />
              <ul className="space-y-1.5">
                {upcoming.slice(0, 3).map((e) => (
                  <li key={e.key} className="flex items-center gap-2 text-sm">
                    <span className="w-12 font-mono text-xs text-cyan">{e.event.all_day ? 'dia' : formatTimeSpoken(e.start, tz)}</span>
                    <span className="truncate">{e.event.title}</span>
                  </li>
                ))}
              </ul>
              <div className="h-px bg-line" />
              <p className="label-tech">Tarefas prioritárias</p>
              {snap?.pendingTasks.length ? (
                <ul className="space-y-1">
                  {snap.pendingTasks.slice(0, 5).map((t) => (
                    <li key={t.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-white/[0.03]">
                      <button onClick={() => completeTaskById(app.toolCtx('manual'), t)} className="h-4.5 w-4.5 shrink-0 rounded-md border border-cyan/50 hover:bg-cyan/20 cursor-pointer" aria-label={`Concluir ${t.title}`} />
                      <span className="flex-1 truncate text-sm">{t.title}</span>
                      {t.due_at && !t.all_day && <span className="font-mono text-[11px] text-muted">{formatTimeSpoken(t.due_at, tz)}</span>}
                      <PriorityBadge p={t.priority} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nenhuma tarefa pendente para hoje.</p>
              )}
              {Boolean(snap?.overdue.length) && (
                <Link to="/tarefas?view=overdue" className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">
                  <AlertTriangle className="h-4 w-4" /> {snap!.overdue.length} pendência(s) de dias anteriores
                </Link>
              )}
              <div className="h-px bg-line" />
              <p className="label-tech">Horários livres</p>
              {snap?.freeSlots.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {snap.freeSlots.slice(0, 4).map((s, i) => (
                    <span key={i} className="rounded-lg bg-success/10 px-2 py-1 font-mono text-[11px] text-success">
                      {formatTimeSpoken(s.start, tz)}–{formatTimeSpoken(s.end, tz)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Sem janelas livres até 20h.</p>
              )}
            </div>
          </Card>
        </motion.div>

        {/* MINHAS MISSÕES */}
        <motion.div {...fade(6)}>
          <Card interactive className="h-full">
            <CardHeader title="Minhas missões" icon={<Target className="h-4 w-4" />} />
            <div className="flex items-center gap-5 px-5 pb-5">
              <ProgressRing pct={pct} />
              <div className="min-w-0 space-y-1 text-sm">
                <p><span className="font-display text-2xl font-semibold">{done}</span><span className="text-muted"> de {total} tarefas de hoje</span></p>
                {snap?.routines.filter((r) => r.scheduledToday).length ? (
                  <p className="text-muted">Hábitos: {snap.routines.filter((r) => r.scheduledToday && r.doneToday).length}/{snap.routines.filter((r) => r.scheduledToday).length} feitos</p>
                ) : null}
                <p className="truncate text-muted">
                  Próxima: {nextItem ? <span className="text-ink">{nextItem.title} · {formatTimeSpoken(nextItem.at, tz)}</span> : 'nada agendado'}
                </p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* FOCO */}
        <motion.div {...fade(7)}>
          <Card interactive className="h-full">
            <CardHeader title="Foco" icon={<Zap className="h-4 w-4" />} subtitle={snap ? `${snap.focusMinutes} min de foco hoje` : undefined} />
            <div className="px-5 pb-5">
              {activeFocus.data?.[0] ? (
                <Link to="/foco" className="flex items-center justify-between rounded-xl border border-cyan/30 bg-cyan/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{activeFocus.data[0].title}</p>
                    <p className="text-xs text-muted">{Math.round(focusSeconds(activeFocus.data[0], now) / 60)} de {activeFocus.data[0].planned_minutes} min</p>
                  </div>
                  <span className="label-tech !text-cyan">em andamento</span>
                </Link>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[25, 45, 90].map((m) => (
                    <Button key={m} variant="outline" size="sm" onClick={async () => { await jarvis.send(`iniciar modo foco por ${m} minutos`); navigate('/foco'); }}>
                      <Play className="h-3.5 w-3.5" /> {m} min
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* AGENDA INTELIGENTE */}
        <motion.div {...fade(8)} className="md:col-span-2 xl:col-span-1">
          <Card interactive className="h-full">
            <CardHeader title="Agenda inteligente" icon={<CalendarClock className="h-4 w-4" />} action={<Link to="/agenda" className="text-xs text-cyan hover:underline">abrir</Link>} />
            <div className="px-5 pb-5">
              <Timeline now={now} tz={tz} items={[...(snap?.events.map((e) => ({ id: e.key, title: e.event.title, at: e.start, end: e.end, kind: 'event' as const })) ?? []), ...(snap?.tasks.filter((t) => t.due_at && !t.all_day).map((t) => ({ id: t.id, title: t.title, at: new Date(t.due_at!), end: null, kind: 'task' as const, done: t.status === 'done' })) ?? [])]} />
            </div>
          </Card>
        </motion.div>

        {/* CAPTURA RÁPIDA */}
        <motion.div {...fade(9)}>
          <Card interactive className="h-full">
            <CardHeader title="Captura rápida" icon={<Lightbulb className="h-4 w-4" />} />
            <div className="grid grid-cols-2 gap-2 px-5 pb-5">
              {[
                { label: 'Nota', icon: NotebookPen }, { label: 'Tarefa', icon: CheckSquare },
                { label: 'Ideia', icon: Lightbulb }, { label: 'Compromisso', icon: CalendarPlus },
              ].map((b) => (
                <button key={b.label} onClick={() => jarvis.openCapture()} className="flex items-center gap-2 rounded-xl border border-line px-3 py-3 text-sm text-muted hover:border-cyan/40 hover:text-ink hover:bg-cyan/5 transition cursor-pointer">
                  <b.icon className="h-4 w-4 text-cyan" /> {b.label}
                </button>
              ))}
              <button onClick={() => jarvis.startListening()} className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-cyan/10 px-3 py-2.5 text-sm text-cyan hover:bg-cyan/15 cursor-pointer">
                <Mic className="h-4 w-4" /> Falar agora
              </button>
            </div>
          </Card>
        </motion.div>

        {/* INSIGHTS (mobile) */}
        <motion.div {...fade(10)} className="lg:hidden">
          <Card className="h-full">
            <CardHeader title="Insights do JARVIS" icon={<Sparkles className="h-4 w-4" />} />
            <div className="px-5 pb-5">
              {briefing.data?.suggestions.length ? (
                <ul className="space-y-2 text-sm">{briefing.data.suggestions.map((s, i) => <li key={i}><span className="text-muted">Sugestão:</span> {s}</li>)}</ul>
              ) : (
                <EmptyState icon={<Sparkles className="h-5 w-5" />} title="Sem sugestões ainda" text="Registre tarefas e compromissos para receber recomendações." />
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="label-tech">{label}</span>
      <span className="font-display text-2xl font-semibold">{value}</span>
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0" role="img" aria-label={`${pct}% concluído`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="rgb(120 160 255 / 0.12)" strokeWidth="7" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="url(#ringG)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} transform="rotate(-90 44 44)" style={{ transition: 'stroke-dashoffset .8s ease' }} />
      <defs>
        <linearGradient id="ringG" x1="0" x2="1"><stop offset="0" stopColor="#008CFF" /><stop offset="1" stopColor="#00D9FF" /></linearGradient>
      </defs>
      <text x="44" y="49" textAnchor="middle" className="fill-ink font-display text-[15px] font-semibold">{pct}%</text>
    </svg>
  );
}

interface TLItem { id: string; title: string; at: Date; end: Date | null; kind: 'event' | 'task'; done?: boolean }

function Timeline({ items, now, tz }: { items: TLItem[]; now: Date; tz: string }) {
  const next = items.filter((i) => (i.end ?? i.at) >= new Date(now.getTime() - 30 * 60000)).sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 6);
  if (!next.length) return <EmptyState icon={<Clock className="h-5 w-5" />} title="Próximas horas livres" text="Nenhum compromisso ou tarefa com horário pelo resto do dia." />;
  return (
    <ol className="relative ml-2 border-l border-line pl-5 space-y-3">
      {next.map((i) => {
        const live = i.at <= now && (i.end ?? i.at) >= now;
        return (
          <li key={i.id} className="relative">
            <span className={cn('absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-void', live ? 'bg-success shadow-[0_0_10px_var(--color-success)]' : i.kind === 'event' ? 'bg-cyan' : 'bg-violet')} />
            <p className="font-mono text-[11px] text-muted">{formatTimeSpoken(i.at, tz)}{i.end ? `–${formatTimeSpoken(i.end, tz)}` : ''} · {i.kind === 'event' ? 'compromisso' : 'tarefa'}{live ? ' · agora' : ''}</p>
            <p className={cn('text-sm', i.done && 'line-through text-muted')}>{i.title}</p>
          </li>
        );
      })}
    </ol>
  );
}
