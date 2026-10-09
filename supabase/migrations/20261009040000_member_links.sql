-- [ACC-04][NFR-04] Members (WP-04): an adult member may be linked to a sign-in, and only to an admin
-- of the same household. Later work decides "who am I" from this link (My tasks, private items,
-- D-34), so a link to anyone else would leak across households. When an admin leaves a household,
-- the member they were linked to stays and is unlinked.

create function private.check_member_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (
    select from public.household_user where household_id = new.household_id and user_id = new.user_id) then
    raise exception 'that sign-in is not an admin of this household'
      using errcode = '23514', hint = 'member_user_not_admin';
  end if;
  return new;
end $$;
revoke all on function private.check_member_user() from public, anon, authenticated, service_role;

create trigger trg_member_user before insert or update of user_id, household_id on public.member
  for each row execute function private.check_member_user();

create function private.unlink_departed_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.member set user_id = null
   where household_id = old.household_id and user_id = old.user_id;
  return null;
end $$;
revoke all on function private.unlink_departed_admin() from public, anon, authenticated, service_role;

create trigger trg_household_user_unlink after delete on public.household_user
  for each row execute function private.unlink_departed_admin();
