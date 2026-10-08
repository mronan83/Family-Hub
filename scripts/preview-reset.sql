-- Wipes everything the migrations created in the PREVIEW database so each e2e run starts clean
-- (01 §9.5). Never run against production: scripts/preview-db.sh refuses unless the connection
-- string names the preview project.
set client_min_messages = warning;

do $$
declare r record;
begin
  -- Views, tables and routines in public that we created (extension members are left alone)
  for r in
    select format('%I.%I', n.nspname, c.relname) as obj, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm', 'r', 'p', 'f')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     order by c.relkind = 'r'          -- views first
  loop
    execute format('drop %s if exists %s cascade',
      case r.relkind when 'v' then 'view' when 'm' then 'materialized view'
                     when 'f' then 'foreign table' else 'table' end, r.obj);
  end loop;

  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop routine if exists %s cascade', r.fn);
  end loop;

  for r in
    select format('%I.%I', n.nspname, t.typname) as ty
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype in ('c', 'e', 'd')
       and not exists (select 1 from pg_class c where c.reltype = t.oid)
       and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('drop type if exists %s cascade', r.ty);
  end loop;

  -- Migration history, so `supabase db push` reapplies everything
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'truncate supabase_migrations.schema_migrations';
  end if;
end $$;

drop schema if exists private cascade;

-- Test accounts created by e2e runs
delete from auth.users;
