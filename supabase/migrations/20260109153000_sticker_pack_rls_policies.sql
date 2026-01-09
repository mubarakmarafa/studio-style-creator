-- Sticker Pack RLS policies (no-auth / public)
-- If RLS is enabled on these tables, anon inserts/updates will fail unless policies exist.
-- This migration makes the sticker pack tables behave like the rest of the app: permissive single-user/no-auth.

do $$
begin
  -- Ensure RLS is enabled (safe if already enabled)
  alter table public.sticker_styles enable row level security;
  alter table public.subject_lists enable row level security;
  alter table public.sticker_jobs enable row level security;
  alter table public.stickers enable row level security;
exception
  when undefined_table then
    raise notice 'Sticker pack tables not found; skipping RLS enable.';
end
$$;

-- Policies (idempotent via pg_policies checks)
do $$
begin
  -- -----------------------
  -- sticker_styles
  -- -----------------------
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sticker_styles' and policyname = 'Public read sticker_styles'
  ) then
    create policy "Public read sticker_styles"
      on public.sticker_styles for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sticker_styles' and policyname = 'Public insert sticker_styles'
  ) then
    create policy "Public insert sticker_styles"
      on public.sticker_styles for insert
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sticker_styles' and policyname = 'Public update sticker_styles'
  ) then
    create policy "Public update sticker_styles"
      on public.sticker_styles for update
      using (true)
      with check (true);
  end if;

  -- -----------------------
  -- subject_lists
  -- -----------------------
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subject_lists' and policyname = 'Public read subject_lists'
  ) then
    create policy "Public read subject_lists"
      on public.subject_lists for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subject_lists' and policyname = 'Public insert subject_lists'
  ) then
    create policy "Public insert subject_lists"
      on public.subject_lists for insert
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subject_lists' and policyname = 'Public update subject_lists'
  ) then
    create policy "Public update subject_lists"
      on public.subject_lists for update
      using (true)
      with check (true);
  end if;

  -- -----------------------
  -- sticker_jobs
  -- -----------------------
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sticker_jobs' and policyname = 'Public read sticker_jobs'
  ) then
    create policy "Public read sticker_jobs"
      on public.sticker_jobs for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sticker_jobs' and policyname = 'Public insert sticker_jobs'
  ) then
    create policy "Public insert sticker_jobs"
      on public.sticker_jobs for insert
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sticker_jobs' and policyname = 'Public update sticker_jobs'
  ) then
    create policy "Public update sticker_jobs"
      on public.sticker_jobs for update
      using (true)
      with check (true);
  end if;

  -- -----------------------
  -- stickers
  -- -----------------------
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stickers' and policyname = 'Public read stickers'
  ) then
    create policy "Public read stickers"
      on public.stickers for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stickers' and policyname = 'Public insert stickers'
  ) then
    create policy "Public insert stickers"
      on public.stickers for insert
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stickers' and policyname = 'Public update stickers'
  ) then
    create policy "Public update stickers"
      on public.stickers for update
      using (true)
      with check (true);
  end if;
exception
  when others then
    -- Fail loudly if something unexpected happens so we don't silently keep broken RLS.
    raise;
end
$$;

