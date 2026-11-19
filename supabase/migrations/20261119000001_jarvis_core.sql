-- =====================================================================
-- J.A.R.V.I.S. FV — Esquema principal
-- Cada linha pertence a um usuário (user_id). O isolamento é garantido
-- por RLS (auth.uid()) + chaves estrangeiras compostas (id, user_id),
-- que impedem vincular um registro a um item de outro usuário.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Preferências (também funciona como perfil do usuário)
-- ---------------------------------------------------------------------
create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null default 'Franklin' check (char_length(display_name) <= 80),
  assistant_name text not null default 'JARVIS' check (char_length(assistant_name) <= 40),
  avatar_url text,
  timezone text not null default 'America/Bahia',
  locale text not null default 'pt-BR',
  voice_enabled boolean not null default true,
  wake_word_enabled boolean not null default false,
  tts_enabled boolean not null default true,
  tts_voice text,
  tts_rate real not null default 1 check (tts_rate between 0.5 and 2),
  memory_enabled boolean not null default true,
  memory_categories text[] not null default '{}',
  quiet_hours_start time,
  quiet_hours_end time,
  default_reminder_minutes int not null default 15 check (default_reminder_minutes between 0 and 10080),
  morning_briefing boolean not null default true,
  push_enabled boolean not null default false,
  accent text not null default 'cyan',
  history_retention_days int not null default 180 check (history_retention_days between 1 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  objective text,
  status text not null default 'active' check (status in ('planning', 'active', 'paused', 'done', 'archived')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date date,
  color text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index projects_user_idx on public.projects (user_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Tarefas
-- ---------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  category text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  due_at timestamptz,
  all_day boolean not null default false,
  project_id uuid,
  recurrence text check (recurrence is null or recurrence ~ '^FREQ=(DAILY|WEEKLY|MONTHLY)'),
  series_id uuid,
  notes text,
  position int not null default 0,
  completed_at timestamptz,
  deleted_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'ai', 'voice', 'capture')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id)
);
create index tasks_user_due_idx on public.tasks (user_id, due_at) where deleted_at is null;
create index tasks_user_status_idx on public.tasks (user_id, status) where deleted_at is null;
create index tasks_project_idx on public.tasks (project_id) where project_id is not null;
create index tasks_series_idx on public.tasks (series_id) where series_id is not null;
create index tasks_title_trgm on public.tasks using gin (title extensions.gin_trgm_ops);

create table public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  done boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);
create index task_subtasks_task_idx on public.task_subtasks (task_id);

-- Histórico de modificações das tarefas (preenchido por gatilho)
create table public.task_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null,
  changes jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);
create index task_history_task_idx on public.task_history (task_id, created_at desc);

create or replace function public.log_task_change()
returns trigger language plpgsql set search_path = '' as $$
declare
  diff jsonb;
begin
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('de', o.value, 'para', n.value)), '{}'::jsonb)
    into diff
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value
     and n.key not in ('updated_at', 'position');
  if diff <> '{}'::jsonb then
    insert into public.task_history (user_id, task_id, changes) values (new.user_id, new.id, diff);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Anotações + versões
-- ---------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 200),
  content text not null default '' check (char_length(content) <= 200000),
  content_text text not null default '' check (char_length(content_text) <= 100000),
  folder text,
  -- Etiquetas como array: evita uma tabela note_tags extra, com índice GIN para filtro.
  tags text[] not null default '{}',
  pinned boolean not null default false,
  favorite boolean not null default false,
  project_id uuid,
  deleted_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'ai', 'voice', 'capture')),
  search tsvector generated always as (
    to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content_text, '') || ' ' || coalesce(folder, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id)
);
create index notes_user_idx on public.notes (user_id, updated_at desc) where deleted_at is null;
create index notes_search_idx on public.notes using gin (search);
create index notes_tags_idx on public.notes using gin (tags);
create index notes_text_trgm on public.notes using gin (content_text extensions.gin_trgm_ops);

create table public.note_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete cascade
);
create index note_versions_note_idx on public.note_versions (note_id, created_at desc);

