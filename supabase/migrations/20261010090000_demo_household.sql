-- [NFR-07][NFR-14] Production's jobs leave the demo family alone (D-62). Previews and e2e use the
-- production database as the demo family (D-37), so until now production's jobs worked on it too:
-- the goal reconcile every 5 minutes, day close, reminders. A job could land in the middle of an
-- e2e step (a check-off made and taken back seconds later) and leave its mark: a goal reached once,
-- a day closed, a reminder sent to a made-up device. The demo family is test data; its tests run
-- what the jobs do themselves, so the jobs skip it.
--   * household.is_demo marks it. The seed sets it (the seed deletes and recreates the demo
--     household); this migration sets it on the one already there, so jobs stop at the deploy.
--   * Only the server (the service role), the seed or a migration changes it: a parent can't turn
--     their own household's jobs off, or the demo family's back on.

alter table public.household add column is_demo boolean not null default false;

update public.household set is_demo = true where id = '0de00000-0000-4000-8000-000000000001';

create function private.guard_household_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_demo is distinct from old.is_demo
     and coalesce((select auth.role()), '') in ('authenticated', 'anon') then
    raise exception 'only the server marks the demo family' using errcode = '42501', hint = 'not_allowed';
  end if;
  return new;
end $$;
revoke all on function private.guard_household_demo() from public, anon, authenticated, service_role;

create trigger trg_household_demo before update of is_demo on public.household
  for each row execute function private.guard_household_demo();
