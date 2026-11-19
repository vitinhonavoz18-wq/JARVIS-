-- Bucket privado de anexos: cada usuário só acessa a pasta com o próprio id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 20971520,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','audio/webm','audio/mp4','audio/mpeg','audio/ogg'])
on conflict (id) do nothing;

create policy "attachments_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Atualização em tempo real entre aparelhos (respeita RLS).
alter publication supabase_realtime add table public.tasks, public.notes, public.calendar_events, public.reminders, public.focus_sessions;
