-- Supabase compatibility bootstrap for database tests on native Postgres (01 §9.4, D-26).
-- Recreates only the platform objects hosted Supabase provides, so migrations and RLS behave
-- the same as in production. Never deployed; migrations must not depend on anything else here.

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
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until       timestamptz,
  is_anonymous       boolean not null default false,
  created_at         timestamptz not null default now()
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
