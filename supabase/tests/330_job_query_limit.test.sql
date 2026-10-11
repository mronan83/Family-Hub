-- [NFR-07] The jobs' queries stop after 60 seconds (D-76): `service_role`, the role the jobs reach
-- the database as, carries a statement timeout; the roles of people and boards keep theirs.
begin;
select plan(2);

select ok((select rolconfig from pg_roles where rolname = 'service_role') @> array['statement_timeout=60s'],
          '[NFR-07] the jobs'' role stops a query after 60 seconds');
select ok(not exists (select from pg_roles where rolname in ('postgres', 'supabase_admin')
                        and rolconfig @> array['statement_timeout=60s']),
          '... and migrations and backups are not limited by it');

select * from finish();
rollback;
