/**
 * Especialistas do JARVIS — roteamento lógico, sem chamadas extras de IA.
 * O especialista só ajusta as instruções e a complexidade (modelo simples x avançado).
 */
import { normalizeText } from '../data/repo.ts';
import type { ParseResult } from './nlu.ts';

export interface Specialist {
  id: 'core' | 'executive' | 'analyst' | 'automation' | 'developer' | 'personal';
  name: string;
  prompt: string;
  complexity: 'simple' | 'complex';
}

export const SPECIALISTS: Record<Specialist['id'], Specialist> = {
  core: { id: 'core', name: 'JARVIS Core', complexity: 'simple', prompt: 'Assistente principal. Interprete o pedido, use as ferramentas certas e responda de forma unificada.' },
  executive: { id: 'executive', name: 'JARVIS Executive', complexity: 'simple', prompt: 'Especialista em produtividade e gestão: prioridades, agenda, pendências e resumos executivos curtos e acionáveis.' },
  analyst: { id: 'analyst', name: 'JARVIS Analyst', complexity: 'complex', prompt: 'Especialista em análise de dados: compare períodos, aponte variações e tendências, cite fonte e horário de cada número e separe fatos de interpretações.' },
  automation: { id: 'automation', name: 'JARVIS Automation', complexity: 'simple', prompt: 'Especialista em n8n: identifique a automação registrada correta, acompanhe status reais de execução e proponha melhorias. Nunca diga que concluiu sem status “concluída”.' },
  developer: { id: 'developer', name: 'JARVIS Developer', complexity: 'complex', prompt: 'Especialista em projetos de software: organize tarefas técnicas, bugs, documentação e planejamento de funcionalidades em etapas claras.' },
  personal: { id: 'personal', name: 'JARVIS Personal', complexity: 'simple', prompt: 'Especialista em rotina pessoal: hábitos, estudos, anotações, compromissos e lembretes, com tom próximo e encorajador.' },
};

const TOOL_SPECIALIST: Record<string, Specialist['id']> = {
  run_automation: 'automation', list_automations: 'automation', list_failed_workflows: 'automation', get_workflow_execution_status: 'automation', create_automation: 'automation',
  get_business_metrics: 'analyst', project_query: 'analyst', generate_weekly_report: 'analyst', get_productivity_summary: 'analyst',
  business_briefing: 'executive', get_pending_radar: 'executive', plan_day: 'executive', generate_daily_briefing: 'executive', list_tasks: 'executive', get_agenda: 'executive',
  create_routine: 'personal', log_routine: 'personal', create_note: 'personal', start_focus_session: 'personal', remember_preference: 'personal',
};

export function routeSpecialist(text: string, parsed?: ParseResult | null): Specialist {
  if (parsed?.kind === 'calls' && parsed.calls[0]) {
    const id = TOOL_SPECIALIST[parsed.calls[0].tool];
    if (id) return SPECIALISTS[id];
  }
  if (parsed?.kind === 'special') {
    const id = TOOL_SPECIALIST[parsed.special.action];
    if (id) return SPECIALISTS[id];
  }
  const n = normalizeText(text);
  if (/(n8n|automac|workflow|fluxo|webhook)/.test(n)) return SPECIALISTS.automation;
  if (/(bug|deploy|codigo|api|repositorio|funcionalidade|sprint|backlog|refator|banco de dados)/.test(n)) return SPECIALISTS.developer;
  if (/(compar|indicador|metrica|analis|relatorio|vendas|faturamento|tendencia|conversao|estoque)/.test(n)) return SPECIALISTS.analyst;
  if (/(prioridad|agenda|reuni|pendenc|briefing|empresa|cliente|equipe)/.test(n)) return SPECIALISTS.executive;
  if (/(habito|academia|treino|estud|leitura|ideia|pessoal|familia|saude)/.test(n)) return SPECIALISTS.personal;
  return SPECIALISTS.core;
}
