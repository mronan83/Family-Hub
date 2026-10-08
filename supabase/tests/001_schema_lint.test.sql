-- [NFR-04][NFR-09] Migration lint: every public table has RLS enabled and a household_id column
-- (the household table's own id is the tenant key). Runs after all migrations, so a migration that
-- adds a table without RLS or household_id fails CI.
begin;
select plan(3);

select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every public table has row level security enabled'
);

select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'household'
        and not exists (
          select 1 from pg_attribute a
           where a.attrelid = c.oid and a.attname = 'household_id' and a.attnotnull and not a.attisdropped) $$,
  'every public table except household has a non-null household_id'
);

select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon cannot execute private helper functions'
);

select * from finish();
rollback;
