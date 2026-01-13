-- Template modules + template assembler schema (no-auth / single-user posture)
-- - Mirrors Style Builder's permissive approach (client-scoped rows + anon grants)
-- - Stores module specs (layout/module), assemblies (graphs), batch jobs, and generated outputs

create extension if not exists pgcrypto with schema extensions;

-- Modules created in Module Forge
create table if not exists public.template_modules (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  kind text not null,
  name text not null default 'Untitled',
  spec_json jsonb not null default '{}'::jsonb,
  preview_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_modules_kind_chk check (kind in ('layout','module'))
);

create index if not exists template_modules_client_id_idx on public.template_modules(client_id);
create index if not exists template_modules_updated_at_idx on public.template_modules(updated_at desc);

-- Saved graphs created in Template Assembler
create table if not exists public.template_assemblies (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  name text not null default 'Untitled assembly',
  description text not null default '',
  graph_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists template_assemblies_client_id_idx on public.template_assemblies(client_id);
create index if not exists template_assemblies_updated_at_idx on public.template_assemblies(updated_at desc);

-- Batch job to generate template combinations
create table if not exists public.template_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  assembly_id uuid references public.template_assemblies(id) on delete set null,
  name text not null default 'Generation job',
  total integer not null default 0,
  completed integer not null default 0,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_jobs_status_chk check (status in ('queued','running','done','error','cancelled'))
);

create index if not exists template_jobs_client_id_idx on public.template_jobs(client_id);
create index if not exists template_jobs_created_at_idx on public.template_jobs(created_at desc);

-- One row per combination to generate
create table if not exists public.template_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.template_jobs(id) on delete cascade,
  idx integer not null default 0,
  status text not null default 'queued',
  error text,
  template_spec_json jsonb not null default '{}'::jsonb,
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_job_items_status_chk check (status in ('queued','running','done','error','cancelled'))
);

create index if not exists template_job_items_job_id_idx on public.template_job_items(job_id);
create index if not exists template_job_items_status_idx on public.template_job_items(status);

-- Optional convenience table: finalized generated templates
create table if not exists public.generated_templates (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  job_id uuid references public.template_jobs(id) on delete set null,
  job_item_id uuid references public.template_job_items(id) on delete set null,
  template_spec_json jsonb not null default '{}'::jsonb,
  pdf_path text,
  created_at timestamptz not null default now()
);

create index if not exists generated_templates_client_id_idx on public.generated_templates(client_id);
create index if not exists generated_templates_created_at_idx on public.generated_templates(created_at desc);

-- Ensure updated_at utility exists (Style Builder migration defines it, but keep idempotent here)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Triggers
drop trigger if exists set_updated_at_on_template_modules on public.template_modules;
create trigger set_updated_at_on_template_modules
before update on public.template_modules
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_template_assemblies on public.template_assemblies;
create trigger set_updated_at_on_template_assemblies
before update on public.template_assemblies
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_template_jobs on public.template_jobs;
create trigger set_updated_at_on_template_jobs
before update on public.template_jobs
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_template_job_items on public.template_job_items;
create trigger set_updated_at_on_template_job_items
before update on public.template_job_items
for each row
execute function public.set_updated_at();

-- Storage buckets for templates (public, no-auth)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('template_assets', 'template_assets', true)
  on conflict (id) do update set public = excluded.public, name = excluded.name;

  insert into storage.buckets (id, name, public)
  values ('template_pdfs', 'template_pdfs', true)
  on conflict (id) do update set public = excluded.public, name = excluded.name;
exception
  when undefined_table then
    raise notice 'storage.buckets table not found; skipping bucket creation';
end
$$;

-- For single-user/no-auth: allow browser clients (anon) to read/write.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.template_modules,
  public.template_assemblies,
  public.template_jobs,
  public.template_job_items,
  public.generated_templates
to anon, authenticated;

