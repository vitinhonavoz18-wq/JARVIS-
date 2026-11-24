\o /dev/null
\set ON_ERROR_STOP on
-- Testes do Memory Engine: isolamento entre usuários, deduplicação, busca híbrida e conversas privadas.
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'franklin@exemplo.com'),
  ('66666666-6666-6666-6666-666666666666', 'intruso@exemplo.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
insert into public.conversations (id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Planejamento'), ('aaaaaaaa-0000-0000-0000-000000000002', 'Privada');
update public.conversations set private = true where id = 'aaaaaaaa-0000-0000-0000-000000000002';
insert into public.conversation_messages (conversation_id, role, content) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'user', 'Decidi contratar um designer para a FlyDelivery em dezembro'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'user', 'Assunto secreto sobre designer');
insert into public.user_memories (category, content, kind, importance, source_conversation_id) values
  ('preferencias', 'Prefiro reuniões pela manhã', 'preference', 4, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('trabalho', 'A TG Baterias vende baterias automotivas em Salvador', 'semantic', 3, null);
insert into public.decision_history (decision, reason, source_conversation_id)
  values ('Contratar designer para a FlyDelivery', 'Melhorar a conversão do app', 'aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  -- Deduplicação: a mesma memória ativa (com espaços/maiúsculas diferentes) é recusada
  begin
    insert into public.user_memories (category, content) values ('preferencias', '  prefiro   REUNIÕES pela manhã ');
    raise exception 'memória duplicada aceita';
  exception when unique_violation then null;
  end;
  -- Busca híbrida encontra por palavra e por erro de digitação
  assert (select count(*) from public.search_memories('reunião manhã') where content like 'Prefiro%') = 1, 'busca textual falhou';
  assert (select count(*) from public.search_memories('baterias salvador')) >= 1, 'busca por termos falhou';
  -- Conversas privadas ficam fora da busca
  assert (select count(*) from public.search_conversations('designer')) = 1, 'busca de conversa deveria achar só a não privada';
end $$;

-- Outro usuário não vê nada
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$ begin
  assert (select count(*) from public.user_memories) = 0, 'vazamento de memórias';
  assert (select count(*) from public.search_memories('reunião manhã')) = 0, 'vazamento na busca de memórias';
  assert (select count(*) from public.search_conversations('designer')) = 0, 'vazamento na busca de conversas';
  assert (select count(*) from public.decision_history) = 0, 'vazamento de decisões';
  update public.user_memories set content = 'hack';
  delete from public.decision_history;
end $$;

-- O dono continua com tudo intacto; memória substituída sai da busca
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$
declare novo uuid;
begin
  assert (select count(*) from public.decision_history) = 1, 'intruso apagou decisão';
  assert (select count(*) from public.user_memories where content = 'hack') = 0, 'intruso alterou memória';
  insert into public.user_memories (category, content) values ('preferencias', 'Prefiro reuniões à tarde') returning id into novo;
  update public.user_memories set superseded_by = novo where content = 'Prefiro reuniões pela manhã';
  assert (select count(*) from public.search_memories('reuniões manhã') where content = 'Prefiro reuniões pela manhã') = 0, 'memória substituída ainda é recuperada';
end $$;
reset role;
\o
\echo 'MEMORY ENGINE: isolamento, deduplicação, busca híbrida e conversas privadas OK'
