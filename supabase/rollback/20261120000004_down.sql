-- Reverte a migration 20261120000004 (remove SOMENTE o que ela criou). Faça backup antes.
drop function if exists public.expire_automation_runs();
drop function if exists public.claim_automation_runs(int);
drop table if exists public.expenses, public.goals, public.alerts, public.integration_events, public.automation_runs,
  public.automations, public.automation_workflows, public.integration_secrets, public.project_snapshots;
alter table if exists public.connected_projects drop constraint if exists connected_projects_connection_fk;
drop table if exists public.automation_connections, public.connected_projects, public.ai_calls, public.ai_settings;
drop function if exists public.reset_server_fields();
