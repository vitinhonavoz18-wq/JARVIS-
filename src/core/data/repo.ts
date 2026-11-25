import type { ConversationHit, MemoryHit, TableMap, TableName } from '../types.ts';

/** Filtro simples e portátil — implementado tanto no modo local quanto no Supabase. */
export interface Query<T> {
  eq?: Partial<Record<keyof T, string | number | boolean | null>>;
  in?: Partial<Record<keyof T, (string | number)[]>>;
  gte?: Partial<Record<keyof T, string | number>>;
  lt?: Partial<Record<keyof T, string | number>>;
  lte?: Partial<Record<keyof T, string | number>>;
  isNull?: (keyof T)[];
  notNull?: (keyof T)[];
  /** Busca textual (case-insensitive, sem acento no modo local) em vários campos. */
  search?: { fields: (keyof T)[]; q: string };
  order?: { field: keyof T; asc?: boolean }[];
  limit?: number;
}

export type Insert<T> = Omit<T, 'id' | 'user_id' | 'created_at' | 'updated_at'> & { id?: string };

export interface Table<T> {
  list(q?: Query<T>): Promise<T[]>;
  get(id: string): Promise<T | null>;
  insert(row: Partial<Insert<T>>): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

export interface Repo {
  readonly mode: 'local' | 'cloud';
  readonly userId: string;
  table<K extends TableName>(name: K): Table<TableMap[K]>;
  /** Busca híbrida das memórias relevantes (top-k). */
  searchMemories(query: string, limit?: number): Promise<MemoryHit[]>;
  /** Busca no histórico de conversas (exceto as privadas). */
  searchConversations(query: string, limit?: number): Promise<ConversationHit[]>;
}

/** Valores padrão por tabela — garantem linhas completas também no modo local. */
export const DEFAULTS: { [K in TableName]?: Partial<TableMap[K]> } = {
  tasks: {
    description: null, category: null, priority: 'medium', status: 'todo', due_at: null, all_day: false,
    project_id: null, recurrence: null, series_id: null, notes: null, position: 0, completed_at: null,
    deleted_at: null, source: 'manual',
  },
  task_subtasks: { done: false, position: 0 },
  notes: {
    title: '', content: '', content_text: '', folder: null, tags: [], pinned: false, favorite: false,
    project_id: null, deleted_at: null, source: 'manual',
  },
  calendar_events: {
    description: null, all_day: false, location: null, participants: [], recurrence: null, recurrence_exdates: [], series_id: null, project_id: null,
    external_id: null, deleted_at: null, source: 'manual',
  },
  reminders: { entity_type: 'custom', entity_id: null, body: null, status: 'pending', attempts: 0, last_error: null, sent_at: null },
  projects: { description: null, objective: null, status: 'active', priority: 'medium', due_date: null, color: null, deleted_at: null },
  routines: { description: null, category: null, days: [], time: null, target_per_week: 3, reminder_enabled: true, active: true },
  focus_sessions: { task_id: null, project_id: null, ended_at: null, paused_at: null, paused_seconds: 0, status: 'active' },
  user_memories: { active: true, source: 'manual', kind: 'semantic', importance: 3, source_conversation_id: null, superseded_by: null, last_used_at: null },
  decision_history: { context: null, reason: null, expected_result: null, review_at: null, outcome: null, status: 'open', source_conversation_id: null },
  ai_action_logs: { result: null, idempotency_key: null, conversation_id: null },
  conversations: { title: 'Conversa', state: null, private: false, summary: null, pinned: false, archived: false },
  conversation_messages: { meta: null },
  device_tokens: { enabled: true },
  ai_settings: { provider: 'auto', simple_model: null, complex_model: null, voice_model: null, response_style: 'objetivo', daily_request_limit: 300, monthly_budget_usd: null, web_search_enabled: false, fallback_enabled: true, model_prices: {} },
  connected_projects: { template: 'custom', connector_type: 'none', base_url: null, connection_id: null, scopes: ['metrics:read', 'alerts:read'], privacy_level: 'aggregated', enabled: true, capabilities: [], status: 'not_configured', status_detail: null, last_health_at: null },
  automations: { project_id: null, workflow_n8n_id: null, description: null, aliases: [], category: null, auth_header_name: null, input_schema: { type: 'object', properties: {} }, risk: 'external', requires_confirmation: true, mode: 'async', timeout_seconds: 900, enabled: true, is_shortcut: false, alert_on_failure: true, last_run_at: null },
  automation_runs: { status: 'queued', idempotency_key: null, source: 'manual', input: {}, output: null, output_summary: null, n8n_execution_id: null, error: null, attempts: 0, started_at: null, finished_at: null, timeout_at: null },
  alerts: { severity: 'info', body: null, source: 'jarvis', project_id: null, link: null, read_at: null },
  goals: { project_label: null, metric: null, target: null, current: 0, unit: null, due_date: null, status: 'active' },
  expenses: { currency: 'BRL', category: 'Geral', description: null, project_label: null },
};

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeText(s: string): string {
  return stripAccents(s).toLowerCase().trim();
}