create or replace function public.snapshot_note_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.content is distinct from new.content or old.title is distinct from new.title)
     -- No máximo uma versão a cada 5 minutos durante a edição contínua.
     and not exists (
       select 1 from public.note_versions v
        where v.note_id = old.id and v.created_at > now() - interval '5 minutes'
     ) then
    insert into public.note_versions (user_id, note_id, title, content)
    values (old.user_id, old.id, old.title, old.content);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  participants text[] not null default '{}',
  recurrence text check (recurrence is null or recurrence ~ '^FREQ=(DAILY|WEEKLY|MONTHLY)'),
  recurrence_exdates text[] not null default '{}',
  series_id uuid,
  project_id uuid,
  external_id text,
  deleted_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'ai', 'voice', 'capture')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id)
);
create index calendar_events_range_idx on public.calendar_events (user_id, start_at, end_at) where deleted_at is null;
create index calendar_events_recurring_idx on public.calendar_events (user_id) where recurrence is not null and deleted_at is null;
-- Evita duplicar eventos importados (ex.: Google Calendar).
create unique index calendar_events_external_uidx on public.calendar_events (user_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- Lembretes (fila persistente processada pelo servidor)
-- ---------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_type text not null default 'custom' check (entity_type in ('task', 'event', 'note', 'routine', 'custom')),
  entity_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  body text,
  remind_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index reminders_due_idx on public.reminders (remind_at) where status = 'pending';
create index reminders_user_idx on public.reminders (user_id, remind_at);
create index reminders_entity_idx on public.reminders (entity_id) where entity_id is not null;
-- Proteção contra lembretes duplicados para o mesmo item e horário.
create unique index reminders_entity_time_uidx on public.reminders (user_id, entity_id, remind_at)
  where entity_id is not null and status in ('pending', 'processing');

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('web', 'android', 'ios')),
  token text not null check (char_length(token) <= 4000),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token),
  unique (id, user_id)
);

create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reminder_id uuid not null,
  device_token_id uuid,
  channel text not null check (channel in ('web_push', 'fcm', 'apns', 'in_app')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (reminder_id, user_id) references public.reminders (id, user_id) on delete cascade,
  foreign key (device_token_id) references public.device_tokens (id) on delete set null,
  -- Idempotência: um envio bem-sucedido por lembrete e aparelho.
  unique (reminder_id, device_token_id, status)
);

-- ---------------------------------------------------------------------
-- Rotinas, foco
-- ---------------------------------------------------------------------
create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  category text,
  days smallint[] not null default '{}' check (days <@ array[0,1,2,3,4,5,6]::smallint[]),
  time time,
  target_per_week int not null default 3 check (target_per_week between 1 and 21),
  reminder_enabled boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  routine_id uuid not null,
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (routine_id, user_id) references public.routines (id, user_id) on delete cascade,
  unique (routine_id, date)
);

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  task_id uuid,
  project_id uuid,
  planned_minutes int not null check (planned_minutes between 1 and 600),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  paused_at timestamptz,
  paused_seconds int not null default 0,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id)
);
create index focus_sessions_user_idx on public.focus_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------
-- Conversas, memória, auditoria da IA
-- ---------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Conversa',
  state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (char_length(content) <= 20000),
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade
);
create index conversation_messages_conv_idx on public.conversation_messages (conversation_id, created_at);

