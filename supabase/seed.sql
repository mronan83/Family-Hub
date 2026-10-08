-- The demo family (01 §9.5, D-37). Previews and e2e run as this household inside the one database;
-- RLS keeps it apart from every real household exactly as it keeps two families apart. Running this
-- file again resets the demo family: its household is deleted (every household_id cascades) and
-- recreated, along with its demo sign-ins. It touches no other household. Names are made up.
-- WP-03 onward add the demo admin sign-in (`…@demo.familywise.invalid`) and fixtures as tables arrive.

delete from public.household where id = '0de00000-0000-4000-8000-000000000001';
delete from auth.users where email like '%@demo.familywise.invalid';

insert into public.household (id, name, timezone)
values ('0de00000-0000-4000-8000-000000000001', 'Demo family', 'America/New_York');

insert into public.household_settings (household_id)
values ('0de00000-0000-4000-8000-000000000001');

insert into public.member (household_id, display_name, role, avatar_key, color, birth_year)
values
  ('0de00000-0000-4000-8000-000000000001', 'Alex', 'adult', 'owl', 'member-1', 1986),
  ('0de00000-0000-4000-8000-000000000001', 'Sam', 'adult', 'bear', 'member-2', 1987),
  ('0de00000-0000-4000-8000-000000000001', 'Maya', 'child', 'fox', 'member-3', 2016),
  ('0de00000-0000-4000-8000-000000000001', 'Leo', 'child', 'frog', 'member-4', 2019);
