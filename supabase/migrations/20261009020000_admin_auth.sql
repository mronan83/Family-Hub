-- [ACC-01][ACC-02][ACC-03][ACC-05] Admin sign-in and onboarding (WP-03, 01 §5.10, D-39).
-- FamilyWise is private: there is no public sign-up. The first household is created with a one-time
-- setup code (setup-code workflow, at launch); every other admin joins through an invite link.
-- Invite tokens and setup codes are stored only as SHA-256 hashes. Every change to a household's
-- tables is written to audit_log by a trigger, so no screen added later can forget to audit.

-- ---------------------------------------------------------------------------
-- Audit log (ACC-05): written only by private.audit_row(); admins read their household's rows.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id           bigint generated always as identity primary key,
  household_id uuid not null references public.household (id) on delete cascade,
  actor_type   text not null check (actor_type in ('admin', 'device', 'system')),
  actor_id     uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  entity_type  text not null,
  entity_id    uuid,
  chore_id     uuid,
  diff         jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);
create index on public.audit_log (household_id, at desc);
alter table public.audit_log enable row level security;
create policy audit_log_admin_select on public.audit_log for select to authenticated
  using (household_id in (select private.admin_household_ids()));
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- Who: the signed-in admin, a paired board (app_metadata.role = device, WP-05), or the system
-- (jobs, migrations, the seed). What: inserts and deletes keep the row, updates keep only the
-- columns that changed. Hashes and timestamps are left out.
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row       jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old       jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_household uuid := coalesce(
    (v_row ->> 'household_id')::uuid,
    case when tg_table_name = 'household' then (v_row ->> 'id')::uuid end);
  v_actor     uuid := auth.uid();
  v_diff      jsonb;
begin
  -- A household being deleted takes its audit trail with it; nothing to record.
  if v_household is null or not exists (select from public.household where id = v_household) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_row)
     where v_old -> key is distinct from value and key <> 'updated_at';
  else
    v_diff := v_row;
  end if;
  v_diff := v_diff - array['token_hash', 'code_hash', 'created_at', 'updated_at'];
  if tg_op = 'UPDATE' and v_diff = '{}'::jsonb then
    return null;
  end if;
  insert into public.audit_log (household_id, actor_type, actor_id, action, entity_type, entity_id, diff)
  values (
    v_household,
    case when v_actor is null then 'system'
         when auth.jwt() -> 'app_metadata' ->> 'role' = 'device' then 'device'
         else 'admin' end,
    v_actor,
    lower(tg_op),
    tg_table_name,
    case when tg_table_name = 'household_user' then (v_row ->> 'user_id')::uuid else (v_row ->> 'id')::uuid end,
    v_diff);
  return null;
end $$;
revoke all on function private.audit_row() from public, anon, authenticated, service_role;

create trigger trg_audit after insert or update or delete on public.household
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.household_settings
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.household_user
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.member
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.invite
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.device
  for each row execute function private.audit_row();
create trigger trg_audit after insert or update or delete on public.device_pairing
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Setup codes (the first household). Issued by the setup-code workflow; one use; 24 hours.
-- ---------------------------------------------------------------------------

create table private.household_setup_code (
  code_hash    text primary key,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references auth.users (id) on delete set null,
  household_id uuid references public.household (id) on delete set null
);
revoke all on private.household_setup_code from public, anon, authenticated, service_role;

-- A code as typed: case and separators do not matter.
create function private.code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;
create function private.token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;
revoke all on function private.code_hash(text), private.token_hash(text) from public, anon, authenticated, service_role;

-- Whether a code would work, for the server deciding whether to create an account (production;
-- service_role only, so nobody can test codes through the API).
create function public.setup_code_usable(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select from private.household_setup_code
     where code_hash = private.code_hash(p_code) and used_at is null and expires_at > now())
$$;

-- Errors carry a stable code in HINT for the app to map to a message.
create function public.create_household(p_code text, p_name text, p_timezone text, p_week_start smallint default 0)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user      uuid := auth.uid();
  v_household uuid;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '28000', hint = 'not_signed_in';
  end if;
  if exists (select from public.household_user where user_id = v_user) then
    raise exception 'you already run a household' using errcode = 'P0001', hint = 'household_exists';
  end if;
  update private.household_setup_code
     set used_at = now(), used_by = v_user
   where code_hash = private.code_hash(p_code) and used_at is null and expires_at > now();
  if not found then
    raise exception 'that setup code is not valid' using errcode = 'P0001', hint = 'setup_code_invalid';
  end if;
  insert into public.household (name, timezone, week_start)
  values (btrim(p_name), p_timezone, coalesce(p_week_start, 0))
  returning id into v_household;
  insert into public.household_settings (household_id) values (v_household);
  insert into public.household_user (household_id, user_id, role) values (v_household, v_user, 'owner');
  update private.household_setup_code set household_id = v_household where code_hash = private.code_hash(p_code);
  return v_household;
