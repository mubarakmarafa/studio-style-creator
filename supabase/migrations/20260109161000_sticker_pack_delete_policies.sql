-- Sticker Pack DELETE RLS policies (no-auth / public)
-- Pack Creator UI needs to delete saved styles and subject lists.
-- Without DELETE policies, PostgREST returns: "new row violates row-level security policy".

do $$
begin
  -- sticker_styles
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sticker_styles' and policyname='Public delete sticker_styles'
  ) then
    create policy "Public delete sticker_styles"
      on public.sticker_styles for delete
      using (true);
  end if;

  -- subject_lists
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='subject_lists' and policyname='Public delete subject_lists'
  ) then
    create policy "Public delete subject_lists"
      on public.subject_lists for delete
      using (true);
  end if;

  -- sticker_jobs (used by gallery cancel/delete flows)
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sticker_jobs' and policyname='Public delete sticker_jobs'
  ) then
    create policy "Public delete sticker_jobs"
      on public.sticker_jobs for delete
      using (true);
  end if;

  -- stickers (usually cascaded, but allow direct delete as well)
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='stickers' and policyname='Public delete stickers'
  ) then
    create policy "Public delete stickers"
      on public.stickers for delete
      using (true);
  end if;
exception
  when undefined_table then
    raise notice 'Sticker pack tables not found; skipping delete policies.';
end
$$;

