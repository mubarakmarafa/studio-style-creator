-- Persist the JSON prompt used to generate a sticker job/pack
-- This enables UI features like "Copy prompt JSON" from the Gallery.

alter table if exists public.sticker_jobs
add column if not exists prompt_json jsonb;

comment on column public.sticker_jobs.prompt_json is
  'JSON payload describing the generation prompt for this job (style template + subjects, etc).';

