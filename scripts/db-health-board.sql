-- [NFR-12][DEV-05] The board's read as one board (WP-124), for scripts/db-health.sh: in a read-only
-- transaction that is rolled back, board_snapshot() and board_groceries() are each timed :reads
-- times, then the snapshot's time is split by function where the role may set track_functions.
-- Prints timings only.
\set ON_ERROR_STOP on
set default_transaction_read_only = on;
set statement_timeout = '60s';
\set ON_ERROR_STOP off
set track_functions = 'all';
\set ON_ERROR_STOP on
begin read only;
select set_config('role', 'authenticated', true), set_config('request.jwt.claims',
  json_build_object('sub', :'user', 'role', 'authenticated', 'app_metadata',
                    json_build_object('role', 'device', 'device_id', :'device'))::text, true) \g /dev/null
select set_config('db_health.reads', :'reads', true) \g /dev/null
do $$
declare t timestamptz; ms numeric[]; fn text; j jsonb;
  reads integer := current_setting('db_health.reads')::integer;
begin
  foreach fn in array array['board_snapshot', 'board_groceries'] loop
    ms := '{}';
    for i in 1 .. reads loop
      t := clock_timestamp();
      execute format('select public.%I()', fn) into j;
      ms := ms || (extract(epoch from clock_timestamp() - t) * 1000)::numeric;
    end loop;
    raise notice '% ms | min % | median % | max %', fn,
      (select round(min(x), 1) from unnest(ms) x),
      (select round((percentile_cont(0.5) within group (order by x))::numeric, 1) from unnest(ms) x),
      (select round(max(x), 1) from unnest(ms) x);
  end loop;
end $$;
select 'by function, per read | ' || coalesce(string_agg(format('%s %s calls %s ms', funcname,
         calls / :reads, round((self_time / :reads)::numeric, 1)), '; ' order by self_time desc), 'not counted here')
  from (select * from pg_stat_xact_user_functions order by self_time desc limit 8) f;
rollback;
