\o /dev/null
\set ON_ERROR_STOP on
-- Testes de segurança da versão 2.0 (AI Engine, automações, conectores).
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'dono@exemplo.com'),
  ('44444444-4444-4444-4444-444444444444', 'outro@exemplo.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
-- App tenta forjar status "connected": o gatilho redefine.
insert into public.automation_connections (id, name, base_url, status, status_detail)
values ('cccccccc-0000-0000-0000-000000000001', 'n8n Connectfly', 'https://n8n.conectfly.com.br', 'connected', 'forjado');
insert into public.connected_projects (id, name, template, status) values ('dddddddd-0000-0000-0000-000000000001', 'FlyDelivery', 'flydelivery', 'healthy');
insert into public.automations (id, connection_id, name, webhook_url, project_id)
values ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Relatório de vendas', 'https://n8n.conectfly.com.br/webhook/vendas', 'dddddddd-0000-0000-0000-000000000001');
insert into public.alerts (title) values ('Teste');
insert into public.goals (title, target) values ('Faturar 50 mil', 50000);
insert into public.expenses (amount, description) values (120.50, 'Hospedagem');
do $$ begin
  assert (select status from public.automation_connections) = 'disconnected', 'status de conexão forjado aceito';
  assert (select status from public.connected_projects) = 'not_configured', 'status de projeto forjado aceito';
  -- Colunas de estado não podem ser alteradas pelo app
  begin
    update public.automation_connections set status = 'connected';
    raise exception 'app alterou status da conexão';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.connected_projects set capabilities = '[{"id":"x"}]';
    raise exception 'app alterou capacidades';
  exception when insufficient_privilege then null;
  end;
  -- Segredos: nem leitura
  begin
    perform count(*) from public.integration_secrets;
    raise exception 'app leu segredos';
  exception when insufficient_privilege then null;
  end;
  -- Execuções e eventos: só o servidor cria
  begin
    insert into public.automation_runs (user_id, automation_id, status) values ('33333333-3333-3333-3333-333333333333', 'eeeeeeee-0000-0000-0000-000000000001', 'succeeded');
    raise exception 'app criou execução forjada';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_automation_runs(10);
    raise exception 'app chamou fila do servidor';
  exception when insufficient_privilege then null;
  end;
  -- Webhook precisa ser HTTPS
  begin
    insert into public.automations (connection_id, name, webhook_url) values ('cccccccc-0000-0000-0000-000000000001', 'x', 'http://inseguro');
    raise exception 'webhook sem HTTPS aceito';
  exception when check_violation then null;
  end;
end $$;

-- Outro usuário
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ declare n int; begin
  assert (select count(*) from public.automations) = 0, 'VAZAMENTO: automações';
  assert (select count(*) from public.automation_connections) = 0, 'VAZAMENTO: conexões';
  assert (select count(*) from public.connected_projects) = 0, 'VAZAMENTO: projetos';
  assert (select count(*) from public.alerts) = 0, 'VAZAMENTO: alertas';
  assert (select count(*) from public.goals) = 0, 'VAZAMENTO: metas';
  assert (select count(*) from public.expenses) = 0, 'VAZAMENTO: despesas';
  delete from public.automations;
  get diagnostics n = row_count;
  assert n = 0, 'outro usuário apagou automação';
  begin
    insert into public.automations (connection_id, name, webhook_url) values ('cccccccc-0000-0000-0000-000000000001', 'sequestro', 'https://x.test/w');
    raise exception 'outro usuário usou conexão alheia';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Servidor: fila sem duplicidade, timeout com alerta, idempotência de eventos
reset role;
set role service_role;
insert into public.automation_runs (id, user_id, automation_id, status, idempotency_key)
values ('ffffffff-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'eeeeeeee-0000-0000-0000-000000000001', 'queued', 'req-1');
do $$ begin
  begin
    insert into public.automation_runs (user_id, automation_id, idempotency_key) values ('33333333-3333-3333-3333-333333333333', 'eeeeeeee-0000-0000-0000-000000000001', 'req-1');
    raise exception 'execução duplicada aceita';
  exception when unique_violation then null;
  end;
  assert (select count(*) from public.claim_automation_runs(10)) = 1, 'execução não reivindicada';
  assert (select count(*) from public.claim_automation_runs(10)) = 0, 'execução reivindicada duas vezes';
  update public.automation_runs set status = 'started', timeout_at = now() - interval '1 minute';
  assert public.expire_automation_runs() = 1, 'timeout não aplicado';
  assert (select status from public.automation_runs) = 'timeout', 'status de timeout incorreto';
  assert (select count(*) from public.alerts where title like 'Automação sem resposta%') = 1, 'alerta de timeout não criado';
  insert into public.integration_events (user_id, connection_id, event_id, event_type, schema_version, source, occurred_at)
  values ('33333333-3333-3333-3333-333333333333', 'cccccccc-0000-0000-0000-000000000001', 'evt-1', 'project.alert', '1.0', 'n8n', now());
  begin
    insert into public.integration_events (user_id, connection_id, event_id, event_type, schema_version, source, occurred_at)
    values ('33333333-3333-3333-3333-333333333333', 'cccccccc-0000-0000-0000-000000000001', 'evt-1', 'project.alert', '1.0', 'n8n', now());
    raise exception 'evento duplicado aceito';
  exception when unique_violation then null;
  end;
end $$;
reset role;
\echo 'TESTES DE SEGURANÇA 2.0 PASSARAM'
