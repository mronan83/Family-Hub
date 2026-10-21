-- [NFR-12] The preview's own path to the database, timed (WP-113). A save in the admin app goes from
-- the browser to the preview's function and from there to the database; the e2e run times only its
-- own path to the database, so a save that never answered while the preview's path was slow read as
-- an assertion failure. GET /api/health/db (previews only) calls this and says how long it took; the
-- run asks every 15 s. It reads nothing and changes nothing, so anyone may call it.
create function public.db_probe() returns integer
language sql stable set search_path = '' as $$
  select 1
$$;
revoke all on function public.db_probe() from public;
grant execute on function public.db_probe() to anon, authenticated, service_role;
