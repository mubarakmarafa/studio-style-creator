-- Sticker Pack Storage policies (no-auth / public)
-- Allows anon/authenticated clients to read/write objects in these public buckets:
-- - sticker_thumbnails
-- - stickers
--
-- Storage uses RLS on storage.objects, so bucket "public=true" is not enough for uploads.

do $$
begin
  -- Ensure buckets exist (idempotent)
  insert into storage.buckets (id, name, public)
  values
    ('sticker_thumbnails', 'sticker_thumbnails', true),
    ('stickers', 'stickers', true)
  on conflict (id) do update
    set public = excluded.public,
        name = excluded.name;
exception
  when undefined_table then
    raise notice 'storage.buckets table not found; skipping bucket upsert';
end
$$;

-- Policies on storage.objects (RLS-enabled in Supabase)
do $$
begin
  -- -----------------------
  -- sticker_thumbnails
  -- -----------------------
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public read sticker_thumbnails'
  ) then
    create policy "Public read sticker_thumbnails"
      on storage.objects for select
      using (bucket_id = 'sticker_thumbnails');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public insert sticker_thumbnails'
  ) then
    create policy "Public insert sticker_thumbnails"
      on storage.objects for insert
      with check (bucket_id = 'sticker_thumbnails');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public update sticker_thumbnails'
  ) then
    create policy "Public update sticker_thumbnails"
      on storage.objects for update
      using (bucket_id = 'sticker_thumbnails')
      with check (bucket_id = 'sticker_thumbnails');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public delete sticker_thumbnails'
  ) then
    create policy "Public delete sticker_thumbnails"
      on storage.objects for delete
      using (bucket_id = 'sticker_thumbnails');
  end if;

  -- -----------------------
  -- stickers
  -- -----------------------
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public read stickers'
  ) then
    create policy "Public read stickers"
      on storage.objects for select
      using (bucket_id = 'stickers');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public insert stickers'
  ) then
    create policy "Public insert stickers"
      on storage.objects for insert
      with check (bucket_id = 'stickers');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public update stickers'
  ) then
    create policy "Public update stickers"
      on storage.objects for update
      using (bucket_id = 'stickers')
      with check (bucket_id = 'stickers');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Public delete stickers'
  ) then
    create policy "Public delete stickers"
      on storage.objects for delete
      using (bucket_id = 'stickers');
  end if;
exception
  when undefined_table then
    raise notice 'storage.objects table not found; skipping storage policies';
end
$$;

