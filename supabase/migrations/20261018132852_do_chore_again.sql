-- [CHR-23][D-132] Do again (WP-96): a completed one-time item done again is a new one-time item on
-- the date the admin picks, with the same people, points, time, icon, tags and settings. The
-- original is not touched: it keeps its completion, the points it paid and its goal credit, and is
-- never reopened. Under the admin's RLS (security invoker), as save_chore is; the new item's creator
-- is the admin (chore_guard), and its occurrences are planned by the usual triggers.
create function public.do_chore_again(
  p_household_id uuid,
  p_chore_id     uuid,
  p_on_date      date
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.chore;
  v_id  uuid := gen_random_uuid();
begin
  select * into v_old from public.chore where id = p_chore_id and household_id = p_household_id;
  if not found then
    raise exception 'that item was not found' using errcode = 'P0002', hint = 'chore_not_found';
  end if;
  if v_old.schedule ->> 'freq' <> 'once' then
    raise exception 'only a one-time item is done again' using errcode = '23514', hint = 'chore_not_once';
  end if;
  if p_on_date is null then
    raise exception 'pick a date' using errcode = '23514', hint = 'chore_needs_date';
  end if;

  insert into public.chore (id, household_id, title, description, icon, kind, points, approval,
                            schedule, due_time, day_types, visibility, assignment, lunch_days,
                            remind_lead_minutes, opens)
  values (v_id, p_household_id, v_old.title, v_old.description, v_old.icon, v_old.kind, v_old.points,
          v_old.approval, jsonb_build_object('freq', 'once', 'on_date', p_on_date), v_old.due_time,
          v_old.day_types, v_old.visibility, v_old.assignment, v_old.lunch_days,
          v_old.remind_lead_minutes, v_old.opens);

  -- The same people, leaving out anyone archived since.
  insert into public.chore_assignee (household_id, chore_id, member_id)
  select p_household_id, v_id, a.member_id
    from public.chore_assignee a
    join public.member m on m.id = a.member_id and m.archived_at is null
   where a.chore_id = p_chore_id;
  if not found then
    raise exception 'choose who it is for' using errcode = '23514', hint = 'chore_needs_assignee';
  end if;

  -- Its tags, leaving out any archived since (as save_chore offers only active ones).
  insert into public.chore_tag (household_id, chore_id, tag_id)
  select p_household_id, v_id, ct.tag_id
    from public.chore_tag ct
    join public.tag t on t.id = ct.tag_id and t.archived_at is null
   where ct.chore_id = p_chore_id;

  return v_id;
end $$;
revoke all on function public.do_chore_again(uuid, uuid, date) from public, anon;
grant execute on function public.do_chore_again(uuid, uuid, date) to authenticated;
