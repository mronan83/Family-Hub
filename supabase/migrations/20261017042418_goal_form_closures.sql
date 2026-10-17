-- [NFR-16][D-128] The goal form's live summaries (WP-101) name the day the school is closed: "This
-- week Homework home is due 4 days for Maya (Friday, Oct 16 is a teacher planning day)". The preview's
-- facts gain the closures on the weekdays around today: for the goal's person, the school year they
-- follow; for a family goal, each child's and the household's default year (member_id null). The rest
-- of goal_preview_facts is as before (20261016222454_perfect_periods.sql).

create function private.goal_closures(p_household uuid, p_member uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with who as (
    select p_member as member_id where p_member is not null
    union all
    select m.id from public.member m
     where p_member is null and m.household_id = p_household and m.archived_at is null and m.earns_rewards
    union all
    select null::uuid where p_member is null
  ), days as (
    select w.member_id, d::date as day,
           case when w.member_id is not null then public.member_school_year(w.member_id, d::date)
                else (select y.id from public.school_year y
                       where y.household_id = p_household and y.is_default and y.archived_at is null
                         and d::date between y.start_date and y.end_date
                       limit 1) end as year_id
      from who w, generate_series(p_from, p_to, interval '1 day') d
     where extract(isodow from d) < 6
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', x.day, 'member_id', x.member_id,
                                               'name', x.name, 'kind', x.closure_type)
                            order by x.day, x.member_id nulls last), '[]'::jsonb)
    from (select distinct on (d.member_id, d.day) d.member_id, d.day, c.name, c.closure_type
            from days d
            join public.school_closure c
              on c.school_year_id = d.year_id and d.day between c.start_date and c.end_date
           order by d.member_id, d.day, c.start_date desc, c.name) x
$$;
revoke all on function private.goal_closures(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.goal_preview_facts(p_goal jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_household uuid;
  v_id        uuid;
  v_member    uuid;
  v_start     date;
  v_end       date;
  v_status    text;
  v_today     date;
  v_week      integer;
  v_repeats   text := coalesce(p_goal ->> 'repeat', 'none');
begin
  begin
    v_household := (p_goal ->> 'household_id')::uuid;
    v_id := nullif(p_goal ->> 'id', '')::uuid;
    v_member := nullif(p_goal ->> 'member_id', '')::uuid;
    v_start := (p_goal ->> 'start_date')::date;
    v_end := nullif(p_goal ->> 'end_date', '')::date;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'bad goal' using errcode = '22023', hint = 'bad_request';
  end;
  if auth.uid() is null or v_household is null or v_household not in (select private.admin_household_ids()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_start is null or (v_end is not null and v_end < v_start)
     or v_repeats not in ('none', 'week', 'month', 'term') then
    raise exception 'a start, and an end not before it' using errcode = '22023', hint = 'bad_request';
  end if;
  if v_member is not null and not exists (select from public.member m
                                           where m.id = v_member and m.household_id = v_household) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select g.status into v_status from public.reward_goal g where g.id = v_id and g.household_id = v_household;
  v_today := private.household_today(v_household);
  select h.week_start into v_week from public.household h where h.id = v_household;
  return jsonb_build_object(
    'as_of', v_today,
    'week_start', v_week,
    'status', coalesce(v_status, 'scheduled'),
    'saved', v_status is not null,
    'terms', case when v_repeats = 'term' then private.goal_terms(v_household, v_member) else '[]'::jsonb end,
    -- [RWD-20] The children who earn rewards; [RWD-19] the periods of each goal its rules count.
    'members', private.goal_children(v_household),
    -- [NFR-16][D-128] The school's closures around today, so the form's summary names the day off.
    'closures', private.goal_closures(v_household, v_member, v_today - 31, v_today + 31),
    'sources', private.goal_sources(v_household, array(
                 select (r.value -> 'params' ->> 'goal_id')::uuid
                   from jsonb_array_elements(case when jsonb_typeof(p_goal -> 'rules') = 'array'
                                                  then p_goal -> 'rules' else '[]'::jsonb end) r
                  where r.value ->> 'type' = 'PERIODS_WON'
                    and coalesce(r.value -> 'params' ->> 'goal_id', '')
                        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')),
    'facts', private.goal_facts_between(v_household, v_member, v_start,
                                        case when v_repeats = 'none' then least(coalesce(v_end, v_today), v_today)
                                             else least(coalesce(v_end, v_today + 14), v_today + 14) end));
end $$;
