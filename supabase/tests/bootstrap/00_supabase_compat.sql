-- Supabase compatibility bootstrap for database tests on native Postgres (01 §9.4, D-26).
-- Recreates only the platform objects hosted Supabase provides, so migrations and RLS behave
-- the same as in production. Never deployed; migrations must not depend on anything else here.

set client_min_messages = warning;

-- Roles (cluster-wide, so create them only once)
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

-- Schemas
create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- auth: the subset of GoTrue's schema that migrations and policies reference
create table if not exists auth.users (
  instance_id            uuid,
  id                     uuid primary key default gen_random_uuid(),
  aud                    text,
  role                   text,
  email                  text unique,
  encrypted_password     text,
  email_confirmed_at     timestamptz,
  confirmation_token     text,
  recovery_token         text,
  email_change_token_new text,
  email_change           text,
  raw_app_meta_data      jsonb not null default '{}'::jsonb,
  raw_user_meta_data     jsonb not null default '{}'::jsonb,
  banned_until           timestamptz,
  is_anonymous           boolean not null default false,
  last_sign_in_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  provider_id     text not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (provider_id, provider)
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.sub', true),
             current_setting('request.jwt.claims', true)::jsonb ->> 'sub'),
    '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.role', true),
             current_setting('request.jwt.claims', true)::jsonb ->> 'role'),
    '')::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- public: Supabase grants table access broadly and relies on RLS, so tests must do the same
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Realtime publication (tables are added to it by migrations). Local clusters may not run with
-- wal_level = logical; that only matters for replication, so silence the warning.
set client_min_messages = error;
do $$
begin
  if not exists (select from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- storage: the subset of Supabase Storage's schema that migrations and policies reference (WP-18).
-- Files themselves live outside the database; tests check the rows and the policies.
set client_min_messages = warning;
create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
-- As Supabase defines it: the folders of a path, without its file name.
create or replace function storage.foldername(name text) returns text[]
language plpgsql as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- realtime: the subset of Realtime's schema that Broadcast from Database uses (WP-126): the
-- messages table that realtime.send() writes to and Realtime authorizes against with RLS, the
-- channel topic a policy reads, and send() as Realtime defines it (it catches its own errors).
create schema if not exists realtime;
create table if not exists realtime.messages (
  id          uuid not null default gen_random_uuid(),
  topic       text not null,
  extension   text not null,
  payload     jsonb,
  event       text,
  private     boolean default false,
  updated_at  timestamp not null default now(),
  inserted_at timestamp not null default now(),
  primary key (id, inserted_at)
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text
language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language plpgsql as $$
declare
  generated_id uuid;
  final_payload jsonb;
begin
  begin
    generated_id := gen_random_uuid();
    if jsonb_typeof(payload) <> 'object' or payload ? 'id' then
      final_payload := payload;
    else
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    end if;
    execute format('set local realtime.topic to %L', topic);
    insert into realtime.messages (id, payload, event, topic, private, extension)
    values (generated_id, final_payload, event, topic, private, 'broadcast');
  exception when others then
    raise warning 'WarnSendingBroadcastMessage: %', sqlerrm;
  end;
end $$;
grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to anon, authenticated, service_role;
grant execute on function realtime.topic() to anon, authenticated, service_role;
