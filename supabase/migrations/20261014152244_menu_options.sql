-- [MENU-06][US-804] The school menu by section, as options (WP-64, D-94).
--   * A stored item keeps its option in its section: `school_menu_day.items` is [{name, section?,
--     option?}]. The app reads "or" and "with" into options (lib/menu/sections.ts): "or" separates
--     options, "with" joins a side to the option before it, which shares its number. The section
--     title is kept as the menu writes it ("Choice of Entree"); the app shortens it to show it.
--   * Feeds fetched before this read again on their next fetch: their content hash is cleared, so the
--     fetch writes its days with options even if Nutrislice's menus are unchanged. Days stored without
--     options are read by the same rules until then. A parent's own days keep what they have.
--   * lunch_week() gives each child's menu's name, and the day's menu on every day with a school
--     lunch, buy or bring, so the board's Meals screen can show the week's menu by section. The app
--     still shows a child's menu only on the days they buy.

-- A day's items as stored: [{name, section?, option?}], names 1 to 120 characters, sections up to 60,
-- options 1 to 60, at most 60 items. Raises on anything else.
create or replace function private.menu_items(p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_item jsonb;
  v_name text;
  v_sec  text;
  v_opt  jsonb;
begin
  if p_items is null then
    return v_out;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then
    raise exception 'a day''s menu is up to 60 items' using errcode = '22023', hint = 'bad_menu';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'each item has a name of up to 120 characters' using errcode = '22023', hint = 'bad_menu';
    end if;
    v_name := btrim(v_item ->> 'name');
    v_sec := nullif(btrim(v_item ->> 'section'), '');
    v_opt := v_item -> 'option';
    if coalesce(length(v_name), 0) not between 1 and 120 or coalesce(length(v_sec), 0) > 60 then
      raise exception 'each item has a name of up to 120 characters' using errcode = '22023', hint = 'bad_menu';
    end if;
    if v_opt is not null and jsonb_typeof(v_opt) <> 'null'
       and (jsonb_typeof(v_opt) <> 'number' or v_opt::text !~ '^[0-9]+$' or (v_opt::text)::int not between 1 and 60) then
      raise exception 'an item''s option is a number from 1 to 60' using errcode = '22023', hint = 'bad_menu';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'name', v_name, 'section', v_sec,
      'option', case when jsonb_typeof(v_opt) = 'number' then (v_opt::text)::int end)));
  end loop;
  return v_out;
end $$;

-- lunch_week (WP-26, WP-27) with each child's menu's name and, on every day with a school lunch, that
-- day's menu (null when the menu has nothing that day, or they have no menu).
create or replace function public.lunch_week(p_household uuid, p_from date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household is null or p_from is null
     or not (p_household in (select private.admin_household_ids())
             or p_household = private.device_household_id()) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'member_id', m.id,
             'usual', coalesce(l.defaults, '{}'::jsonb),
             'menu_source_id', l.menu_source_id,
             'menu_name', s.name,
             'days', (select jsonb_agg(jsonb_build_object(
                               'date', d.day,
                               'day_type', public.resolve_day_type(m.id, d.day),
                               'mode', x.mode,
                               'changed', exists (select from public.lunch_override o
                                                   where o.member_id = m.id and o.lunch_date = d.day
                                                     and public.resolve_day_type(m.id, d.day) = 'school_day'),
                               'menu', case when x.mode is not null and l.menu_source_id is not null
                                            then private.menu_on(l.menu_source_id, d.day) end)
                             order by d.day)
                        from generate_series(p_from, p_from + 6, interval '1 day') g (t)
                        cross join lateral (select g.t::date as day) d
                        cross join lateral (select public.lunch_mode(m.id, d.day) as mode) x))
           order by m.display_name, m.id)
      from public.member m
      left join public.member_lunch l on l.member_id = m.id
      left join public.menu_source s on s.id = l.menu_source_id
     where m.household_id = p_household and m.role = 'child' and m.archived_at is null), '[]'::jsonb);
end $$;

-- Each feed's next fetch writes its days again, with options.
update public.menu_source set content_hash = null where adapter = 'nutrislice' and content_hash is not null;
