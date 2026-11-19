-- =====================================================================
-- Agendamento do processador de lembretes (executar UMA vez no SQL Editor
-- depois de publicar a Edge Function "process-reminders").
--
-- 1) Antes, guarde os segredos no Vault (troque os valores):
--    select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
--    select vault.create_secret('UM-SEGREDO-LONGO-ALEATORIO', 'cron_secret');
--    E configure o mesmo valor na função:  supabase secrets set CRON_SECRET=...
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'jarvis-process-reminders',
  '* * * * *',  -- a cada minuto
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/process-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Limpeza diária do histórico antigo de conversas (03:17 UTC).
select cron.schedule('jarvis-purge-history', '17 3 * * *', $$ select public.purge_old_history(); $$);
