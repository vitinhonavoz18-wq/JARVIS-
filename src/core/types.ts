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

export type MemoryKind = 'semantic' | 'episodic' | 'procedural' | 'preference' | 'decision';

export interface UserMemory extends BaseRow {
  category: string;
  content: string;
  active: boolean;
  source: Source;
  /** Campos do Memory Engine (opcionais para compatibilidade com dados antigos/Modo Local). */
  kind?: MemoryKind;
  importance?: number;
  source_conversation_id?: string | null;
  superseded_by?: string | null;
  last_used_at?: string | null;
}

export interface MemoryHit {
  id: string;
  content: string;
  category: string;
  kind: MemoryKind;
  importance: number;
  source_conversation_id: string | null;
  updated_at: string;
  score: number;
}

export interface ConversationHit {
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  role: string;
  snippet: string;
  created_at: string;
}

export interface DecisionRecord extends BaseRow {
  decision: string;
  context: string | null;
  reason: string | null;
  expected_result: string | null;
  decided_at: string;
  review_at: string | null;
  outcome: string | null;
  status: 'open' | 'reviewed' | 'reverted';
  source_conversation_id: string | null;
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
  /** Conversa privada: o JARVIS não cria memórias nem a inclui nas buscas. */
  private?: boolean;
  summary?: string | null;
  pinned?: boolean;
  archived?: boolean;
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
  specialist?: string;
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

export type Risk = 'read' | 'reversible' | 'sensitive' | 'external' | 'destructive';

export interface AiSettings extends BaseRow {
  provider: 'auto' | 'openai' | 'anthropic';
  simple_model: string | null;
  complex_model: string | null;
  voice_model: string | null;
  response_style: 'objetivo' | 'detalhado' | 'executivo';
  daily_request_limit: number;
  monthly_budget_usd: number | null;
  web_search_enabled: boolean;
  fallback_enabled: boolean;
  model_prices: Record<string, { input_per_m: number; output_per_m: number }>;
}

export interface AiCall extends BaseRow {
  provider: string;
  model: string;
  specialist: string | null;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number | null;
  latency_ms: number | null;
  status: 'ok' | 'error' | 'fallback';
  error: string | null;
}

export type ProjectTemplateId = 'connectfly' | 'flydelivery' | 'farmacia_preco_bom' | 'tg_baterias' | 'sitecreatorfly' | 'custom';

export interface ConnectedProject extends BaseRow {
  name: string;
  template: ProjectTemplateId;
  connector_type: 'none' | 'http' | 'n8n';
  base_url: string | null;
  connection_id: string | null;
  scopes: string[];
  privacy_level: 'aggregated' | 'detailed';
  enabled: boolean;
  capabilities: { id: string; name: string; description: string; risk: Risk; scope: string }[];
  status: 'not_configured' | 'healthy' | 'degraded' | 'down' | 'unauthorized';
  status_detail: string | null;
  last_health_at: string | null;
}

export interface ProjectSnapshot extends BaseRow {
  project_id: string;
  capability: string;
  data: Record<string, unknown>;
  source: string;
  fetched_at: string;
}

export interface AutomationConnection extends BaseRow {
  kind: 'n8n';
  name: string;
  base_url: string;
  environment: 'production' | 'development';
  authorized_projects: string[];
  status: 'connected' | 'disconnected' | 'unauthorized' | 'unavailable' | 'misconfigured';
  status_detail: string | null;
  last_checked_at: string | null;
  last_sync_at: string | null;
}

export interface AutomationWorkflow extends BaseRow {
  connection_id: string;
  n8n_id: string;
  name: string;
  active: boolean;
  tags: string[];
  n8n_project_id: string | null;
  description: string | null;
  triggers: string[];
  webhook_paths: string[];
  last_execution_status: string | null;
  last_execution_at: string | null;
  synced_at: string;
}

export interface Automation extends BaseRow {
  connection_id: string;
  project_id: string | null;
  workflow_n8n_id: string | null;
  name: string;
  description: string | null;
  aliases: string[];
  category: string | null;
  webhook_url: string;
  auth_header_name: string | null;
  input_schema: { type: 'object'; properties: Record<string, { type?: string; description?: string; enum?: unknown[] }>; required?: string[] };
  risk: Risk;
  requires_confirmation: boolean;
  mode: 'async' | 'sync';
  timeout_seconds: number;
  enabled: boolean;
  is_shortcut: boolean;
  alert_on_failure: boolean;
  last_run_at: string | null;
}

export type RunStatus = 'queued' | 'requested' | 'started' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

export interface AutomationRun extends BaseRow {
  automation_id: string;
  status: RunStatus;
  correlation_id: string;
  idempotency_key: string | null;
  source: 'manual' | 'voice' | 'ai' | 'schedule' | 'shortcut';
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  output_summary: string | null;
  n8n_execution_id: string | null;
  error: string | null;
  attempts: number;
  next_attempt_at?: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  timeout_at: string | null;
}

export interface IntegrationEvent extends BaseRow {
  connection_id: string;
  event_id: string;
  event_type: string;
  schema_version: string;
  source: string;
  project_ref: string | null;
  workflow_id: string | null;
  correlation_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
  received_at: string;
}

export interface Alert extends BaseRow {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string | null;
  source: string;
  project_id: string | null;
  link: string | null;
  read_at: string | null;
}

export interface Goal extends BaseRow {
  title: string;
  project_label: string | null;
  metric: string | null;
  target: number | null;
  current: number;
  unit: string | null;
  due_date: string | null;
  status: 'active' | 'achieved' | 'paused' | 'dropped';
}

export interface Expense extends BaseRow {
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  spent_on: string;
  project_label: string | null;
}

export interface TableMap {
  ai_settings: AiSettings;
  ai_calls: AiCall;
  connected_projects: ConnectedProject;
  project_snapshots: ProjectSnapshot;
  automation_connections: AutomationConnection;
  automation_workflows: AutomationWorkflow;
  automations: Automation;
  automation_runs: AutomationRun;
  integration_events: IntegrationEvent;
  alerts: Alert;
  goals: Goal;
  expenses: Expense;
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
  decision_history: DecisionRecord;
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
