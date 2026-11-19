/** Tipos do domínio — espelham as tabelas do banco (snake_case). */

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type Source = 'manual' | 'ai' | 'voice' | 'capture';

export interface BaseRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Task extends BaseRow {
  title: string;
  description: string | null;
  category: string | null;
  priority: Priority;
  status: TaskStatus;
  due_at: string | null;
  all_day: boolean;
  project_id: string | null;
  recurrence: string | null; // RRULE simplificada: FREQ=WEEKLY;BYDAY=MO,WE,FR
  series_id: string | null;
  notes: string | null;
  position: number;
  completed_at: string | null;
  deleted_at: string | null;
  source: Source;
}

export interface Subtask extends BaseRow {
  task_id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface Note extends BaseRow {
  title: string;
  content: string; // HTML do editor
  content_text: string; // texto puro (busca)
  folder: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  project_id: string | null;
  deleted_at: string | null;
  source: Source;
}

export interface NoteVersion extends BaseRow {
  note_id: string;
  title: string;
  content: string;
}

export interface CalendarEvent extends BaseRow {
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  participants: string[];
  recurrence: string | null;
  recurrence_exdates: string[]; // datas locais (YYYY-MM-DD) removidas da série
  series_id: string | null;
  project_id: string | null;
  external_id: string | null;
  deleted_at: string | null;
  source: Source;
}

export type ReminderStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
export type EntityType = 'task' | 'event' | 'note' | 'routine' | 'custom';

export interface Reminder extends BaseRow {
  entity_type: EntityType;
  entity_id: string | null;
  title: string;
  body: string | null;
  remind_at: string;
  status: ReminderStatus;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'done' | 'archived';

export interface Project extends BaseRow {
  name: string;
  description: string | null;
  objective: string | null;
  status: ProjectStatus;
  priority: Priority;
  due_date: string | null; // YYYY-MM-DD
  color: string | null;
  deleted_at: string | null;
}

export interface Routine extends BaseRow {
  name: string;
  description: string | null;
  category: string | null;
  days: number[]; // 0=dom ... 6=sáb
  time: string | null; // HH:MM
  target_per_week: number;
  reminder_enabled: boolean;
  active: boolean;
}

export interface RoutineLog extends BaseRow {
  routine_id: string;
  date: string; // YYYY-MM-DD local
}

export type FocusStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface FocusSession extends BaseRow {
  title: string;
  task_id: string | null;
  project_id: string | null;
  planned_minutes: number;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  status: FocusStatus;
}

export interface UserMemory extends BaseRow {
  category: string;
  content: string;
  active: boolean;
  source: Source;
}

export type ActionStatus = 'success' | 'error' | 'pending_confirmation' | 'cancelled';

export interface AiActionLog extends BaseRow {
  tool: string;
  input: unknown;
  result: unknown;
  status: ActionStatus;
  idempotency_key: string | null;
  conversation_id: string | null;
}

export interface Conversation extends BaseRow {
  title: string;
  state: ConversationState | null;
}

export interface ConversationState {
  pending?: PendingClarification | null;
  proposal?: Proposal | null;
}

export interface PendingClarification {
  intent: 'create_event' | 'create_task' | 'create_reminder';
  missing: 'date' | 'time' | 'title';
  draft: Record<string, unknown>;
  question: string;
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface Proposal {
  id: string;
  summary: string;
  items: string[];
  calls: ToolCall[];
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage extends BaseRow {
  conversation_id: string;
  role: MessageRole;
  content: string;
  meta: MessageMeta | null;
}

export interface MessageMeta {
  actions?: { tool: string; ok: boolean; summary: string; link?: string }[];
  proposal?: Proposal | null;
  via?: 'local' | 'ai';
  error?: boolean;
}

export interface DeviceToken extends BaseRow {
  platform: 'web' | 'android' | 'ios';
  token: string; // subscription JSON (web) ou token FCM/APNs
  enabled: boolean;
  last_seen_at: string;
}

export interface UserPreferences extends BaseRow {
  display_name: string;
  assistant_name: string;
  timezone: string;
  locale: string;
  voice_enabled: boolean;
  wake_word_enabled: boolean;
  tts_enabled: boolean;
  tts_voice: string | null;
  tts_rate: number;
  memory_enabled: boolean;
  memory_categories: string[];
  quiet_hours_start: string | null; // HH:MM
  quiet_hours_end: string | null;
  default_reminder_minutes: number;
  morning_briefing: boolean;
  push_enabled: boolean;
  accent: string;
  history_retention_days: number;
}

export interface TaskHistory extends BaseRow {
  task_id: string;
  changes: Record<string, { de: unknown; para: unknown }>;
}

export interface TableMap {
  task_history: TaskHistory;
  tasks: Task;
  task_subtasks: Subtask;
  notes: Note;
  note_versions: NoteVersion;
  calendar_events: CalendarEvent;
  reminders: Reminder;
  projects: Project;
  routines: Routine;
  routine_logs: RoutineLog;
  focus_sessions: FocusSession;
  user_memories: UserMemory;
  ai_action_logs: AiActionLog;
  conversations: Conversation;
  conversation_messages: ConversationMessage;
  device_tokens: DeviceToken;
  user_preferences: UserPreferences;
}

export type TableName = keyof TableMap;

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};
export const PRIORITY_WEIGHT: Record<Priority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
