-- [DEV-01][DEV-02][DEV-03][NFR-04] Device pairing and device auth (WP-05, 01 §5.1, D-40).
-- A board is a Supabase Auth user of its own, created here when it redeems a pairing code, so
-- previews and production pair the same way with only the browser-safe key (no service role, D-37).
-- Its app_metadata says role=device; what it may read is decided by device.status through
-- private.device_household_id(), so revoking takes effect on its next query. Revoking also bans
-- the auth user, so the board cannot sign in again with its stored credential.

-- What the admin calls the board, carried from the code to the device it creates.
alter table public.device_pairing
  add column device_name text check (device_name is null or length(btrim(device_name)) between 1 and 60);

-- Wrong codes, counted across everyone: past 20 in 10 minutes, pairing pauses (01 §5.1). Pruned by
-- the purge_history schedule.
create table private.pairing_failure (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);
create index on private.pairing_failure (at);
revoke all on private.pairing_failure from public, anon, authenticated, service_role;

-- A code as typed: only its digits count.
create function private.pairing_code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g'), 'sha256'), 'hex')
$$;
revoke all on function private.pairing_code_hash(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Issue: an admin names the board and gets an 8-digit code, valid 10 minutes, shown once.
-- ---------------------------------------------------------------------------
create function public.create_pairing_code(p_household_id uuid, p_device_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_device_name, ''));
  v_code text;
begin
  if v_user is null or not exists (
    select from public.household_user where household_id = p_household_id and user_id = v_user) then
    raise exception 'only an admin of this household can pair a board' using errcode = '42501', hint = 'not_admin';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'give the board a name of up to 60 characters' using errcode = '22023', hint = 'bad_device_name';
  end if;
  for i in 1..5 loop
    -- 48 random bits reduced to 8 digits: the bias is under 0.0001 %.
    v_code := lpad(((('x' || encode(extensions.gen_random_bytes(6), 'hex'))::bit(48)::bigint) % 100000000)::text, 8, '0');
    begin
      insert into public.device_pairing (household_id, code_hash, expires_at, created_by, device_name)
      values (p_household_id, private.pairing_code_hash(v_code), now() + interval '10 minutes', v_user, v_name);
      return v_code;
    exception when unique_violation then
      -- The same code is already open somewhere; draw again.
    end;
  end loop;
  raise exception 'no free pairing code; try again' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------
-- Redeem: the board sends the code (signed out, browser-safe key). On success it gets the
-- credential of its new auth user, signs in with it, and keeps it to sign in again unattended.
-- Wrong codes answer { ok: false } instead of raising, so the failure is counted.
-- ---------------------------------------------------------------------------
create function public.redeem_pairing_code(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pairing  public.device_pairing;
  v_user     uuid := gen_random_uuid();
  v_device   uuid := gen_random_uuid();
  v_email    text;
  v_password text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if (select count(*) from private.pairing_failure where at > now() - interval '10 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'paused');
  end if;
  select * into v_pairing from public.device_pairing
   where code_hash = private.pairing_code_hash(p_code) and consumed_at is null and expires_at > now()
   for update;
  if not found then
    insert into private.pairing_failure default values;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  v_email := 'device-' || v_device || '@devices.familywise.invalid';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
          extensions.crypt(v_password, extensions.gen_salt('bf', 10)), now(), '', '', '', '',
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'device',
                             'household_id', v_pairing.household_id, 'device_id', v_device),
          '{}'::jsonb, now(), now());
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_user::text, v_user,
          jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());

  insert into public.device (id, household_id, name, auth_user_id, status)
  values (v_device, v_pairing.household_id, coalesce(v_pairing.device_name, 'Board'), v_user, 'active');
  update public.device_pairing set consumed_at = now(), device_id = v_device where id = v_pairing.id;

  return jsonb_build_object('ok', true, 'device_id', v_device, 'email', v_email, 'password', v_password);
end $$;

-- ---------------------------------------------------------------------------
-- Revoke: final. Reads stop at once (RLS); the ban stops new sessions and refreshes.
-- ---------------------------------------------------------------------------
create function public.revoke_device(p_device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_device public.device;
begin
  select * into v_device from public.device where id = p_device_id for update;
  if not found or auth.uid() is null or not exists (
    select from public.household_user where household_id = v_device.household_id and user_id = auth.uid()) then
    raise exception 'only an admin of this household can disconnect a board' using errcode = '42501', hint = 'not_admin';
  end if;
  if v_device.status = 'revoked' then
    return;
  end if;
  update public.device set status = 'revoked', revoked_at = now() where id = p_device_id;
  update auth.users set banned_until = 'infinity' where id = v_device.auth_user_id;
end $$;

-- A revoked board stays revoked: pair it again for a new identity.
create function private.device_revoke_is_final() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'a disconnected board cannot be reconnected; pair it again' using errcode = '23514', hint = 'device_revoked';
  end if;
  return new;
end $$;
revoke all on function private.device_revoke_is_final() from public, anon, authenticated, service_role;
create trigger trg_device_revoke_final before update of status on public.device
  for each row execute function private.device_revoke_is_final();

-- Admins rename a board and change its settings; status changes only through revoke_device.
revoke update on public.device from authenticated;
grant update (name, board_config) on public.device to authenticated;

-- ---------------------------------------------------------------------------
-- Last seen: the board reports in; at most one write a minute.
-- ---------------------------------------------------------------------------
create function public.device_heartbeat(p_app_version text default null) returns void
language sql security definer set search_path = '' as $$
  update public.device
     set last_seen_at = now(), app_version = coalesce(left(p_app_version, 40), app_version)
   where auth_user_id = (select auth.uid()) and status = 'active'
     and (last_seen_at is null or last_seen_at < now() - interval '1 minute')
$$;

revoke all on function public.create_pairing_code(uuid, text),
                       public.redeem_pairing_code(text),
                       public.revoke_device(uuid),
                       public.device_heartbeat(text) from public, anon;
grant execute on function public.create_pairing_code(uuid, text), public.revoke_device(uuid),
                          public.device_heartbeat(text) to authenticated;
grant execute on function public.redeem_pairing_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit: a board reporting in is not a change worth a row (last_seen_at and app_version are left out).
-- ---------------------------------------------------------------------------
create or replace function private.audit_row() returns trigger
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
  v_diff := v_diff - array['token_hash', 'code_hash', 'created_at', 'updated_at', 'last_seen_at', 'app_version'];
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
