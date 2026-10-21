-- [DEV-05][MEAL-09] lunch_week() works out each child's day once (WP-113). The board reads it in every
-- snapshot (board_snapshot(), the board's one read after each change), and it was two thirds of the
-- snapshot's time: Postgres pulls a `lateral (select f(...) as x)` up into the query and copies the
-- call into every place x is used, so lunch_mode(), used seven times for each child's day, ran seven
-- times (each running resolve_day_type() again), and the day's type twice more. These helpers can't
-- be inlined (they set search_path), so each call is a whole query. Measured on a local copy with the
-- migrations and 46 spec households, as a board, three times 50 reads: board_snapshot() took 66 to
-- 80 ms (median), 28 to 35 ms now, its lunches 66 ms of it before and 9 ms now. On the free test
-- project the board's read takes 0.6 to 4.9 s, and timed out (8 s) in 7 of the e2e runs 244 to 256.
--
-- The answer is the same, field for field (compared on 1,150 households × weeks, school days, breaks
-- and days off among them): the day's type is worked out once, in a lateral that `offset 0` keeps
-- from being pulled up; lunch_mode()'s answer comes from it (the members here are all children);
-- `changed` is a lunch_override on a school day, as before.
create or replace function public.lunch_week(p_household uuid, p_from date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
begin
  if p_household is null or p_from is null
     or not (p_household in (select private.admin_household_ids())
             or p_household = private.device_household_id()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  v_today := private.household_today(p_household);
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
                        -- The day's type once per child and day (offset 0: worked out here, not copied into
                        -- each use), and lunch_mode()'s answer from it.
                        cross join lateral (select public.resolve_day_type(m.id, d.day) as day_type offset 0) t
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
end $$;
