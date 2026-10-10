-- [CHR-14][CHR-15][ACC-04] A parent links their own sign-in to themselves in the family in one step:
-- from Reminders or My tasks ("Which one is you?") or from an adult's page on Members. Until now the
-- only way was the member form's "Their sign-in", which an adult's record shows and a child's hides,
-- so a parent whose own record said Child found nowhere to do it.
--   * Only an adult of the caller's household, not archived, and not linked to someone else's sign-in.
--   * A sign-in belongs to one member (the unique index on member (household_id, user_id)), so it
--     moves from wherever it was: an archived record, or a duplicate of the same person.
--   * Linking the member already linked changes nothing.

create function public.link_my_member(p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  m      public.member;
  v_from uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501', hint = 'not_signed_in';
  end if;
  select * into m from public.member where id = p_member for update;
  if not found or m.household_id not in (select private.admin_household_ids()) then
    raise exception 'member not found' using errcode = 'P0002', hint = 'member_not_found';
  end if;
  if m.archived_at is not null then
    raise exception 'that member is archived' using errcode = '23514', hint = 'member_archived';
  end if;
  if m.role <> 'adult' then
    raise exception 'only an adult can have a sign-in' using errcode = '23514', hint = 'not_adult';
  end if;
  if m.user_id = v_uid then
    return jsonb_build_object('member_id', m.id, 'moved_from', null, 'duplicate', true);
  end if;
  if m.user_id is not null then
    raise exception 'that member has someone else''s sign-in' using errcode = '23514',
      hint = 'linked_to_someone_else';
  end if;
  update public.member set user_id = null
   where household_id = m.household_id and user_id = v_uid and id <> m.id
  returning id into v_from;
  update public.member set user_id = v_uid where id = m.id;
  return jsonb_build_object('member_id', m.id, 'moved_from', v_from, 'duplicate', false);
end $$;

revoke all on function public.link_my_member(uuid) from public, anon;
grant execute on function public.link_my_member(uuid) to authenticated;
