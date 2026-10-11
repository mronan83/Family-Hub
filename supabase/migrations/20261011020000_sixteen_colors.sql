-- [ACC-04][CHR-10][CAL-05] Sixteen colors for members, tags and calendars, up from six (WP-46, D-70).
-- The app draws each as `var(--member-N)` behind white initials, and `var(--member-N-line)` for lines
-- and dots, with a lighter shade in the Evening theme. Only the checks widen: every color already
-- stored stays valid, and the defaults are unchanged.
alter table public.member drop constraint member_color_check;
alter table public.member
  add constraint member_color_check check (color ~ '^member-([1-9]|1[0-6])$');

alter table public.tag drop constraint tag_color_check;
alter table public.tag
  add constraint tag_color_check check (color ~ '^member-([1-9]|1[0-6])$');

alter table public.calendar_source drop constraint calendar_source_color_check;
alter table public.calendar_source
  add constraint calendar_source_color_check check (color ~ '^member-([1-9]|1[0-6])$');
