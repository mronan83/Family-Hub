-- [ACC-01][NFR-04][NFR-09] WP-02: tenancy, access and device tables with RLS (02 §3.1, §4.5).
-- Every table carries household_id (the household table's own id is the tenant key) and has RLS on.
-- Writes that need cross-row checks (onboarding, invites, pairing) arrive as definer functions in
-- WP-03 and WP-05; until then those paths have no end-user write policy.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Rejects an unknown IANA timezone by asking Postgres to use it.
create function private.check_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when invalid_parameter_value then
  raise exception 'unknown timezone: %', new.timezone using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.household (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  timezone    text not null,
  week_start  smallint not null default 0 check (week_start between 0 and 6),
  locale      text not null default 'en-US',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_household_timezone before insert or update of timezone on public.household
  for each row execute function private.check_timezone();
create trigger trg_household_updated before update on public.household
  for each row execute function private.set_updated_at();

create table public.household_user (
  household_id uuid not null references public.household (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'admin')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on public.household_user (user_id);

create table public.member (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  display_name  text not null check (length(btrim(display_name)) between 1 and 40),
  role          text not null check (role in ('child', 'adult')),
  avatar_key    text check (avatar_key in ('owl', 'bear', 'fox', 'cat', 'bunny', 'dog', 'frog', 'panda')),
  color         text not null default 'member-1'
                  check (color in ('member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6')),
  birth_year    smallint check (birth_year between 1900 and 2100),
  user_id       uuid references auth.users (id) on delete set null,
  earns_rewards boolean not null,        -- D-32: set from the role on insert unless given
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint member_child_has_no_login check (role = 'adult' or user_id is null)
);
create index on public.member (household_id) where archived_at is null;
create unique index on public.member (household_id, user_id) where user_id is not null;
create trigger trg_member_updated before update on public.member
  for each row execute function private.set_updated_at();

-- [PTS-07] Rewards follow the person: on for a child, off for an adult, unless set explicitly.
create function private.member_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.earns_rewards := coalesce(new.earns_rewards, new.role = 'child');
  return new;
end $$;
create trigger trg_member_defaults before insert on public.member
  for each row execute function private.member_defaults();

create table public.invite (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  email         text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  token_hash    text not null unique,
  role          text not null default 'admin' check (role = 'admin'),
  invited_by    uuid references auth.users (id) on delete set null,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references auth.users (id) on delete set null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (expires_at > created_at)
);
create index on public.invite (household_id);

create table public.device (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 60),
  auth_user_id  uuid not null unique references auth.users (id) on delete restrict,
  status        text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at  timestamptz,
  app_version   text,
  board_config  jsonb not null default '{}'::jsonb,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((status = 'revoked') = (revoked_at is not null))
);
create index on public.device (household_id);
create trigger trg_device_updated before update on public.device
  for each row execute function private.set_updated_at();

create table public.device_pairing (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  code_hash     text not null unique,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  device_id     uuid references public.device (id) on delete set null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index on public.device_pairing (household_id);

create table public.household_settings (
  household_id        uuid primary key references public.household (id) on delete cascade,
  approval_mode       text not null default 'off' check (approval_mode in ('off', 'on')),
  undo_window_seconds integer not null default 120 check (undo_window_seconds between 0 and 3600),
  quiet_hours         jsonb not null default '{}'::jsonb,
  celebration         jsonb not null default '{}'::jsonb,
  streak_defaults     jsonb not null default '{"grace_per_week": 1}'::jsonb,
  board_layout        jsonb not null default '{}'::jsonb,
  points_settings     jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_household_settings_updated before update on public.household_settings
  for each row execute function private.set_updated_at();

create table public.job_run (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.household (id) on delete cascade,
  job_type      text not null,
  target_id     uuid,
  status        text not null default 'running' check (status in ('running', 'ok', 'error', 'skipped')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  stats         jsonb not null default '{}'::jsonb,
  error         text,
  created_at    timestamptz not null default now()
);
create index on public.job_run (household_id, job_type, started_at desc);

-- ---------------------------------------------------------------------------
-- RLS helpers (02 §4.5). Definer functions so policies can read membership without recursion.
-- ---------------------------------------------------------------------------

create function private.admin_household_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_user where user_id = (select auth.uid())
$$;

-- The caller's household while its device row is active; revocation takes effect on the next query.
create function private.device_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.device
  where auth_user_id = (select auth.uid()) and status = 'active'
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.admin_household_ids(), private.device_household_id()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.household          enable row level security;
alter table public.household_user     enable row level security;
alter table public.member             enable row level security;
alter table public.invite             enable row level security;
alter table public.device             enable row level security;
alter table public.device_pairing     enable row level security;
alter table public.household_settings enable row level security;
alter table public.job_run            enable row level security;

-- household: admins read and rename; the board reads timezone and week start. Created by onboarding (WP-03).
create policy household_admin_select on public.household for select to authenticated
  using (id in (select private.admin_household_ids()));
create policy household_admin_update on public.household for update to authenticated
  using (id in (select private.admin_household_ids()))
  with check (id in (select private.admin_household_ids()));
create policy household_device_select on public.household for select to authenticated
  using (id = (select private.device_household_id()));

-- household_user: admins see who administers their household. Changed only by invite acceptance (WP-03).
create policy household_user_admin_select on public.household_user for select to authenticated
  using (household_id in (select private.admin_household_ids()));

-- member: admins manage; the board reads.
create policy member_admin_all on public.member for all to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy member_device_select on public.member for select to authenticated
  using (household_id = (select private.device_household_id()));

-- invite: admins only.
create policy invite_admin_all on public.invite for all to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));

-- device: admins list, rename and revoke; a device reads only its own row. Created by pairing (WP-05).
create policy device_admin_select on public.device for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy device_admin_update on public.device for update to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy device_self_select on public.device for select to authenticated
  using (auth_user_id = (select auth.uid()) and status = 'active');

-- device_pairing: admins issue and list codes; redemption runs server-side (WP-05).
create policy device_pairing_admin_select on public.device_pairing for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy device_pairing_admin_insert on public.device_pairing for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));

-- household_settings: admins read and change; the board reads.
create policy household_settings_admin_select on public.household_settings for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy household_settings_admin_update on public.household_settings for update to authenticated
  using (household_id in (select private.admin_household_ids()))
  with check (household_id in (select private.admin_household_ids()));
create policy household_settings_device_select on public.household_settings for select to authenticated
  using (household_id = (select private.device_household_id()));

-- job_run: read-only for admins and the board (health page, stale indicators); jobs write as service role.
create policy job_run_admin_select on public.job_run for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy job_run_device_select on public.job_run for select to authenticated
  using (household_id = (select private.device_household_id()));

-- ---------------------------------------------------------------------------
-- Realtime: board-readable tables notify the board, which then refetches (01 §7)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime
  add table public.household, public.member, public.household_settings, public.device;
