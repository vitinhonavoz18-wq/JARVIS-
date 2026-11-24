-- =====================================================================
-- JARVIS Memory Engine (Super Memória) — migration ADITIVA
-- Não apaga nem altera dados existentes. Reversão: supabase/rollback/20261124000005_down.sql
--
-- Decisões:
-- * `user_memories` já é a tabela de itens de memória → é ESTENDIDA (não duplicada como memory_items).
-- * Embeddings ficam numa coluna `vector(1536)` (OpenAI text-embedding-3-small), sem tabela separada.
-- * Origem da memória = colunas source_conversation_id/source_message_id (sem tabela memory_sources).
-- * Novas tabelas: memory_entities (pessoas/empresas/assuntos), memory_entity_links e decision_history.
-- * Toda busca roda com SECURITY INVOKER → respeita o RLS do próprio usuário.
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Itens de memória: tipo, importância, origem, validade, embedding e busca textual
-- ---------------------------------------------------------------------
alter table public.user_memories
  add column if not exists kind text not null default 'semantic'
    check (kind in ('semantic', 'episodic', 'procedural', 'preference', 'decision')),
  add column if not exists importance smallint not null default 3 check (importance between 1 and 5),
  add column if not exists source_conversation_id uuid references public.conversations (id) on delete set null,
  add column if not exists source_message_id uuid references public.conversation_messages (id) on delete set null,
  add column if not exists superseded_by uuid references public.user_memories (id) on delete set null,
  add column if not exists valid_until timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists embedding extensions.vector(1536),
  add column if not exists content_key text generated always as (md5(lower(regexp_replace(btrim(content), '\s+', ' ', 'g')))) stored,
  add column if not exists fts tsvector generated always as (to_tsvector('portuguese', content)) stored;

-- Deduplicação: antes do índice único, desativa cópias ativas (mantém a mais recente). Hoje: 0 duplicatas.
with ranked as (
  select id, row_number() over (partition by user_id, content_key order by updated_at desc, created_at desc) as rn
  from public.user_memories where active
)
update public.user_memories m set active = false
from ranked r where m.id = r.id and r.rn > 1;

create unique index if not exists user_memories_unique_active_idx on public.user_memories (user_id, content_key) where active;
create index if not exists user_memories_fts_idx on public.user_memories using gin (fts);
create index if not exists user_memories_trgm_idx on public.user_memories using gin (content extensions.gin_trgm_ops);
create index if not exists user_memories_embedding_idx on public.user_memories using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists user_memories_source_conv_idx on public.user_memories (source_conversation_id) where source_conversation_id is not null;

-- ---------------------------------------------------------------------
-- 2. Conversas: resumo incremental, modo privado e busca no histórico
-- ---------------------------------------------------------------------
alter table public.conversations
  add column if not exists summary text check (char_length(summary) <= 4000),
  add column if not exists summary_until timestamptz,
  add column if not exists private boolean not null default false,
  add column if not exists pinned boolean not null default false,
  add column if not exists archived boolean not null default false;

alter table public.conversation_messages
  add column if not exists fts tsvector generated always as (to_tsvector('portuguese', content)) stored;
create index if not exists conversation_messages_fts_idx on public.conversation_messages using gin (fts);

