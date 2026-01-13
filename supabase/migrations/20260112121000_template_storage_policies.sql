-- Template Storage policies (no-auth / public)
-- Allow anon/authenticated clients to read/write objects in:
-- - template_assets (previews/textures/etc)
-- - template_pdfs   (generated PDFs)

do $$
begin
  -- Ensure buckets exist (idempotent)
  insert into storage.buckets (id, name, public)
  values ('template_assets', 'template_assets', true)
  on conflict (id) do update set public = excluded.public, name = excluded.name;

  insert into storage.buckets (id, name, public)
  values ('template_pdfs', 'template_pdfs', true)
  on conflict (id) do update set public = excluded.public, name = excluded.name;
exception
  when undefined_table then
    raise notice 'storage.buckets table not found; skipping bucket upsert';
end
$$;

do $$
begin
  -- template_assets: SELECT
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read template_assets'
  ) then
    create policy "Public read template_assets"
      on storage.objects for select
      using (bucket_id = 'template_assets');
  end if;

  -- template_assets: INSERT
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public insert template_assets'
  ) then
    create policy "Public insert template_assets"
      on storage.objects for insert
      with check (bucket_id = 'template_assets');
  end if;

  -- template_assets: UPDATE
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public update template_assets'
  ) then
    create policy "Public update template_assets"
      on storage.objects for update
      using (bucket_id = 'template_assets')
      with check (bucket_id = 'template_assets');
  end if;

  -- template_assets: DELETE
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public delete template_assets'
  ) then
    create policy "Public delete template_assets"
      on storage.objects for delete
      using (bucket_id = 'template_assets');
  end if;

  -- template_pdfs: SELECT
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read template_pdfs'
  ) then
    create policy "Public read template_pdfs"
      on storage.objects for select
      using (bucket_id = 'template_pdfs');
  end if;

  -- template_pdfs: INSERT
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public insert template_pdfs'
  ) then
    create policy "Public insert template_pdfs"
      on storage.objects for insert
      with check (bucket_id = 'template_pdfs');
  end if;

  -- template_pdfs: UPDATE
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public update template_pdfs'
  ) then
    create policy "Public update template_pdfs"
      on storage.objects for update
      using (bucket_id = 'template_pdfs')
      with check (bucket_id = 'template_pdfs');
  end if;

  -- template_pdfs: DELETE
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public delete template_pdfs'
  ) then
    create policy "Public delete template_pdfs"
      on storage.objects for delete
      using (bucket_id = 'template_pdfs');
  end if;
exception
  when undefined_table then
    raise notice 'storage.objects table not found; skipping storage policies';
end
$$;

