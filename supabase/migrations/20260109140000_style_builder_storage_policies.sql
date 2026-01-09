-- Style Builder Storage policies (no-auth / public)
-- Allow anon/authenticated clients to read/write objects in the `style_builder_assets` bucket.
-- This matches the project's existing "single-user/no-auth" permissive posture.

do $$
begin
  -- Ensure bucket exists (idempotent)
  insert into storage.buckets (id, name, public)
  values ('style_builder_assets', 'style_builder_assets', true)
  on conflict (id) do update set public = excluded.public, name = excluded.name;
exception
  when undefined_table then
    raise notice 'storage.buckets table not found; skipping bucket upsert';
end
$$;

-- Policies on storage.objects (RLS-enabled in Supabase)
do $$
begin
  -- SELECT
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read style_builder_assets'
  ) then
    create policy "Public read style_builder_assets"
      on storage.objects for select
      using (bucket_id = 'style_builder_assets');
  end if;

  -- INSERT
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public insert style_builder_assets'
  ) then
    create policy "Public insert style_builder_assets"
      on storage.objects for insert
      with check (bucket_id = 'style_builder_assets');
  end if;

  -- UPDATE
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public update style_builder_assets'
  ) then
    create policy "Public update style_builder_assets"
      on storage.objects for update
      using (bucket_id = 'style_builder_assets')
      with check (bucket_id = 'style_builder_assets');
  end if;

  -- DELETE
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public delete style_builder_assets'
  ) then
    create policy "Public delete style_builder_assets"
      on storage.objects for delete
      using (bucket_id = 'style_builder_assets');
  end if;
exception
  when undefined_table then
    raise notice 'storage.objects table not found; skipping storage policies';
end
$$;

