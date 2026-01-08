-- Add cancelled status for sticker jobs / stickers (for cancel flow + worker skip logic)

do $$
begin
  alter table public.sticker_jobs drop constraint if exists sticker_jobs_status_chk;
  alter table public.sticker_jobs
    add constraint sticker_jobs_status_chk check (status in ('queued','running','done','error','cancelled'));

  alter table public.stickers drop constraint if exists stickers_status_chk;
  alter table public.stickers
    add constraint stickers_status_chk check (status in ('queued','running','done','error','cancelled'));
end
$$;

