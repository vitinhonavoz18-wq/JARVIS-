import { Sun, Moon, BarChart3, Volume2 } from 'lucide-react';
import { useApp, useDerived } from '@/lib/app.tsx';
import { useNow } from '@/lib/hooks.ts';
import { buildBriefing, buildEveningReview } from '@/core/agent/tools.ts';
import { focusMinutesInRange, routineProgress, weekBounds } from '@/core/agent/insights.ts';
import { addDaysLocal, dayRangeUtc, localDateKey, localDateOf, WEEKDAYS_SHORT_PT, weekdayOfLocal } from '@/core/time.ts';
import { Card, CardHeader, PageHeader, Spinner, Button } from '@/components/ui/index.tsx';
import { speak } from '@/lib/voice.ts';

export default function Reports() {
  const app = useApp();
  const tz = app.prefs.timezone;
  const now = useNow(60_000);
  const today = localDateOf(now, tz);
  const key = localDateKey(today);
  const morning = useDerived(['morning', key, app.version], () => buildBriefing(app.toolCtx(), key));
  const evening = useDerived(['evening', key, app.version], () => buildEveningReview(app.toolCtx(), key));
  const week = useDerived(['week', key, app.version], async (repo) => {
    const { from } = weekBounds(today);
    const days = Array.from({ length: 7 }, (_, i) => addDaysLocal(from, i));
    const done = await repo.table('tasks').list({ eq: { status: 'done' }, isNull: ['deleted_at'], gte: { completed_at: dayRangeUtc(from, tz).start.toISOString() }, lt: { completed_at: dayRangeUtc(days[6], tz).end.toISOString() } });
    const perDay = await Promise.all(days.map(async (d) => ({
      d,
      tasks: done.filter((t) => localDateKey(localDateOf(new Date(t.completed_at!), tz)) === localDateKey(d)).length,
      focus: await focusMinutesInRange(repo, d, d, tz, now),
    })));
    return { perDay, routines: await routineProgress(repo, today) };
  });
  const maxTasks = Math.max(1, ...(week.data?.perDay.map((p) => p.tasks) ?? [1]));
  const maxFocus = Math.max(1, ...(week.data?.perDay.map((p) => p.focus) ?? [1]));

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Calculados a partir dos seus registros reais. Fatos e sugestões aparecem separados." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Morning Briefing" icon={<Sun className="h-4 w-4" />} action={morning.data && <Button variant="ghost" size="sm" onClick={() => speak([morning.data!.greeting, ...morning.data!.facts].join(' '), { rate: app.prefs.tts_rate, voice: app.prefs.tts_voice })}><Volume2 className="h-4 w-4" /></Button>} />
          <div className="px-5 pb-5">
            {morning.isLoading ? <Spinner /> : morning.data && <Report facts={[morning.data.greeting, ...morning.data.facts]} suggestions={morning.data.suggestions} />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Evening Review" icon={<Moon className="h-4 w-4" />} />
          <div className="px-5 pb-5">
            {evening.isLoading ? <Spinner /> : evening.data && <Report facts={evening.data.facts} suggestions={evening.data.suggestions} />}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Semana atual" icon={<BarChart3 className="h-4 w-4" />} subtitle="Tarefas concluídas e minutos de foco por dia" />
          <div className="px-5 pb-6">
            {week.isLoading ? <Spinner /> : (
              <>
                <div className="flex items-end gap-3 h-44" role="img" aria-label="Gráfico de tarefas concluídas e foco por dia">
                  {week.data!.perDay.map((p) => (
                    <div key={localDateKey(p.d)} className="flex flex-1 flex-col items-center gap-1.5">
                      <div className="flex h-36 w-full items-end justify-center gap-1">
                        <div className="w-1/3 max-w-5 rounded-t bg-gradient-to-t from-tech to-cyan transition-all" style={{ height: `${(p.tasks / maxTasks) * 100}%`, minHeight: p.tasks ? 4 : 0 }} title={`${p.tasks} tarefas`} />
                        <div className="w-1/3 max-w-5 rounded-t bg-gradient-to-t from-violet/60 to-violet transition-all" style={{ height: `${(p.focus / maxFocus) * 100}%`, minHeight: p.focus ? 4 : 0 }} title={`${p.focus} min de foco`} />
                      </div>
                      <span className={localDateKey(p.d) === key ? 'text-xs text-cyan' : 'text-xs text-muted'}>{WEEKDAYS_SHORT_PT[weekdayOfLocal(p.d)]}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-cyan" /> Tarefas ({week.data!.perDay.reduce((a, p) => a + p.tasks, 0)})</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-violet" /> Foco ({week.data!.perDay.reduce((a, p) => a + p.focus, 0)} min)</span>
                </div>
                {week.data!.routines.length > 0 && (
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {week.data!.routines.map((r) => (
                      <p key={r.routine.id} className="text-sm">Você completou <b>{r.done}</b> de <b>{r.planned}</b> sessões de <b>{r.routine.name}</b> planejadas nesta semana.</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Report({ facts, suggestions }: { facts: string[]; suggestions: string[] }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="label-tech mb-1.5">Fatos (dos seus registros)</p>
        <ul className="space-y-1">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </div>
      {suggestions.length > 0 && (
        <div>
          <p className="label-tech mb-1.5 !text-violet">Sugestões do JARVIS</p>
          <ul className="space-y-1">{suggestions.map((s, i) => <li key={i} className="text-muted">› {s}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