end $$;

-- ---------------------------------------------------------------------------
-- Invites (ACC-03): a link the inviter copies or shares; one use; 7 days; accepted only by an
-- account with the invited email. A new invite for the same email replaces the open one.
-- ---------------------------------------------------------------------------

create function public.create_invite(p_household_id uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user  uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
begin
  if v_user is null or not exists (
    select from public.household_user where household_id = p_household_id and user_id = v_user) then
    raise exception 'only an admin of this household can invite' using errcode = '42501', hint = 'not_admin';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'enter a valid email address' using errcode = '22023', hint = 'bad_email';
  end if;
  if exists (
    select from public.household_user hu join auth.users u on u.id = hu.user_id
     where hu.household_id = p_household_id and lower(u.email) = v_email) then
    raise exception 'they are already an admin' using errcode = 'P0001', hint = 'admin_exists';
  end if;
  update public.invite set revoked_at = now()
   where household_id = p_household_id and email = v_email and accepted_at is null and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.invite (household_id, email, token_hash, invited_by, expires_at)
  values (p_household_id, v_email, private.token_hash(v_token), v_user, now() + interval '7 days');
  return v_token;
end $$;

-- The admins of a household, with their sign-in emails, for its admins only.
create function public.household_admins(p_household_id uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select hu.user_id, u.email::text, hu.role, hu.created_at
    from public.household_user hu
    join auth.users u on u.id = hu.user_id
   where hu.household_id = p_household_id
     and p_household_id in (select private.admin_household_ids())
   order by hu.created_at, u.email
$$;

-- What an invite link shows before anyone signs in. No rows for a token that matches nothing.
create function public.invite_preview(p_token text)
returns table (household_name text, email text, state text)
language sql stable security definer set search_path = '' as $$
  select h.name, i.email,
         case when i.accepted_at is not null then 'used'
              when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired'
              else 'valid' end
    from public.invite i
    join public.household h on h.id = i.household_id
   where i.token_hash = private.token_hash(p_token)
$$;

create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  v_invite public.invite;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '28000', hint = 'not_signed_in';
  end if;
  select * into v_invite from public.invite where token_hash = private.token_hash(p_token) for update;
  if not found then
    raise exception 'that invite link is not valid' using errcode = 'P0001', hint = 'invite_unknown';
  elsif v_invite.accepted_at is not null then
    raise exception 'that invite was already used' using errcode = 'P0001', hint = 'invite_used';
  elsif v_invite.revoked_at is not null then
    raise exception 'that invite was replaced or cancelled' using errcode = 'P0001', hint = 'invite_revoked';
  elsif v_invite.expires_at <= now() then
    raise exception 'that invite has expired' using errcode = 'P0001', hint = 'invite_expired';
  end if;
  -- The invite names who may use it; a different signed-in account is turned away.
  if not exists (select from auth.users where id = v_user and lower(email) = v_invite.email) then
    raise exception 'that invite is for another email address' using errcode = 'P0001', hint = 'invite_other_email';
  end if;
  if exists (select from public.household_user where user_id = v_user and household_id <> v_invite.household_id) then
    raise exception 'you already run another household' using errcode = 'P0001', hint = 'other_household';
  end if;
  insert into public.household_user (household_id, user_id, role)
  values (v_invite.household_id, v_user, 'admin')
  on conflict do nothing;
  update public.invite set accepted_at = now(), accepted_by = v_user where id = v_invite.id;
  return v_invite.household_id;
end $$;

revoke all on function public.create_household(text, text, text, smallint),
                       public.create_invite(uuid, text),
                       public.household_admins(uuid),
                       public.invite_preview(text),
                       public.accept_invite(text) from public, anon;
grant execute on function public.create_household(text, text, text, smallint),
                          public.create_invite(uuid, text),
                          public.household_admins(uuid),
                          public.accept_invite(text) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;
revoke all on function public.setup_code_usable(text) from public, anon, authenticated;
grant execute on function public.setup_code_usable(text) to service_role;
