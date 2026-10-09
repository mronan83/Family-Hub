-- [NFR-07] Job scheduler (01 §5.6, SPIKE-05): pg_cron starts each background job on time and pg_net
-- makes its HTTPS call to the job endpoint on Vercel. Hosted Supabase ships both extensions; the
-- native Postgres that CI tests on does not, so each is enabled only where it is available.

do $$
begin
  if exists (select from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
  end if;
end $$;
