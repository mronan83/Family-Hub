-- [CHR-05] The approval switches (WP-12, D-22): when the household's switch or an item's own setting
-- changes, every `scheduled` occurrence follows it, including one a parent has unchecked or a board
-- has undone. WP-09 re-resolved only those nothing had happened to, so an unchecked item kept the old
-- setting (the preview e2e found it). A check-off already waiting for a parent stays in the queue;
-- done, skipped and missed ones are unchanged.
create or replace function private.reresolve_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chore_occurrence o
     set requires_approval_snapshot = private.chore_requires_approval(o.chore_id)
   where o.household_id = new.household_id and o.status = 'scheduled'
     and o.requires_approval_snapshot is distinct from private.chore_requires_approval(o.chore_id);
  return null;
end $$;

create function private.reresolve_chore_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chore_occurrence o
     set requires_approval_snapshot = private.chore_requires_approval(o.chore_id)
   where o.chore_id = new.id and o.status = 'scheduled'
     and o.requires_approval_snapshot is distinct from private.chore_requires_approval(o.chore_id);
  return null;
end $$;
create trigger trg_chore_approval after update of approval on public.chore
  for each row when (old.approval is distinct from new.approval)
  execute function private.reresolve_chore_approval();

revoke all on function private.reresolve_approval(), private.reresolve_chore_approval()
  from public, anon, authenticated;
