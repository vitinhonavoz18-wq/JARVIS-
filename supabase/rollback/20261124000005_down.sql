-- Reverte a migration 20261124000005 (remove SOMENTE o que ela criou). Faça backup antes:
-- as tabelas novas (decisões, entidades) e as colunas novas perdem seus dados.
drop function if exists public.search_conversations(text, int);
drop function if exists public.search_memories(text, extensions.vector, int);
drop table if exists public.memory_entity_links, public.memory_entities, public.decision_history;

drop index if exists public.conversation_messages_fts_idx;
alter table public.conversation_messages drop column if exists fts;
alter table public.conversations
  drop column if exists summary, drop column if exists summary_until, drop column if exists private,
  drop column if exists pinned, drop column if exists archived;

drop index if exists public.user_memories_unique_active_idx, public.user_memories_fts_idx, public.user_memories_trgm_idx,
  public.user_memories_embedding_idx, public.user_memories_source_conv_idx;
alter table public.user_memories
  drop column if exists fts, drop column if exists content_key, drop column if exists embedding,
  drop column if exists last_used_at, drop column if exists valid_until, drop column if exists superseded_by,
  drop column if exists source_message_id, drop column if exists source_conversation_id,
  drop column if exists importance, drop column if exists kind;
-- A extensão vector é mantida (pode ser usada por outros recursos).
