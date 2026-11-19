import type { TableMap, TableName } from '../types.ts';

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
  user_memories: { active: true, source: 'manual' },
  ai_action_logs: { result: null, idempotency_key: null, conversation_id: null },
  conversations: { title: 'Conversa', state: null },
  conversation_messages: { meta: null },
  device_tokens: { enabled: true },
};

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeText(s: string): string {
  return stripAccents(s).toLowerCase().trim();
}
