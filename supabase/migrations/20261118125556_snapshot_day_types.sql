-- [DEV-05][NFR-12] The board's read, lighter (WP-124). Measured on production and the test project
-- (scripts/db-health.sh), a board's snapshot spends about half its time in the school-day functions:
-- school_days() and lunch_week() asked resolve_day_type() once per member and day (22 to 45 times a
-- read), each a query of its own through member_school_year() and school_day_type(), each under the
-- board's RLS (device_household_id() 89 to 108 times a read). And job_health(), which every board and
-- Home read, scanned every job_run row of the household twice: on production, 575 ms a call on average
-- and growing with each run the jobs record.
--
-- 1. private.day_types(): every member's day type over a range of days, in one query, with the same
--    answer as resolve_day_type() for each member and day (pgTAP compares them). Security definer, so
--    no RLS per row; it is not in an exposed schema, and its callers check who is asking first.
-- 2. school_days() and lunch_week() use it.
-- 3. job_health() reads each job's latest run and latest healthy run through an index, a row each,
--    with the same answer.

create function private.day_types(p_household uuid, p_from date, p_to date)
returns table (member_id uuid, day date, day_type text)
-- jit off: the planner guesses 1,000 days for generate_series(), so a 9-day read looks costly enough
-- to compile, and compiling took 50 ms of a query that runs in under 1 ms.
language sql stable security definer set search_path = '' set jit = off as $$
  -- As resolve_day_type(): the member's own school year that covers the day (member_school_year(),
  -- profiles may not overlap), else the household's default year (default years may not overlap);
  -- then school_day_type() for that year and day.
  select m.id, d.day,
         case
           when extract(isodow from d.day) in (6, 7) then 'weekend'
           when y.id is null then 'summer'
           when exists (select from public.school_closure c
                         where c.school_year_id = y.id and c.closure_type = 'break'
                           and d.day between c.start_date and c.end_date) then 'break'
           when exists (select from public.school_closure c
                         where c.school_year_id = y.id
                           and d.day between c.start_date and c.end_date) then 'no_school'
           else 'school_day'
         end
    from public.member m
   cross join lateral (select g::date as day
                         from generate_series(p_from, p_to, interval '1 day') g) d
   cross join lateral (
     select coalesce(
       (select sy.id
          from public.member_school_profile p
          join public.school_year sy on sy.id = p.school_year_id
         where p.member_id = m.id and sy.archived_at is null
           and d.day between sy.start_date and sy.end_date
         limit 1),
       (select sy.id
          from public.school_year sy
         where sy.household_id = m.household_id and sy.is_default and sy.archived_at is null
           and d.day between sy.start_date and sy.end_date
         limit 1)) as id
     offset 0) y -- worked out once per member and day, not copied into each use above
   where m.household_id = p_household and p_to - p_from <= 400
$$;
revoke all on function private.day_types(uuid, date, date) from public, anon;
grant execute on function private.day_types(uuid, date, date) to authenticated, service_role;

create or replace function public.school_days(p_household_id uuid, p_from date, p_to date)
returns setof date
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'school days cover 1 to 401 days' using errcode = '22023', hint = 'bad_range';
  end if;
  -- Only the household's admins and boards; anyone else sees no days (as RLS would show them).
  if p_household_id is null
     or (p_household_id not in (select private.admin_household_ids())
         and p_household_id is distinct from (select private.device_household_id())) then
    return;
  end if;
  if not exists (select from public.school_year y
                  where y.household_id = p_household_id and y.archived_at is null) then
    return query
      select d::date from generate_series(p_from, p_to, interval '1 day') d
       where extract(isodow from d) < 6
       order by 1;
    return;
  end if;
  -- A day any member still in the household has school (WP-124: their day types in one query).
  return query
    select t.day
      from private.day_types(p_household_id, p_from, p_to) t
      join public.member m on m.id = t.member_id and m.archived_at is null
     where t.day_type = 'school_day'
     group by t.day
     order by 1;
end $$;

