-- [NFR-08] Free-plan keepalive target (01 §9.10). The keepalive workflow writes here a few times a day
-- so Supabase sees real database activity and never pauses the project. Lives in the private schema,
-- so it is not exposed through the API and is outside the public-table lint.

create table private.heartbeat (
  source  text primary key,
  beat_at timestamptz not null default now(),
  beats   bigint not null default 1
);
revoke all on private.heartbeat from public, anon, authenticated;
grant select, insert, update on private.heartbeat to service_role;
