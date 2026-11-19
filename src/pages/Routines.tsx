import { useState } from 'react';
import { Plus, Repeat, Trash2, Flame } from 'lucide-react';
import type { Routine } from '@/core/types.ts';
import { useApp, useDerived } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useNow } from '@/lib/hooks.ts';
import { executeCall } from '@/core/agent/agent.ts';
import { routineProgress, weekBounds } from '@/core/agent/insights.ts';
import { addDaysLocal, localDateKey, localDateOf, WEEKDAYS_SHORT_PT, weekdayOfLocal } from '@/core/time.ts';
import { Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Spinner } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';

export default function Routines() {
  const app = useApp();
  const now = useNow(60_000);
  const today = localDateOf(now, app.prefs.timezone);
  const { from } = weekBounds(today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysLocal(from, i));
  const data = useDerived(['routines', localDateKey(today), app.version], async (repo) => {
    const prog = await routineProgress(repo, today);
    const logs = await repo.table('routine_logs').list({ gte: { date: localDateKey(from) }, lte: { date: localDateKey(days[6]) } });
    return { prog, logs };
  });
  const [creating, setCreating] = useState(false);

  const toggle = async (r: Routine, dateKey: string) => {
    const t = app.repo.table('routine_logs');
    const existing = data.data?.logs.find((l) => l.routine_id === r.id && l.date === dateKey);
    if (existing) await t.remove(existing.id);
    else await t.insert({ routine_id: r.id, date: dateKey });
  };

  return (
    <div>
      <PageHeader title="Rotinas e Hábitos" subtitle="Hábitos são contados separadamente das tarefas avulsas." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nova rotina</Button>} />
      {data.isLoading ? <div className="grid place-items-center py-20"><Spinner /></div> : data.data?.prog.length ? (
        <div className="space-y-3">
          {data.data.prog.map(({ routine: r, done, planned }) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[160px] flex-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted">{r.days.map((d) => WEEKDAYS_SHORT_PT[d]).join(', ')}{r.time ? ` · ${r.time.slice(0, 5)}` : ''}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs"><Flame className={cn('h-3.5 w-3.5', done >= planned ? 'text-success' : 'text-warn')} /> {done} de {planned} nesta semana</p>
                </div>
                <div className="flex gap-1.5">
                  {days.map((d) => {
                    const key = localDateKey(d);
                    const on = data.data!.logs.some((l) => l.routine_id === r.id && l.date === key);
                    const planned_ = r.days.includes(weekdayOfLocal(d));
                    const future = key > localDateKey(today);
                    return (
                      <button
                        key={key}
                        disabled={future}
                        onClick={() => toggle(r, key)}
                        aria-pressed={on}
                        aria-label={`${r.name} em ${WEEKDAYS_SHORT_PT[weekdayOfLocal(d)]} ${d.day}`}
                        className={cn('flex h-11 w-9 flex-col items-center justify-center rounded-lg border text-[10px] transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-30',
                          on ? 'border-success/60 bg-success/20 text-success' : planned_ ? 'border-cyan/30 text-muted hover:border-cyan/60' : 'border-line/50 text-muted/50')}
                      >
                        <span>{WEEKDAYS_SHORT_PT[weekdayOfLocal(d)]}</span>
                        <span className="font-semibold">{on ? '✓' : d.day}</span>
                      </button>
                    );
                  })}
                </div>
                <Button variant="ghost" size="icon" aria-label={`Desativar ${r.name}`} onClick={() => window.confirm(`Desativar a rotina “${r.name}”? O histórico é mantido.`) && app.repo.table('routines').update(r.id, { active: false })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-graphite"><div className="h-full rounded-full bg-gradient-to-r from-violet to-cyan" style={{ width: `${Math.min(100, (done / Math.max(1, planned)) * 100)}%` }} /></div>
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState icon={<Repeat className="h-5 w-5" />} title="Nenhuma rotina" text="Ex.: “Jarvis, crie uma rotina de academia segunda, quarta e sexta às 7h”." action={<Button variant="soft" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Criar rotina</Button>} /></Card>
      )}
      <RoutineDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function RoutineDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const app = useApp();
  const { toast } = useJarvis();
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [time, setTime] = useState('07:00');
  const save = async () => {
    const r = await executeCall(app.toolCtx('manual'), { tool: 'create_routine', input: { name, days, time: time || undefined } });
    toast({ title: r.message, tone: r.ok ? 'success' : 'error' });
    if (r.ok) {
      onOpenChange(false);
      setName('');
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nova rotina">
      <div className="space-y-4">
        <Field label="Nome"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Academia, Leitura, Revisão semanal" /></Field>
        <Field label="Dias">
          <div className="flex gap-1.5">
            {WEEKDAYS_SHORT_PT.map((d, i) => (
              <button key={i} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} className={cn('h-9 w-11 rounded-lg border text-xs cursor-pointer', days.includes(i) ? 'border-cyan/50 bg-cyan/15 text-cyan' : 'border-line text-muted')}>{d}</button>
            ))}
          </div>
        </Field>
        <Field label="Horário"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <div className="flex justify-end"><Button onClick={save} disabled={!name.trim() || !days.length}>Criar</Button></div>
      </div>
    </Dialog>
  );
}
