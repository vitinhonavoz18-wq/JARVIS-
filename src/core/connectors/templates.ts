/** Modelos de conexão para os projetos do ecossistema Connectfly (nenhum é conectado automaticamente). */
import type { Capability } from './types.ts';

export interface ProjectTemplate {
  id: 'connectfly' | 'flydelivery' | 'farmacia_preco_bom' | 'tg_baterias' | 'sitecreatorfly' | 'custom';
  name: string;
  description: string;
  privacyNote: string;
  suggestedCapabilities: Capability[];
  examples: string[];
}

const metrics = (desc: string): Capability => ({ id: 'metrics.summary', name: 'Indicadores', description: desc, risk: 'read', scope: 'metrics:read', aggregatedOnly: true });
const alerts: Capability = { id: 'alerts.list', name: 'Alertas operacionais', description: 'Falhas e avisos recentes.', risk: 'read', scope: 'alerts:read', aggregatedOnly: true };
const pending: Capability = { id: 'tasks.pending', name: 'Pendências', description: 'Tarefas e pendências abertas da equipe.', risk: 'read', scope: 'tasks:read' };
const createTask: Capability = { id: 'tasks.create', name: 'Criar tarefa interna', description: 'Cria uma tarefa interna no sistema do projeto.', risk: 'reversible', scope: 'tasks:write' };

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'connectfly', name: 'Connectfly', description: 'Projetos ativos, status operacional, leads e indicadores comerciais.',
    privacyNote: 'Somente totais de leads e indicadores; dados de contato ficam no sistema de origem.',
    suggestedCapabilities: [metrics('Projetos ativos, leads do período e indicadores comerciais.'), alerts, pending, createTask],
    examples: ['Jarvis, me mostre as prioridades da Connectfly hoje.'],
  },
  {
    id: 'flydelivery', name: 'FlyDelivery', description: 'Empresas ativas, cadastros, pedidos por período, erros e integrações.',
    privacyNote: 'Apenas dados agregados. Nada de dados de estabelecimentos individuais ou consumidores.',
    suggestedCapabilities: [
      metrics('Empresas ativas, novos cadastros, pedidos e conversão por período.'),
      { id: 'metrics.compare', name: 'Comparar períodos', description: 'Compara indicadores entre dois períodos.', risk: 'read', scope: 'metrics:read', aggregatedOnly: true, inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['week', 'month'] } } } },
      { id: 'integrations.status', name: 'Status das integrações', description: 'Integrações com erro.', risk: 'read', scope: 'alerts:read', aggregatedOnly: true },
      alerts,
    ],
    examples: ['Jarvis, quantas empresas estão ativas no FlyDelivery?', 'Jarvis, compare os indicadores desta semana com a anterior.'],
  },
  {
    id: 'farmacia_preco_bom', name: 'Farmácia Preço Bom', description: 'Indicadores do CRM, tarefas da equipe, campanhas e metas.',
    privacyNote: 'Nunca envia dados de saúde ou pessoais de clientes à IA. Disparos promocionais não são feitos pelo JARVIS.',
    suggestedCapabilities: [metrics('Indicadores do CRM e de vendas (agregados).'), pending, createTask, alerts],
    examples: ['Jarvis, me mostre as atividades pendentes da Farmácia Preço Bom.'],
  },
  {
    id: 'tg_baterias', name: 'TG Baterias', description: 'Vendas, estoque, produtos com estoque baixo e leads.',
    privacyNote: 'Somente dados de produtos e totais; sem dados pessoais de clientes.',
    suggestedCapabilities: [
      metrics('Vendas e leads do período.'),
      { id: 'stock.low', name: 'Estoque baixo', description: 'Produtos abaixo do estoque mínimo.', risk: 'read', scope: 'stock:read', aggregatedOnly: true },
      alerts,
    ],
    examples: ['Jarvis, quais baterias estão com estoque baixo?'],
  },
  {
    id: 'sitecreatorfly', name: 'SiteCreatorFly', description: 'Sites e landing pages publicados, status e alertas.',
    privacyNote: 'Somente metadados dos sites.',
    suggestedCapabilities: [metrics('Sites publicados, em produção e pendentes.'), alerts],
    examples: ['Jarvis, algum site está fora do ar?'],
  },
  {
    id: 'custom', name: 'Outro projeto', description: 'Qualquer aplicativo que implemente o Jarvis Connector Protocol ou envie eventos pelo n8n.',
    privacyNote: 'Defina somente as capacidades necessárias.', suggestedCapabilities: [metrics('Indicadores principais.'), alerts], examples: [],
  },
];