create table public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null,
  content text not null check (char_length(content) between 3 and 500),
  active boolean not null default true,
  source text not null default 'manual' check (source in ('manual', 'ai', 'voice', 'capture')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tool text not null,
  input jsonb,
  result jsonb,
  status text not null check (status in ('success', 'error', 'pending_confirmation', 'cancelled')),
  idempotency_key text,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_action_logs_user_idx on public.ai_action_logs (user_id, created_at desc);
create unique index ai_action_logs_idem_uidx on public.ai_action_logs (user_id, idempotency_key)
  where idempotency_key is not null and status = 'success';

-- Consumo de IA (para limites de uso). Escrita somente pelo servidor.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consent_type text not null check (consent_type in ('microphone', 'wake_word', 'memory', 'push', 'ai_processing', 'calendar_sync')),
  granted boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_type text not null check (entity_type in ('task', 'note', 'project', 'event')),
  entity_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null check (mime_type ~ '^(image/(png|jpeg|webp|gif)|application/pdf|text/plain|audio/(webm|mp4|mpeg|ogg))$'),
  size_bytes int not null check (size_bytes between 1 and 20971520),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Integrações externas (ex.: Google Calendar). Tokens NÃO ficam aqui:
-- são guardados no Supabase Vault e só o servidor tem acesso.
create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'gmail')),
  account_email text,
  scopes text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked', 'error')),
  vault_secret_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_preferences','projects','tasks','task_subtasks','notes','calendar_events','reminders','device_tokens',
    'routines','focus_sessions','conversations','user_memories','connected_accounts'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

create trigger tasks_history after update on public.tasks for each row execute function public.log_task_change();
create trigger notes_versions before update on public.notes for each row execute function public.snapshot_note_version();

-- Cria as preferências automaticamente no cadastro.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_preferences (user_id, display_name)
  values (new.id, coalesce(nullif(left(new.raw_user_meta_data ->> 'name', 80), ''), split_part(new.email, '@', 1), 'Usuário'))
  on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- RLS + permissões explícitas (o Data API só expõe o que tem GRANT)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_preferences','projects','tasks','task_subtasks','notes','calendar_events','reminders','device_tokens',
    'routines','routine_logs','focus_sessions','conversations','conversation_messages','user_memories',
    'ai_action_logs','consent_records','attachments','connected_accounts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;

  -- Tabelas que o usuário apenas lê (escritas por gatilho ou servidor).
  foreach t in array array['task_history','note_versions','reminder_deliveries','ai_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
  end loop;
end $$;

-- Gatilhos de histórico precisam inserir em tabelas somente-leitura.
alter function public.log_task_change() security definer;
alter function public.snapshot_note_version() security definer;
revoke all on function public.log_task_change() from public, anon, authenticated;
revoke all on function public.snapshot_note_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções do servidor (fila de lembretes) — apenas service_role
-- ---------------------------------------------------------------------
create or replace function public.claim_due_reminders(p_limit int default 100)
returns setof public.reminders
language plpgsql security definer set search_path = '' as $$
begin
  -- Recupera lembretes travados (processo caiu no meio do envio).
  update public.reminders
     set status = case when attempts >= 5 then 'failed' else 'pending' end,
         last_error = coalesce(last_error, 'timeout de processamento')
   where status = 'processing' and updated_at < now() - interval '10 minutes';

  return query
  update public.reminders r
     set status = 'processing', attempts = r.attempts + 1
   where r.id in (
     select id from public.reminders
      where status = 'pending' and remind_at <= now()
      order by remind_at
      limit greatest(1, least(p_limit, 500))
      for update skip locked
   )
  returning r.*;
end $$;
revoke all on function public.claim_due_reminders(int) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(int) to service_role;

create or replace function public.increment_ai_usage(p_user uuid, p_input bigint, p_output bigint)
returns public.ai_usage
language sql security definer set search_path = '' as $$
  insert into public.ai_usage (user_id, day, requests, input_tokens, output_tokens)
  values (p_user, (now() at time zone 'utc')::date, 1, p_input, p_output)
  on conflict (user_id, day) do update
    set requests = public.ai_usage.requests + 1,
        input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
        output_tokens = public.ai_usage.output_tokens + excluded.output_tokens
  returning *;
$$;
revoke all on function public.increment_ai_usage(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(uuid, bigint, bigint) to service_role;

-- Exclusão de conta (LGPD): remove o usuário e, em cascata, todos os dados.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Retenção do histórico de conversas conforme a preferência do usuário.
create or replace function public.purge_old_history()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.conversation_messages m
   using public.user_preferences p
   where p.user_id = m.user_id
     and m.created_at < now() - make_interval(days => p.history_retention_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_old_history() from public, anon, authenticated;
grant execute on function public.purge_old_history() to service_role;
