-- =====================================================================
-- Chaves pessoais para atalhos (Siri / Android).
-- O app gera a chave no aparelho e envia apenas o hash SHA-256: o banco nunca guarda a chave em si.
-- =====================================================================
create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null check (char_length(token_prefix) between 4 and 16),
  last_used_at timestamptz,
  uses_day date,
  uses_count int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index api_tokens_user_idx on public.api_tokens (user_id);

create trigger api_tokens_updated_at before update on public.api_tokens
  for each row execute function public.set_updated_at();

alter table public.api_tokens enable row level security;
revoke all on table public.api_tokens from anon, authenticated;
grant select, insert, delete on table public.api_tokens to authenticated;
-- O usuário só pode alterar nome e revogar; contadores são do servidor.
grant update (name, revoked_at) on table public.api_tokens to authenticated;
grant all on table public.api_tokens to service_role;

create policy api_tokens_select_own on public.api_tokens for select to authenticated using ((select auth.uid()) = user_id);
create policy api_tokens_insert_own on public.api_tokens for insert to authenticated with check ((select auth.uid()) = user_id);
create policy api_tokens_update_own on public.api_tokens for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy api_tokens_delete_own on public.api_tokens for delete to authenticated using ((select auth.uid()) = user_id);

-- Limite de chaves ativas por usuário.
create or replace function public.enforce_api_token_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.api_tokens where user_id = new.user_id and revoked_at is null) >= 10 then
    raise exception 'limite de 10 chaves ativas atingido';
  end if;
  return new;
end $$;
create trigger api_tokens_limit before insert on public.api_tokens
  for each row execute function public.enforce_api_token_limit();

-- Valida a chave (pelo hash), aplica o limite diário e devolve o dono. Somente o servidor chama.
create or replace function public.use_api_token(p_hash text, p_daily_limit int default 500)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_count int;
begin
  update public.api_tokens
     set last_used_at = now(),
         uses_count = case when uses_day = current_date then uses_count + 1 else 1 end,
         uses_day = current_date
   where token_hash = p_hash and revoked_at is null
  returning user_id, uses_count into v_user, v_count;
  if v_user is null then
    return null;
  end if;
  if v_count > p_daily_limit then
    raise exception 'limite diário de comandos atingido' using errcode = 'P0429';
  end if;
  return v_user;
end $$;
revoke all on function public.use_api_token(text, int) from public, anon, authenticated;
grant execute on function public.use_api_token(text, int) to service_role;
