import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Sparkles, Cpu, ArrowUpRight } from 'lucide-react';
import type { ConversationMessage } from '@/core/types.ts';
import { useJarvis } from '@/lib/jarvis.tsx';
import { Button } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';
import { formatTime } from '@/core/time.ts';
import { useApp } from '@/lib/app.tsx';
import { SPECIALISTS } from '@/core/agent/specialists.ts';

export function ChatMessage({ msg, isLast }: { msg: ConversationMessage; isLast: boolean }) {
  const { confirmProposal, cancelProposal, busy } = useJarvis();
  const { prefs } = useApp();
  const mine = msg.role === 'user';
  const meta = msg.meta;
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[88%] md:max-w-[75%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed', mine ? 'bg-gradient-to-br from-tech/25 to-cyan/15 border border-cyan/25 rounded-br-md' : 'glass rounded-bl-md', meta?.error && 'border-danger/40')}>
        {!mine && (
          <div className="mb-1 flex items-center gap-2 label-tech !text-[0.6rem]">
            {meta?.via === 'ai' ? <Sparkles className="h-3 w-3 text-violet" /> : <Cpu className="h-3 w-3 text-cyan" />}
            {prefs.assistant_name} · {meta?.via === 'ai' ? 'IA' : 'processamento local'}{meta?.specialist && meta.specialist !== 'core' ? ` · ${SPECIALISTS[meta.specialist as keyof typeof SPECIALISTS]?.name ?? meta.specialist}` : ''}
          </div>
        )}
        <p className="whitespace-pre-line">{msg.content}</p>
        {meta?.actions && meta.actions.length > 0 && (
          <ul className="mt-2.5 space-y-1.5">
            {meta.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                {a.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />}
                <span className="text-muted">{labelFor(a.tool)}</span>
                {a.link && (
                  <Link to={a.link} className="ml-auto inline-flex items-center gap-0.5 text-cyan hover:underline">
                    abrir <ArrowUpRight className="h-3 w-3" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {meta?.proposal && (
          <div className="mt-3 rounded-xl border border-cyan/25 bg-cyan/5 p-3">
            <ul className="space-y-1 text-sm">
              {meta.proposal.items.map((it, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-cyan">›</span>
                  {it}
                </li>
              ))}
            </ul>
            {isLast && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={confirmProposal} loading={busy}>
                  Confirmar
                </Button>
                <Button size="sm" variant="outline" onClick={cancelProposal} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        )}
        <p className="mt-1.5 text-right text-[10px] text-muted/70">{formatTime(msg.created_at, prefs.timezone)}</p>
      </div>
    </div>
  );
}

function labelFor(tool: string) {
  const map: Record<string, string> = {
    create_task: 'Tarefa salva', update_task: 'Tarefa atualizada', complete_task: 'Tarefa concluída', delete_task: 'Tarefa excluída',
    reschedule_task: 'Tarefa remarcada', execute_approved_workflow: 'Automação solicitada', register_expense: 'Despesa registrada', create_follow_up: 'Follow-up agendado',
    create_internal_alert: 'Alerta criado', get_business_metrics: 'Consulta ao projeto', get_project_status: 'Status do projeto', list_automations: 'Automações consultadas',
    get_workflow_execution_status: 'Status da automação', list_failed_workflows: 'Falhas consultadas', business_briefing: 'Briefing empresarial', get_pending_radar: 'Radar de pendências',
    generate_weekly_report: 'Relatório semanal', plan_day: 'Planejamento do dia', search_customer_records: 'Consulta de clientes', list_connected_projects: 'Projetos consultados', update_goal: 'Meta atualizada', create_automation_draft: 'Rascunho criado no n8n', reschedule_item: 'Item remarcado', create_note: 'Nota salva', update_note: 'Nota atualizada',
    create_event: 'Compromisso salvo', update_event: 'Compromisso atualizado', delete_event: 'Compromisso removido', create_reminder: 'Lembrete agendado',
    cancel_reminder: 'Lembrete cancelado', create_project: 'Projeto criado', add_project_tasks: 'Etapas adicionadas', create_routine: 'Rotina criada',
    log_routine: 'Hábito registrado', start_focus_session: 'Foco iniciado', stop_focus_session: 'Foco encerrado', remember_preference: 'Preferência guardada',
  };
  return map[tool] ?? tool;
}
