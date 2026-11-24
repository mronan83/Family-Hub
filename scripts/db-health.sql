-- [NFR-12][DEV-05] Where a database spends its time (WP-124). Read only: the session is set read
-- only before anything else, and every read of a board runs in a read-only transaction that is
-- rolled back. Reports timings, sizes and counts only: households and boards are numbered, nothing
-- is named, and statements are shown as pg_stat_statements keeps them (constants replaced by $n).
-- Run by scripts/db-health.sh; psql 15+.
\set ON_ERROR_STOP on
\set QUIET on
\pset footer off
set default_transaction_read_only = on;
set statement_timeout = '60s';
set application_name = 'db-health';

\echo '## Server'
select current_setting('server_version') as version,
       pg_size_pretty(pg_database_size(current_database())) as database,
       current_setting('shared_buffers') as shared_buffers,
       current_setting('work_mem') as work_mem,
       current_setting('max_connections') as max_connections,
       (select count(*) from pg_stat_activity) as connections,
       now() - pg_postmaster_start_time() as up_for;

\echo '## Statement timeouts per role'
select r.rolname as role, coalesce(
         (select s from unnest(r.rolconfig) s where s like 'statement_timeout=%'), '-') as setting
  from pg_roles r where r.rolname in ('anon', 'authenticated', 'authenticator', 'postgres', 'service_role')
 order by 1;

\echo '## Cache and work since the statistics were reset'
select stats_reset::date as since,
       round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) as cache_hit_pct,
       blks_read, xact_commit, xact_rollback, temp_files, pg_size_pretty(temp_bytes) as temp,
       deadlocks, round(blk_read_time) as read_ms
  from pg_stat_database where datname = current_database();

\echo '## The largest relations, all schemas (dead rows are the ones vacuum has still to clear)'
select n.nspname as schema, c.relname as relation, pg_size_pretty(pg_total_relation_size(c.oid)) as size,
       s.n_live_tup as live, s.n_dead_tup as dead, s.seq_scan,
       coalesce(greatest(s.last_autovacuum, s.last_vacuum)::text, '-') as vacuumed
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_all_tables s on s.relid = c.oid
 where c.relkind in ('r', 'm')
 order by pg_total_relation_size(c.oid) desc limit 20;

\echo '## The system catalogs a new table, function or policy writes to'
select c.relname as catalog, pg_size_pretty(pg_total_relation_size(c.oid)) as size,
       s.n_live_tup as live, s.n_dead_tup as dead,
       coalesce(greatest(s.last_autovacuum, s.last_vacuum)::text, '-') as vacuumed
  from pg_class c join pg_stat_all_tables s on s.relid = c.oid
 where c.relnamespace = 'pg_catalog'::regnamespace
   and c.relname in ('pg_class', 'pg_attribute', 'pg_proc', 'pg_type', 'pg_depend', 'pg_policy',
                     'pg_index', 'pg_constraint', 'pg_trigger', 'pg_statistic')
 order by pg_total_relation_size(c.oid) desc;

\echo '## Rows that grow with use (counts only)'
select what, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s %s', rel, cond),
                                                  false, true, '')))[1]::text::bigint as rows
  from (values ('households', 'public.household', ''),
               ('active boards', 'public.device', 'where status = ''active'''),
               ('members', 'public.member', ''),
               ('chore occurrences', 'public.chore_occurrence', ''),
               ('points ledger', 'public.points_ledger', ''),
               ('auth users', 'auth.users', ''),
               ('auth sessions', 'auth.sessions', ''),
               ('auth refresh tokens', 'auth.refresh_tokens', ''),
               ('auth audit log', 'auth.audit_log_entries', ''),
               ('realtime subscriptions', 'realtime.subscription', ''),
               ('realtime messages', 'realtime.messages', ''),
               -- [DEV-05][WP-126] Broadcast from the database to the boards (D-159).
               ('board messages, last hour', 'realtime.messages',
                'where topic like ''board:%'' and inserted_at > now() - interval ''1 hour'''),
               ('pg_net responses', 'net._http_response', ''),
               ('cron run history', 'cron.job_run_details', '')) t(what, rel, cond)
 where to_regclass(rel) is not null;

