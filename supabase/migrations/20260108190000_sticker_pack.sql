-- Sticker Pack system schema
-- - saved styles (sticker_styles)
-- - saved subject lists (subject_lists)
-- - async jobs (sticker_jobs) + per-sticker rows (stickers)
-- - Supabase Queues (pgmq) queue: sticker_tasks

-- Extensions
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgmq;

-- Queue (idempotent)
do $$
begin
  if not exists (
    select 1
    from pgmq.list_queues()
    where queue_name = 'sticker_tasks'
  ) then
    perform pgmq.create('sticker_tasks');
  end if;
exception
  when undefined_function then
    -- In case pgmq extension isn't available in this environment.
    raise notice 'pgmq.list_queues() not available; skipping queue creation';
end
$$;

-- Tables
create table if not exists public.sticker_styles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  compiled_template jsonb not null,
  thumbnail_path text,
  thumbnail_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.subject_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  subjects_text text not null,
  subjects jsonb not null default '[]'::jsonb,
  csv_filename text,
  created_at timestamptz not null default now()
);

create table if not exists public.sticker_jobs (
  id uuid primary key default gen_random_uuid(),
  style_id uuid not null references public.sticker_styles(id) on delete restrict,
  subject_list_id uuid not null references public.subject_lists(id) on delete restrict,
  total int not null,
  completed int not null default 0,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sticker_jobs_status_chk check (status in ('queued','running','done','error'))
);

create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.sticker_jobs(id) on delete cascade,
  subject text not null,
  status text not null default 'queued',
  attempts int not null default 0,
  image_path text,
  image_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stickers_status_chk check (status in ('queued','running','done','error'))
);

create index if not exists stickers_job_id_idx on public.stickers(job_id);
create index if not exists sticker_jobs_created_at_idx on public.sticker_jobs(created_at desc);

-- updated_at utility
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists set_updated_at_on_sticker_jobs on public.sticker_jobs;
create trigger set_updated_at_on_sticker_jobs
before update on public.sticker_jobs
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_stickers on public.stickers;
create trigger set_updated_at_on_stickers
before update on public.stickers
for each row
execute function public.set_updated_at();

-- For single-user/no-auth: allow browser clients (anon) to read/write.
-- NOTE: This is intentionally permissive; later we can enable RLS + policies.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.sticker_styles,
  public.subject_lists,
  public.sticker_jobs,
  public.stickers
to anon, authenticated;

