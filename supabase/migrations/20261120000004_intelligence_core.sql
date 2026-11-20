-- =====================================================================
-- J.A.R.V.I.S. FV 2.0 — AI Engine, Automation Engine (n8n), conectores de projetos,
-- central executiva, metas, despesas e alertas. Migration incremental: não altera
-- nem apaga tabelas existentes. Reversão: supabase/rollback/20261120000004_down.sql
-- =====================================================================

-- ---------------------------------------------------------------- AI Engine
create table public.ai_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  provider text not null default 'auto' check (provider in ('auto', 'openai', 'anthropic')),
  simple_model text check (char_length(simple_model) <= 100),
  complex_model text check (char_length(complex_model) <= 100),
  voice_model text check (char_length(voice_model) <= 100),
  response_style text not null default 'objetivo' check (response_style in ('objetivo', 'detalhado', 'executivo')),
  daily_request_limit int not null default 300 check (daily_request_limit between 1 and 5000),
  monthly_budget_usd numeric(10, 2) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  web_search_enabled boolean not null default false,
  fallback_enabled boolean not null default true,
  -- Preços por 1 milhão de tokens informados pelo usuário (os preços mudam; nada é fixado no código).
  model_prices jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  model text not null,
  specialist text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  est_cost_usd numeric(12, 6),
  latency_ms int,
  status text not null check (status in ('ok', 'error', 'fallback')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_calls_user_idx on public.ai_calls (user_id, created_at desc);

-- ------------------------------------------------------- Projetos conectados
create table public.connected_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  template text not null default 'custom' check (template in ('connectfly', 'flydelivery', 'farmacia_preco_bom', 'tg_baterias', 'sitecreatorfly', 'custom')),
  connector_type text not null default 'none' check (connector_type in ('none', 'http', 'n8n')),
  base_url text check (base_url is null or base_url ~ '^https://'),
  connection_id uuid,
  scopes text[] not null default '{metrics:read,alerts:read}',
  privacy_level text not null default 'aggregated' check (privacy_level in ('aggregated', 'detailed')),
  enabled boolean not null default true,
  -- Preenchidos pelo servidor
  capabilities jsonb not null default '[]'::jsonb,
  status text not null default 'not_configured' check (status in ('not_configured', 'healthy', 'degraded', 'down', 'unauthorized')),
  status_detail text,
  last_health_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index connected_projects_user_idx on public.connected_projects (user_id);

create table public.project_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  capability text not null,
  data jsonb not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.connected_projects (id, user_id) on delete cascade
);
create index project_snapshots_lookup_idx on public.project_snapshots (user_id, project_id, capability, fetched_at desc);

-- ------------------------------------------------------- Automation Engine
create table public.automation_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'n8n' check (kind = 'n8n'),
  name text not null check (char_length(name) between 1 and 80),
  base_url text not null check (base_url ~ '^https://'),
  environment text not null default 'production' check (environment in ('production', 'development')),
  authorized_projects text[] not null default '{}',
  -- Preenchidos pelo servidor
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'unauthorized', 'unavailable', 'misconfigured')),
  status_detail text,
  last_checked_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index automation_connections_user_idx on public.automation_connections (user_id);

alter table public.connected_projects
  add constraint connected_projects_connection_fk foreign key (connection_id, user_id)
  references public.automation_connections (id, user_id) on delete set null (connection_id);

-- Credenciais (chaves de API, segredos de webhook) — cifradas com AES-GCM; só o servidor acessa.
create table public.integration_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  owner_type text not null check (owner_type in ('automation_connection', 'automation', 'connected_project')),
  owner_id uuid not null,
  name text not null check (name in ('api_key', 'events_secret', 'webhook_auth', 'project_token')),
  value_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_type, owner_id, name)
);

create table public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null,
  n8n_id text not null,
  name text not null,
  active boolean not null default false,
  tags text[] not null default '{}',
  n8n_project_id text,
  description text,
  triggers text[] not null default '{}',
  webhook_paths text[] not null default '{}',
  last_execution_status text,
  last_execution_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, user_id) references public.automation_connections (id, user_id) on delete cascade,
  unique (connection_id, n8n_id)
);
create index automation_workflows_user_idx on public.automation_workflows (user_id);

-- Registro EXPLÍCITO de automações executáveis (descobrir um workflow não o torna executável).
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  connection_id uuid not null,
  project_id uuid,
  workflow_n8n_id text,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  aliases text[] not null default '{}',
  category text,
  webhook_url text not null check (webhook_url ~ '^https://'),
  auth_header_name text check (auth_header_name is null or auth_header_name ~ '^[A-Za-z0-9-]{1,60}$'),
  input_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  risk text not null default 'external' check (risk in ('read', 'reversible', 'sensitive', 'external', 'destructive')),
  requires_confirmation boolean not null default true,
  mode text not null default 'async' check (mode in ('async', 'sync')),
  timeout_seconds int not null default 900 check (timeout_seconds between 10 and 86400),
  enabled boolean not null default true,
  is_shortcut boolean not null default false,
  alert_on_failure boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (connection_id, user_id) references public.automation_connections (id, user_id) on delete cascade,
  foreign key (project_id, user_id) references public.connected_projects (id, user_id) on delete set null (project_id)
);
create index automations_user_idx on public.automations (user_id) where enabled;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  automation_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'requested', 'started', 'running', 'succeeded', 'failed', 'cancelled', 'timeout')),
  correlation_id uuid not null unique default gen_random_uuid(),
  idempotency_key text,
  source text not null default 'manual' check (source in ('manual', 'voice', 'ai', 'schedule', 'shortcut')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  output_summary text,
  n8n_execution_id text,
  error text,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  timeout_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (automation_id, user_id) references public.automations (id, user_id) on delete cascade
);
create index automation_runs_user_idx on public.automation_runs (user_id, requested_at desc);
create index automation_runs_queue_idx on public.automation_runs (next_attempt_at) where status = 'queued';
create index automation_runs_active_idx on public.automation_runs (timeout_at) where status in ('requested', 'started', 'running');
create unique index automation_runs_idem_uidx on public.automation_runs (user_id, idempotency_key) where idempotency_key is not null;

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null,
  event_id text not null,
  event_type text not null,
  schema_version text not null,
  source text not null,
  project_ref text,
  workflow_id text,
  correlation_id uuid,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, user_id) references public.automation_connections (id, user_id) on delete cascade,
  unique (connection_id, event_id) -- idempotência: o mesmo evento nunca é processado duas vezes
);
create index integration_events_user_idx on public.integration_events (user_id, received_at desc);

