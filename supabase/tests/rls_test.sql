-- Testes de segurança: isolamento entre usuários (Cenário 10) e integridade.
\o /dev/null
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'franklin@exemplo.com', '{"name":"Franklin"}'),
  ('22222222-2222-2222-2222-222222222222', 'intruso@exemplo.com', '{}');

-- Preferências criadas automaticamente no cadastro
do $$ begin
  assert (select count(*) from public.user_preferences) = 2, 'preferências não criadas';
  assert (select display_name from public.user_preferences where user_id = '11111111-1111-1111-1111-111111111111') = 'Franklin', 'nome incorreto';
end $$;

-- Usuário A cria dados
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.projects (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Connectfly');
insert into public.tasks (id, title, due_at, project_id) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Academia', '2026-11-20 12:00Z', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.notes (title, content_text) values ('Ideia FlyDelivery', 'Nova funcionalidade de atendimento');
insert into public.reminders (title, remind_at, entity_type, entity_id) values ('Academia', '2026-11-20 11:30Z', 'task', 'aaaaaaaa-0000-0000-0000-000000000002');
update public.tasks set title = 'Academia cedo' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin
  assert (select count(*) from public.tasks) = 1, 'A deveria ver 1 tarefa';
  assert (select count(*) from public.task_history) = 1, 'histórico da tarefa não registrado';
end $$;

-- Usuário B tenta acessar dados de A
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare n int; begin
  assert (select count(*) from public.tasks) = 0, 'VAZAMENTO: B vê tarefas de A';
  assert (select count(*) from public.notes) = 0, 'VAZAMENTO: B vê notas de A';
  assert (select count(*) from public.reminders) = 0, 'VAZAMENTO: B vê lembretes de A';
  assert (select count(*) from public.task_history) = 0, 'VAZAMENTO: B vê histórico de A';
  update public.tasks set title = 'hack' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'B conseguiu alterar tarefa de A';
  delete from public.notes;
  get diagnostics n = row_count;
  assert n = 0, 'B conseguiu apagar notas de A';
end $$;

-- B tenta inserir uma linha em nome de A
do $$ begin
  begin
    insert into public.tasks (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'falsa');
    raise exception 'B inseriu tarefa como A';
  exception when insufficient_privilege then null; -- bloqueado pelo RLS
  end;
end $$;

-- B tenta vincular sua tarefa ao projeto de A (chave composta impede)
do $$ begin
  begin
    insert into public.tasks (title, project_id) values ('minha', 'aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'B vinculou tarefa ao projeto de A';
  exception when foreign_key_violation then null;
  end;
end $$;

-- B não pode escrever em tabelas somente-leitura nem chamar funções do servidor
do $$ begin
  begin
    insert into public.task_history (user_id, task_id, changes) values ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), '{}');
    raise exception 'B escreveu no histórico';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_due_reminders(10);
    raise exception 'B executou função do servidor';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anônimo não acessa nada
reset role;
set role anon;
do $$ begin
  begin
    perform count(*) from public.tasks;
    raise exception 'anon leu tarefas';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Servidor (service_role) processa a fila de lembretes uma única vez
reset role;
set role service_role;
update public.reminders set remind_at = now() - interval '1 minute';
do $$ begin
  assert (select count(*) from public.claim_due_reminders(10)) = 1, 'lembrete não reivindicado';
  assert (select count(*) from public.claim_due_reminders(10)) = 0, 'lembrete reivindicado duas vezes (duplicidade)';
  assert (select status from public.reminders limit 1) = 'processing', 'status incorreto';
end $$;

-- Lembrete duplicado para o mesmo item/horário é rejeitado
reset role;
do $$ begin
  begin
    insert into public.reminders (user_id, title, remind_at, entity_type, entity_id)
    select user_id, title, remind_at, entity_type, entity_id from public.reminders limit 1;
    raise exception 'lembrete duplicado aceito';
  exception when unique_violation then null;
  end;
end $$;

-- Chaves de atalho: isolamento, colunas protegidas, validação e limite
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.api_tokens (name, token_hash, token_prefix)
values ('iPhone', repeat('a', 64), 'jfv_abcd');
do $$ begin
  begin
    update public.api_tokens set uses_count = 0;
    raise exception 'usuário alterou contador da chave';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.use_api_token(repeat('a', 64));
    raise exception 'usuário chamou validação de chave do servidor';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare n int; begin
  assert (select count(*) from public.api_tokens) = 0, 'VAZAMENTO: B vê chaves de A';
  update public.api_tokens set revoked_at = now();
  get diagnostics n = row_count;
  assert n = 0, 'B revogou chave de A';
end $$;
reset role;
set role service_role;
do $$ begin
  assert public.use_api_token(repeat('a', 64), 2) = '11111111-1111-1111-1111-111111111111', 'chave válida não reconhecida';
  assert public.use_api_token(repeat('b', 64), 2) is null, 'chave inexistente aceita';
  perform public.use_api_token(repeat('a', 64), 2);
  begin
    perform public.use_api_token(repeat('a', 64), 2);
    raise exception 'limite diário não aplicado';
  exception when sqlstate 'P0429' then null;
  end;
  update public.api_tokens set revoked_at = now();
  assert public.use_api_token(repeat('a', 64), 100) is null, 'chave revogada aceita';
end $$;
reset role;

-- Exclusão de conta remove todos os dados em cascata
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.delete_my_account();
reset role;
do $$ begin
  assert (select count(*) from public.tasks where user_id = '11111111-1111-1111-1111-111111111111') = 0, 'dados não removidos';
  assert (select count(*) from public.notes where user_id = '11111111-1111-1111-1111-111111111111') = 0, 'notas não removidas';
end $$;

\echo 'TODOS OS TESTES DE SEGURANÇA DO BANCO PASSARAM'