\echo '## Connections now, by who and what they wait on'
select coalesce(nullif(usename, ''), '-') as role, coalesce(nullif(application_name, ''), '-') as app,
       coalesce(state, '-') as state, coalesce(wait_event_type || ':' || wait_event, 'cpu or none') as wait,
       count(*) as n
  from pg_stat_activity where pid <> pg_backend_pid()
 group by 1, 2, 3, 4 order by n desc, 1 limit 25;

\echo '## Broadcast from the database (WP-126): what the board triggers need'
select current_user as "migrations run as",
       to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null as "send() exists",
       to_regprocedure('realtime.topic()') is not null as "topic() exists",
       coalesce(has_function_privilege('realtime.send(jsonb, text, text, boolean)', 'execute'), false) as "may send",
       coalesce(has_table_privilege('realtime.messages', 'insert'), false) as "may insert",
       (select rolbypassrls from pg_roles where rolname = current_user) as "bypasses RLS",
       (select count(*) from pg_trigger where tgname like 'board\_notify\_%') as "board triggers"
 where to_regclass('realtime.messages') is not null;

\echo '## Replication slots (Realtime reads changes through one)'
select slot_name, plugin, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as wal_held
  from pg_replication_slots;

\echo '## Logical decoding (Realtime): what spilled to disk'
select slot_name, pg_size_pretty(spill_bytes) as spilled, spill_txns, pg_size_pretty(total_bytes) as decoded,
       total_txns, stats_reset::date as since
  from pg_stat_replication_slots;

\echo '## Disk reads and writes by kind of backend (pg_stat_io), the largest'
select backend_type, object, context, reads, writes, extends, round(read_time) as read_ms,
       round(write_time) as write_ms
  from pg_stat_io where coalesce(reads, 0) + coalesce(writes, 0) + coalesce(extends, 0) > 0
 order by coalesce(reads, 0) + coalesce(writes, 0) + coalesce(extends, 0) desc limit 12;

\echo '## A trivial query, 20 times (the e2e probe: a count of pg_class), ms'
do $$
declare t timestamptz; ms numeric[] := '{}'; n bigint;
begin
  for i in 1 .. 20 loop
    t := clock_timestamp();
    select count(*) into n from pg_catalog.pg_class;
    ms := ms || (extract(epoch from clock_timestamp() - t) * 1000)::numeric;
  end loop;
  raise notice 'probe | min % | median % | max %', (select round(min(x), 1) from unnest(ms) x),
    (select round((percentile_cont(0.5) within group (order by x))::numeric, 1) from unnest(ms) x),
    (select round(max(x), 1) from unnest(ms) x);
end $$;

select exists (select from pg_extension where extname = 'pg_stat_statements')
       and current_setting('shared_preload_libraries') like '%pg_stat_statements%' as statements \gset
\if :statements
-- A label for each statement: the data API's calls by the function or table they reach, others by
-- their first words. Constants are already $n in pg_stat_statements. (A psql variable, not a view:
-- the session is read only.)
\set labelled '(select *, case when query like ''WITH pgrst_source%'' then ''api '' || coalesce(substring(query from ''"public"\\."([a-z_]+)"''), ''?'') else left(regexp_replace(query, ''\\s+'', '' '', ''g''), 80) end as private_label from extensions.pg_stat_statements) s'
\echo '## The statements that took the most time since the statistics were reset'
select calls, round(total_exec_time) as total_ms, round(mean_exec_time::numeric, 1) as mean_ms,
       round(max_exec_time) as max_ms, shared_blks_read as blks_read,
       private_label as statement
  from :labelled
 order by total_exec_time desc limit 25;

\echo '## The slowest statements on average (called at least 5 times)'
select calls, round(mean_exec_time::numeric, 1) as mean_ms, round(max_exec_time) as max_ms,
       private_label as statement
  from :labelled where calls >= 5
 order by mean_exec_time desc limit 15;

\echo '## The statements that wrote the most to temporary files (a sort or a result too big for work_mem)'
select calls, pg_size_pretty(temp_blks_written * 8192) as temp_written,
       pg_size_pretty(temp_blks_written * 8192 / greatest(calls, 1)) as per_call,
       round(mean_exec_time::numeric, 1) as mean_ms, private_label as statement
  from :labelled where temp_blks_written > 0
 order by temp_blks_written desc limit 10;
\else
\echo 'pg_stat_statements is not loaded here'
\endif