-- ------------------------------------------------- Alertas, metas, despesas
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 4000),
  source text not null default 'jarvis',
  project_id uuid,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references public.connected_projects (id, user_id) on delete set null (project_id)
);
create index alerts_user_idx on public.alerts (user_id, created_at desc);
create index alerts_unread_idx on public.alerts (user_id) where read_at is null;

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  project_label text check (char_length(project_label) <= 80),
  metric text check (char_length(metric) <= 80),
  target numeric,
  current numeric not null default 0,
  unit text check (char_length(unit) <= 20),
  due_date date,
  status text not null default 'active' check (status in ('active', 'achieved', 'paused', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id) where status = 'active';

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  category text not null default 'Geral' check (char_length(category) <= 60),
  description text check (char_length(description) <= 300),
  spent_on date not null default current_date,
  project_label text check (char_length(project_label) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_user_idx on public.expenses (user_id, spent_on desc);

-- ------------------------------------------------------------- Gatilhos
do $$
declare t text;
begin
  foreach t in array array['ai_settings','connected_projects','automation_connections','integration_secrets','automation_workflows',
                           'automations','automation_runs','alerts','goals','expenses'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ----------------------------------------------------------- RLS e GRANTs
do $$
declare t text;
begin
  -- CRUD completo pelo dono
  foreach t in array array['ai_settings','automations','alerts','goals','expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;

  -- Somente leitura para o dono (escritas pelo servidor)
  foreach t in array array['ai_calls','project_snapshots','automation_workflows','automation_runs','integration_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
  end loop;

  -- Configuração pelo dono; colunas de estado só pelo servidor
  foreach t in array array['connected_projects','automation_connections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;
end $$;
grant update (name, template, connector_type, base_url, connection_id, scopes, privacy_level, enabled) on public.connected_projects to authenticated;
grant update (name, base_url, environment, authorized_projects) on public.automation_connections to authenticated;

-- Segredos: nenhum acesso para usuários do app, nem leitura.
alter table public.integration_secrets enable row level security;
revoke all on table public.integration_secrets from anon, authenticated;
grant all on table public.integration_secrets to service_role;

-- Status iniciais não podem ser forjados pelo app.
create or replace function public.reset_server_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('role', true) = 'authenticated' then
    if tg_table_name = 'connected_projects' then
      new.status := 'not_configured'; new.status_detail := null; new.last_health_at := null; new.capabilities := '[]'::jsonb;
    elsif tg_table_name = 'automation_connections' then
      new.status := 'disconnected'; new.status_detail := null; new.last_checked_at := null; new.last_sync_at := null;
    end if;
  end if;
  return new;
end $$;
create trigger connected_projects_server_fields before insert on public.connected_projects for each row execute function public.reset_server_fields();
create trigger automation_connections_server_fields before insert on public.automation_connections for each row execute function public.reset_server_fields();

-- ---------------------------------------------- Funções do servidor (filas)
-- Reivindica execuções enfileiradas para despacho ao n8n (sem duplicar entre processos).
create or replace function public.claim_automation_runs(p_limit int default 50)
returns setof public.automation_runs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.automation_runs r
     set status = 'requested', attempts = r.attempts + 1
   where r.id in (
     select id from public.automation_runs
      where status = 'queued' and next_attempt_at <= now()
      order by next_attempt_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked)
  returning r.*;
end $$;
revoke all on function public.claim_automation_runs(int) from public, anon, authenticated;
grant execute on function public.claim_automation_runs(int) to service_role;

-- Execuções sem retorno dentro do prazo viram "timeout" e geram alerta.
create or replace function public.expire_automation_runs()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with expired as (
    update public.automation_runs
       set status = 'timeout', finished_at = now(), error = coalesce(error, 'Sem confirmação de término dentro do prazo configurado.')
     where status in ('requested', 'started', 'running') and timeout_at is not null and timeout_at < now()
    returning user_id, automation_id
  ), ins as (
    insert into public.alerts (user_id, severity, title, body, source, link)
    select e.user_id, 'warning', 'Automação sem resposta: ' || a.name,
           'A execução não confirmou término dentro do prazo. Verifique o workflow no n8n.', 'automation', '/automacoes'
      from expired e join public.automations a on a.id = e.automation_id
    returning 1
  )
  select count(*) into n from expired;
  return n;
end $$;
revoke all on function public.expire_automation_runs() from public, anon, authenticated;
grant execute on function public.expire_automation_runs() to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alerts, public.automation_runs;
  end if;
end $$;
