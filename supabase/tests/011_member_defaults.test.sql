-- [PTS-07] The earns-rewards switch defaults from the member's role and can be set per person (D-32).
begin;
select plan(4);

insert into public.household (id, name, timezone) values
  ('33333333-3333-3333-3333-333333333333', 'Defaults', 'America/Detroit');
insert into public.member (id, household_id, display_name, role) values
  ('c0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Sam', 'child'),
  ('c0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Pat', 'adult');
insert into public.member (id, household_id, display_name, role, earns_rewards) values
  ('c0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Alex', 'adult', true);

select is((select earns_rewards from public.member where display_name = 'Sam'), true,
  '[PTS-07] a child earns rewards by default');
select is((select earns_rewards from public.member where display_name = 'Pat'), false,
  '[PTS-07] an adult does not earn rewards by default');
select is((select earns_rewards from public.member where display_name = 'Alex'), true,
  '[PTS-07] an explicit setting on insert is kept');
update public.member set earns_rewards = false where display_name = 'Sam';
select is((select earns_rewards from public.member where display_name = 'Sam'), false,
  '[PTS-07] the switch can be changed later');

select * from finish();
rollback;
