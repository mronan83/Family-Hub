-- [RWD-14] A goal's end date that can be cleared (WP-79, D-115): save_goal takes a started goal's end
-- date off, adds one, or moves it, to today or later; a date before today is refused; a goal not yet
-- started keeps "not before it starts" only; a reached goal keeps its rules, dates and payout, and can
-- still be renamed.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('45100000-0000-0000-0000-000000000001', 'parent@example.com');
insert into public.household (id, name, timezone, week_start) values
  ('45000000-0000-0000-0000-000000000001', 'End family', 'America/Chicago', 1);
insert into public.household_settings (household_id) values ('45000000-0000-0000-0000-000000000001');
insert into public.household_user (household_id, user_id, role) values
  ('45000000-0000-0000-0000-000000000001', '45100000-0000-0000-0000-000000000001', 'owner');
insert into public.member (id, household_id, display_name, role) values
  ('45110000-0000-0000-0000-00000000000a', '45000000-0000-0000-0000-000000000001', 'Maya', 'child');

create function pg_temp.today() returns date language sql as $$
  select private.household_today('45000000-0000-0000-0000-000000000001')
$$;
create function pg_temp.parent() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     '{"sub": "45100000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;
-- Goal n for Maya as the form sends it: one rule, from p_start to p_end days from today (null: none).
create function pg_temp.goal(p_n int, p_start int, p_end int, p_title text default 'Read 20 books',
                             p_target int default 20) returns jsonb language sql as $$
  select jsonb_build_object('id', '45e00000-0000-0000-0000-00000000000' || p_n,
                            'household_id', '45000000-0000-0000-0000-000000000001',
                            'member_id', '45110000-0000-0000-0000-00000000000a',
                            'title', p_title, 'icon', 'trophy',
                            'start_date', pg_temp.today() + p_start,
                            'end_date', case when p_end is null then null else pg_temp.today() + p_end end,
                            'rule_logic', 'all', 'rules', jsonb_build_array(jsonb_build_object('type', 'COUNT', 'target', p_target)))
$$;
create function pg_temp.end_of(p_n int) returns int language sql as $$
  select end_date - pg_temp.today() from public.reward_goal where id = ('45e00000-0000-0000-0000-00000000000' || p_n)::uuid
$$;
create function pg_temp.status(p_n int, p_status text) returns void language sql as $$
  update public.reward_goal set status = p_status where id = ('45e00000-0000-0000-0000-00000000000' || p_n)::uuid
$$;

-- G1 started 12 days ago, ends in 16; G2 started, no end date; G3 starts in 3 days; G4 reached.
select pg_temp.parent();
select public.save_goal(pg_temp.goal(1, -12, 16));
select public.save_goal(pg_temp.goal(2, -12, null));
select public.save_goal(pg_temp.goal(3, 3, 10));
select public.save_goal(pg_temp.goal(4, -12, 16));
select pg_temp.as_owner();
select pg_temp.status(1, 'active');
select pg_temp.status(2, 'active');
select pg_temp.status(3, 'scheduled');
select pg_temp.status(4, 'achieved');
select pg_temp.parent();

select lives_ok($$ select public.save_goal(pg_temp.goal(1, -12, null)) $$,
                '[RWD-14] a started goal''s end date is taken off');
select is(pg_temp.end_of(1), null, '... and it has no end date');
select lives_ok($$ select public.save_goal(pg_temp.goal(2, -12, 20)) $$,
                '[RWD-14] a started goal with no end date is given one');
select is(pg_temp.end_of(2), 20, '... the day chosen');
select throws_ok($$ select public.save_goal(pg_temp.goal(2, -12, -1)) $$, '22023',
                 'a started goal ends today or later', '[RWD-14] a started goal can''t end before today');
select lives_ok($$ select public.save_goal(pg_temp.goal(2, -12, 0)) $$, '... and can end today');
select is(pg_temp.end_of(2), 0, '... which is kept');
select lives_ok($$ select public.save_goal(pg_temp.goal(3, 3, null)) $$,
                'a goal not yet started has its end date taken off');

-- [RWD-14] A reached goal keeps its rules, dates and payout (D-115), and can still be renamed.
select throws_ok($$ select public.save_goal(pg_temp.goal(4, -12, null)) $$, '22023',
                 'a reached goal keeps its rules', '[RWD-14] a reached goal keeps its end date');
select throws_ok($$ select public.save_goal(pg_temp.goal(4, -12, 16, 'Read 20 books', 30)) $$, '22023',
                 'a reached goal keeps its rules', '... and its rules');
select lives_ok($$ select public.save_goal(pg_temp.goal(4, -12, 16, 'Read 20 books, well done')) $$,
                '... but can be renamed');
select is((select title || ':' || status from public.reward_goal where id = '45e00000-0000-0000-0000-000000000004'),
          'Read 20 books, well done:achieved', '... and stays reached');

select * from finish();
rollback;