-- ---------------------------------------------------------------------
-- 3. Entidades (pessoas, empresas, assuntos) e vínculos com memórias
-- ---------------------------------------------------------------------
create table if not exists public.memory_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('person', 'company', 'project', 'topic', 'place')),
  name text not null check (char_length(name) between 1 and 120),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table if not exists public.memory_entity_links (
  memory_id uuid not null references public.user_memories (id) on delete cascade,
  entity_id uuid not null references public.memory_entities (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (memory_id, entity_id)
);
create index if not exists memory_entity_links_entity_idx on public.memory_entity_links (entity_id);

-- ---------------------------------------------------------------------
-- 4. Histórico de decisões
-- ---------------------------------------------------------------------
create table if not exists public.decision_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  decision text not null check (char_length(decision) between 3 and 1000),
  context text check (char_length(context) <= 4000),
  reason text check (char_length(reason) <= 2000),
  expected_result text check (char_length(expected_result) <= 2000),
  decided_at timestamptz not null default now(),
  review_at timestamptz,
  outcome text check (char_length(outcome) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'reverted')),
  source_conversation_id uuid references public.conversations (id) on delete set null,
  fts tsvector generated always as (to_tsvector('portuguese', decision || ' ' || coalesce(context, '') || ' ' || coalesce(reason, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists decision_history_user_idx on public.decision_history (user_id, decided_at desc);
create index if not exists decision_history_fts_idx on public.decision_history using gin (fts);
create index if not exists decision_history_review_idx on public.decision_history (review_at) where status = 'open' and review_at is not null;

-- Gatilhos de updated_at e RLS (mesmo padrão das demais tabelas)
do $$
declare t text;
begin
  foreach t in array array['memory_entities', 'decision_history'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['memory_entities', 'memory_entity_links', 'decision_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Busca híbrida (vetorial + texto + erro de digitação + importância + atualidade)
-- SECURITY INVOKER: só enxerga as linhas que o RLS do usuário permite.
-- ---------------------------------------------------------------------
create or replace function public.search_memories(
  p_query text,
  p_embedding extensions.vector(1536) default null,
  p_limit int default 5
)
returns table (id uuid, content text, category text, kind text, importance smallint, source_conversation_id uuid, updated_at timestamptz, score real)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select nullif(replace(plainto_tsquery('portuguese', coalesce(p_query, ''))::text, '&', '|'), '')::tsquery as tsq
  )
  select m.id, m.content, m.category, m.kind, m.importance, m.source_conversation_id, m.updated_at,
    (
      0.50 * coalesce(case when p_embedding is not null and m.embedding is not null then 1 - (m.embedding operator(extensions.<=>) p_embedding) end, 0)
      + 0.25 * coalesce(case when q.tsq is not null then ts_rank(m.fts, q.tsq) end, 0)
      + 0.10 * extensions.similarity(m.content, coalesce(p_query, ''))
      + 0.10 * (m.importance / 5.0)
      + 0.05 * exp(-extract(epoch from (now() - m.updated_at)) / (86400 * 90))
    )::real as score
  from public.user_memories m, q
  where m.active
    and m.superseded_by is null
    and (m.valid_until is null or m.valid_until > now())
    and (
      (p_embedding is not null and m.embedding is not null)
      or (q.tsq is not null and m.fts @@ q.tsq)
      or extensions.similarity(m.content, coalesce(p_query, '')) > 0.2
    )
  order by score desc
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

create or replace function public.search_conversations(p_query text, p_limit int default 10)
returns table (message_id uuid, conversation_id uuid, conversation_title text, role text, snippet text, created_at timestamptz, rank real)
language sql stable security invoker set search_path = '' as $$
  with q as (select nullif(replace(plainto_tsquery('portuguese', coalesce(p_query, ''))::text, '&', '|'), '')::tsquery as tsq)
  select cm.id, cm.conversation_id, c.title, cm.role, left(cm.content, 300), cm.created_at, ts_rank(cm.fts, q.tsq)::real
  from public.conversation_messages cm
  join public.conversations c on c.id = cm.conversation_id, q
  where q.tsq is not null and cm.fts @@ q.tsq and not c.private
  order by ts_rank(cm.fts, q.tsq) desc, cm.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke all on function public.search_memories(text, extensions.vector, int) from public, anon;
revoke all on function public.search_conversations(text, int) from public, anon;
grant execute on function public.search_memories(text, extensions.vector, int) to authenticated, service_role;
grant execute on function public.search_conversations(text, int) to authenticated, service_role;
