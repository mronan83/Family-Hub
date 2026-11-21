-- [PTS-10] Penalty rules: Stop now, Remove while a rule has added nothing (WP-121, D-157, added at the
-- owner's request on 21 November before approval). Take back on a rule's miss uses WP-120's
-- take_back_penalty() as it is.
--   * `penalty_rule.stopped_at`, `stopped_by`: a parent's Stop now. A stopped rule adds nothing more,
--     not even for days that closed before it was stopped and are not worked out yet, and Uncheck
--     after a Mark done on time adds nothing back. What it added stays owed until it is paid or taken
--     back. A stopped rule can't be changed or started again.
--   * `stop_penalty_rule(rule)`, `remove_penalty_rule(rule)`: for a parent of the household. Remove
--     only while the rule has added nothing (no penalty has ever had its rule_id).

alter table public.penalty_rule
  add column stopped_at timestamptz,
  add column stopped_by uuid,
  add constraint penalty_rule_stopped check (stopped_by is null or stopped_at is not null);

-- A stopped rule is not changed again: save_penalty_rule() is refused with `rule_stopped`.
create function private.prevent_stopped_rule_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.stopped_at is not null then
    raise exception 'this rule was stopped' using errcode = '22023', hint = 'rule_stopped';
  end if;
  return new;
end $$;
create trigger trg_penalty_rule_stopped before update on public.penalty_rule
  for each row execute function private.prevent_stopped_rule_change();

-- [PTS-10] As before (20261121114749), leaving out stopped rules.
create or replace function private.accrue_penalty_rules(p_household uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household);
  v_on    boolean := coalesce((select s.penalties_on from public.household_settings s
                                where s.household_id = p_household), false);
  r       public.penalty_rule;
  m       record;
  v_to    date;
  v_added integer := 0;
begin
  for r in select * from public.penalty_rule
            where household_id = p_household
              and stopped_at is null
              and start_date < v_today
              and (accrued_through is null or accrued_through < least(end_date, v_today - 1))
            order by created_at, id
              for update skip locked loop
    v_to := least(r.end_date, v_today - 1);
    if v_on then
      for m in select * from private.rule_misses(r, coalesce(r.accrued_through + 1, r.start_date), v_to)
                order by due_date, due_time nulls last, occurrence_id, member_id loop
        if private.add_rule_miss(r, m.member_id, m.occurrence_id, m.due_date) > 0 then
          v_added := v_added + 1;
        end if;
      end loop;
    end if;
    update public.penalty_rule set accrued_through = v_to where id = r.id;
  end loop;
  return v_added;
end $$;

-- [PTS-10][CHR-24][D-157] As before (20261121114749): Mark done on time takes a miss back; Uncheck
-- adds back what Mark done on time took, unless the rule was stopped since.
create or replace function private.penalty_rules_on_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_occ   public.chore_occurrence;
  v_event public.chore_completion_event;
  p       public.penalty;
  r       public.penalty_rule;
  v_back  record;
  v_mem   uuid;
begin
  select * into v_occ from public.chore_occurrence where id = new.occurrence_id;
  if not found or v_occ.kind <> 'chore' then
    return null;
  end if;
  select * into v_event from public.chore_completion_event where id = v_occ.status_event_id;
  if v_occ.status = 'approved' and coalesce(v_event.marked_on_time, false) then
    for p in select * from public.penalty
              where occurrence_id = v_occ.id and rule_id is not null and taken_back_at is null
                for update loop
      update public.penalty
         set taken_back_at = now(), taken_back_by = v_event.actor_id, taken_back_on_time = true
       where id = p.id;
      if p.unit = 'points' then
        insert into public.points_ledger (household_id, member_id, entry_type, amount, reason, dedupe_key,
                                          created_by_type, created_by, penalty_id)
        values (p.household_id, p.member_id, 'penalty', p.amount,
                coalesce((select l.reason from public.points_ledger l where l.penalty_id = p.id and l.amount < 0
                           order by l.created_at limit 1), p.reason) || ', marked on time',
                'pen-back:' || p.id, case when v_event.actor_id is null then 'system' else 'admin' end,
                v_event.actor_id, p.id)
        on conflict (dedupe_key) do nothing;
      end if;
    end loop;
  elsif v_occ.status = 'missed' and coalesce((select s.penalties_on from public.household_settings s
                                               where s.household_id = v_occ.household_id), false) then
    for v_back in
      select distinct q.rule_id, q.member_id
        from public.penalty q
       where q.occurrence_id = v_occ.id and q.taken_back_on_time
         and not exists (select from public.penalty l where l.rule_id = q.rule_id and l.occurrence_id = v_occ.id
                           and l.member_id = q.member_id and l.taken_back_at is null)
    loop
      select * into r from public.penalty_rule
       where id = v_back.rule_id and accrued_through >= v_occ.due_date and stopped_at is null;
      v_mem := v_back.member_id;
      if r.id is not null and exists (select from private.rule_misses(r, v_occ.due_date, v_occ.due_date) y
                                       where y.occurrence_id = v_occ.id and y.member_id = v_mem) then
        perform private.add_rule_miss(r, v_mem, v_occ.id, v_occ.due_date);
      end if;
    end loop;
  end if;
  return null;
end $$;

-- [PTS-10][US-1112] Stop now: the rule adds nothing more. Stopping again changes nothing.
create function public.stop_penalty_rule(p_rule_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.penalty_rule;
begin
  select * into v_rule from public.penalty_rule where id = p_rule_id;
  perform private.penalty_admin(v_rule.household_id);
  if v_rule.stopped_at is null then
    update public.penalty_rule set stopped_at = now(), stopped_by = auth.uid() where id = v_rule.id
    returning * into v_rule;
  end if;
  return jsonb_build_object('id', v_rule.id, 'stopped_at', v_rule.stopped_at);
end $$;

-- [PTS-10][US-1112] Remove a rule, only while it has added nothing (a miss taken back still counts).
create function public.remove_penalty_rule(p_rule_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
begin
  select household_id into v_household from public.penalty_rule where id = p_rule_id;
  perform private.penalty_admin(v_household);
  if exists (select from public.penalty where rule_id = p_rule_id) then
    raise exception 'this rule has added misses; stop it instead' using errcode = '22023', hint = 'rule_used';
  end if;
  delete from public.penalty_rule where id = p_rule_id;
end $$;

revoke all on function private.prevent_stopped_rule_change() from public, anon, authenticated;
revoke all on function public.stop_penalty_rule(uuid), public.remove_penalty_rule(uuid) from public, anon;
grant execute on function public.stop_penalty_rule(uuid), public.remove_penalty_rule(uuid) to authenticated;
