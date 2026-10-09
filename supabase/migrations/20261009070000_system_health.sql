-- [NFR-07][NFR-08] System Health (WP-42, D-42). Admins see their own household's job health and
-- server errors, and the deployment's usage against the Free-plan limits. Everything is read through
-- functions that check the caller is an admin, so previews (which never hold the secret key, D-37)
-- show the same page as production, and no household sees another's errors.

-- ---------------------------------------------------------------------------
-- Errors belong to the household they happened for (the signed-in admin's or board's, or the job's).
-- Errors with no household (signed-out pages) stay in the table for the operator, on no one's page.
-- ---------------------------------------------------------------------------
alter table private.app_error
  add column household_id uuid references public.household (id) on delete cascade;
create index on private.app_error (household_id, occurred_at desc);

-- The 6-argument recorder stays for code deployed before this one; the 7-argument one has no
-- default, so a call by argument names always picks exactly one of them.
create function public.record_app_error(
  p_request_id text, p_method text, p_route text, p_kind text, p_message text, p_digest text,
  p_household_id uuid
) returns void
language sql set search_path = '' as $$
  insert into private.app_error (request_id, method, route, kind, message, digest, household_id)
  values (left(p_request_id, 100), left(p_method, 10), left(p_route, 200), left(coalesce(p_kind, 'unknown'), 20),
          left(coalesce(p_message, ''), 1000), left(p_digest, 100), p_household_id)
$$;
revoke all on function public.record_app_error(text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_app_error(text, text, text, text, text, text, uuid) to service_role;

-- A household's recent server errors, newest first, for its admins only.
create function public.household_errors(p_household_id uuid, p_limit integer default 20)
returns table (occurred_at timestamptz, route text, kind text, message text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household_id is null or p_household_id not in (select private.admin_household_ids()) then
    raise exception 'only an admin of this household can see its errors' using errcode = '42501', hint = 'not_admin';
  end if;
  return query
    select e.occurred_at, e.route, e.kind, e.message
      from private.app_error e
     where e.household_id = p_household_id and e.occurred_at > now() - interval '30 days'
     order by e.occurred_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;
revoke all on function public.household_errors(uuid, integer) from public, anon;
grant execute on function public.household_errors(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Usage against the Free-plan limits (US-909). Vercel's month-to-date usage is read once a day by the
-- usage workflow (it holds the deploy token; the app does not) and kept here; the database's own
-- size is read live. The Hobby limits apply to the whole Vercel account, so both the account's total
-- and FamilyWise's share are kept.
-- ---------------------------------------------------------------------------
create table private.usage_sample (
  id               bigint generated always as identity primary key,
  taken_at         timestamptz not null default now(),
  source           text not null check (source in ('vercel')),
  period_start     date not null,
  service          text not null check (length(service) between 1 and 100),
  unit             text not null check (length(unit) between 1 and 40),
  account_quantity numeric not null check (account_quantity >= 0),
  project_quantity numeric not null check (project_quantity >= 0)
);
create index on private.usage_sample (taken_at desc);
revoke all on private.usage_sample from public, anon, authenticated, service_role;

-- What System Health shows: the database's size and the latest Vercel reading, for any admin (usage
-- is the deployment's, not a household's). Boards and signed-out callers get nothing.
create function public.system_usage()
returns table (source text, service text, unit text, used numeric, project_used numeric, taken_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.admin_household_ids()) then
    raise exception 'only an admin can see usage' using errcode = '42501', hint = 'not_admin';
  end if;
  return query
    select 'supabase'::text, 'Database size'::text, 'bytes'::text,
           pg_database_size(current_database())::numeric, null::numeric, now()
    union all
    (select s.source, s.service, s.unit, s.account_quantity, s.project_quantity, s.taken_at
       from private.usage_sample s
      where s.taken_at = (select max(u.taken_at) from private.usage_sample u where u.source = 'vercel')
      order by s.service);
end $$;
revoke all on function public.system_usage() from public, anon;
grant execute on function public.system_usage() to authenticated;
