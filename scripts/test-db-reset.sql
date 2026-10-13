-- [NFR-14][WP-60] Empties the test database (D-85) so an e2e run builds it again from the pull
-- request's own migrations: everything the migrations made, and every sign-in, goes. Supabase's own
-- schemas, roles, grants, extensions and the storage bucket stay. Run only by scripts/preview-db.sh,
-- which refuses any database but the test project's; the production database is never reset.
--
-- In one transaction: a failure leaves the test database as it was.
set local client_min_messages = warning;

-- Scheduled jobs and the secrets the app keeps in Vault (job settings, calendar addresses).
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job;
  end if;
exception when insufficient_privilege then
  raise notice 'scheduled jobs left as they are: %', sqlerrm;
end $$;
do $$
begin
  if to_regclass('vault.secrets') is not null then
    delete from vault.secrets
     where name like 'familywise_%' or name in ('job_signing_secret', 'job_base_url');
  end if;
exception when insufficient_privilege then
  raise notice 'Vault entries left as they are: %', sqlerrm;
end $$;

-- The policies the migrations put on storage.objects (the rewards bucket itself stays).
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- Every sign-in, and the schema the app lives in. Dropping private's functions with cascade also
-- removes anything else that used them.
delete from auth.users;
drop schema if exists private cascade;

-- What the migrations made in public: tables (with their views, policies, triggers and sequences),
-- then functions and types. Objects an extension owns are left to the extension; the schema, its
-- grants and its default privileges stay as Supabase set them.
do $$
declare
  r record;
begin
  for r in
    select c.oid, c.relkind
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
       and not exists (select from pg_depend d where d.objid = c.oid and d.deptype = 'e')
       -- A sequence a table's column owns (serial, identity) goes with its table.
       and not exists (select from pg_depend d
                        where d.classid = 'pg_class'::regclass and d.objid = c.oid
                          and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i'))
     order by array_position(array['r', 'p', 'f', 'm', 'v', 'S']::"char"[], c.relkind), c.oid
  loop
    -- A table's cascade may already have taken this one (its sequence, a view on it).
    continue when not exists (select from pg_class where oid = r.oid);
    execute format('drop %s if exists %s cascade',
      case r.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'S' then 'sequence'
                     when 'f' then 'foreign table' else 'table' end,
      r.oid::regclass);
  end loop;
  for r in
    select p.oid, p.prokind
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not exists (select from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    continue when not exists (select from pg_proc where oid = r.oid);
    execute format('drop %s if exists %s cascade',
      case r.prokind when 'p' then 'procedure' else 'function' end, r.oid::regprocedure);
  end loop;
  for r in
    select t.oid
      from pg_type t
     where t.typnamespace = 'public'::regnamespace
       and t.typtype in ('e', 'c', 'd')
       and (t.typtype <> 'c' or exists (select from pg_class c where c.oid = t.typrelid and c.relkind = 'c'))
       and not exists (select from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    continue when not exists (select from pg_type where oid = r.oid);
    execute format('drop type if exists %s cascade', r.oid::regtype);
  end loop;
end $$;

-- The migration history, so every migration in the checkout applies again.
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    truncate supabase_migrations.schema_migrations;
  end if;
end $$;