create or replace function public.lunch_week(p_household uuid, p_from date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date;
  -- [DEV-05] Each child's day type for the week, worked out in one query (WP-124).
  v_types jsonb;
begin
  if p_household is null or p_from is null
     or not (p_household in (select private.admin_household_ids())
             or p_household = private.device_household_id()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_today := private.household_today(p_household);
  v_types := (select jsonb_object_agg(t.member_id::text || ' ' || t.day::text, t.day_type)
                from private.day_types(p_household, p_from, p_from + 6) t);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'member_id', m.id,
             'usual', coalesce(l.defaults, '{}'::jsonb),
             'menu_source_id', l.menu_source_id,
             'menu_name', s.name,
             'days', (select jsonb_agg(jsonb_build_object(
                               'date', d.day,
                               'day_type', t.day_type,
                               'mode', x.mode,
                               'changed', o.id is not null and t.day_type = 'school_day',
                               'menu', case when x.mode is not null and l.menu_source_id is not null
                                            then private.menu_on(l.menu_source_id, d.day) end,
                               'open', x.mode is not null and now() < x.until and d.day <= v_today + 21,
                               'open_until', case when x.mode is not null then x.until end,
                               'choices', case when x.mode = 'buy' then private.lunch_choices_of(m.id, d.day) end,
                               'request', (select jsonb_build_object(
                                                    'id', r.id, 'mode', r.mode, 'choices', r.choices,
                                                    'status', r.status, 'requested_at', r.requested_at,
                                                    'decided_by', (select dm.display_name from public.member dm
                                                                    where dm.household_id = p_household
                                                                      and dm.user_id = r.decided_by))
                                             from public.lunch_request r
                                            where r.member_id = m.id and r.lunch_date = d.day and x.mode is not null
                                              and ((r.status = 'waiting' and r.open_until > now())
                                                   or (r.status = 'kept' and r.seen_at is null and d.day >= v_today))),
                               'by_board', exists (select from public.lunch_request r
                                                    where r.member_id = m.id and r.lunch_date = d.day
                                                      and r.status = 'approved' and r.mode = x.mode))
                             order by d.day)
                        from generate_series(p_from, p_from + 6, interval '1 day') g (t)
                        cross join lateral (select g.t::date as day) d
                        -- The day's type once per child and day (worked out above for the whole week), and
                        -- lunch_mode()'s answer from it.
                        cross join lateral (select v_types ->> (m.id::text || ' ' || d.day::text) as day_type offset 0) t
                        left join public.lunch_override o on o.member_id = m.id and o.lunch_date = d.day
                        cross join lateral (select case when t.day_type <> 'school_day' then null
                                                        else coalesce(o.mode, private.usual_lunch(m.id, d.day))
                                                   end as mode,
                                                   private.lunch_open_until(p_household, d.day) as until offset 0) x))
           order by m.display_name, m.id)
      from public.member m
      left join public.member_lunch l on l.member_id = m.id
      left join public.menu_source s on s.id = l.menu_source_id
     where m.household_id = p_household and m.role = 'child' and m.archived_at is null), '[]'::jsonb);
end $function$;

-- Each job's latest healthy run, newest first, a row away (job_health()'s last_ok).
create index job_run_last_ok_idx on public.job_run
  (household_id, job_type, (coalesce(finished_at, started_at)) desc)
  where status in ('ok', 'skipped');

create or replace function public.job_health(p_household_id uuid)
returns table (job_type text, state text, last_ok_at timestamptz, last_run_at timestamptz, message text)
language sql stable set search_path = '' as $$
  select s.job_type,
         case
           when l.started_at is null then 'never'
           when l.status = 'error' then 'failing'
           when l.status = 'running' and l.started_at < now() - interval '5 minutes' then 'failing'
           when l.status = 'running' then 'running'
           when o.at is null or o.at < now() - make_interval(mins => 2 * s.every_minutes) then 'stale'
           else 'ok'
         end,
         o.at,
         l.started_at,
         case
           when l.status = 'error' then l.error
           when l.status = 'running' and l.started_at < now() - interval '5 minutes' then 'no result after 5 minutes'
         end
    from private.job_schedule s
    -- The job's latest run (job_run_household_id_job_type_started_at_idx).
    left join lateral (select r.status, r.started_at, r.error
                         from public.job_run r
                        where r.household_id = p_household_id and r.job_type = s.job_type
                        order by r.started_at desc
                        limit 1) l on true
    -- Its latest healthy one: a skipped run (nothing to do yet, or out of time with the rest left for
    -- the next call) is healthy (job_run_last_ok_idx).
    left join lateral (select coalesce(r.finished_at, r.started_at) as at
                         from public.job_run r
                        where r.household_id = p_household_id and r.job_type = s.job_type
                          and r.status in ('ok', 'skipped')
                        order by coalesce(r.finished_at, r.started_at) desc
                        limit 1) o on true
   where s.kind = 'http'
   order by s.job_type
$$;
