-- Style Builder Projects schema
-- - project-based workspace for Style Builder
-- - store snapshots (nodes/edges) + image assets (uploaded/generated/thumbnails)

create extension if not exists pgcrypto with schema extensions;

-- Tables
create table if not exists public.style_builder_projects (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  name text not null default 'Untitled project',
  description text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  thumbnail_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.style_builder_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.style_builder_projects(id) on delete cascade,
  kind text not null,
  storage_bucket text not null default 'style_builder_assets',
  storage_path text not null,
  public_url text,
  node_id text,
  subject text,
  created_at timestamptz not null default now(),
  constraint style_builder_assets_kind_chk check (kind in ('uploaded','generated','thumbnail'))
);

-- Add thumbnail FK after both tables exist (avoids circular FK ordering issues)
do $$
begin
  alter table public.style_builder_projects
    drop constraint if exists style_builder_projects_thumbnail_asset_fk;
  alter table public.style_builder_projects
    add constraint style_builder_projects_thumbnail_asset_fk
    foreign key (thumbnail_asset_id)
    references public.style_builder_assets(id)
    on delete set null;
exception
  when others then
    -- Some environments may not allow ALTER in a DO block during initial setup; fail loudly.
    raise;
end
$$;

create index if not exists style_builder_projects_client_id_idx on public.style_builder_projects(client_id);
create index if not exists style_builder_projects_updated_at_idx on public.style_builder_projects(updated_at desc);
create index if not exists style_builder_assets_project_id_idx on public.style_builder_assets(project_id);

-- updated_at utility (shared across tables)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists set_updated_at_on_style_builder_projects on public.style_builder_projects;
create trigger set_updated_at_on_style_builder_projects
before update on public.style_builder_projects
for each row
execute function public.set_updated_at();

-- Storage bucket (public) for project assets
-- NOTE: Requires Supabase Storage. If Storage isn't installed, this will fail.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('style_builder_assets', 'style_builder_assets', true)
  on conflict (id) do update set public = excluded.public, name = excluded.name;
exception
  when undefined_table then
    raise notice 'storage.buckets table not found; skipping bucket creation';
end
$$;

-- For single-user/no-auth: allow browser clients (anon) to read/write.
-- NOTE: This is intentionally permissive; later we can enable RLS + policies.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.style_builder_projects,
  public.style_builder_assets
to anon, authenticated;

