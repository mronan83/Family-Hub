-- [MEAL-25][MEAL-26] A meal's recipe (WP-105, D-138 (6), Q21, Q22): a link (meal.recipe_url, since
-- WP-25), photos and PDFs, and the steps read from the link's published recipe data.
--   * Storage: a private bucket `recipes`, up to 10 MB a file, photos and PDFs, a folder per
--     household (`<household>/<meal>/<file>`). Its admins add and remove; its admins and boards read
--     (through short-lived signed links).
--   * `meal_recipe_file`: each file of a meal, in order: a photo or a PDF, its name as uploaded, its
--     place in storage, its size. Added and removed by the household's admins through RLS.
--   * `meal.recipe_steps`: the steps the link's page publishes (up to 60), for the board to cook from.
--   * board_recipes(from, to): for a board, the recipe of each library meal planned in those days that
--     has one (its link, ingredients, steps and files), so its Meals screen opens it full screen.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipes', 'recipes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy recipes_file_read on storage.objects for select to authenticated
  using (bucket_id = 'recipes'
         and ((storage.foldername(name))[1] in (select h::text from private.admin_household_ids() h)
              or (storage.foldername(name))[1] = (select private.device_household_id())::text));
create policy recipes_file_add on storage.objects for insert to authenticated
  with check (bucket_id = 'recipes'
              and (storage.foldername(name))[1] in (select h::text from private.admin_household_ids() h));
create policy recipes_file_remove on storage.objects for delete to authenticated
  using (bucket_id = 'recipes'
         and (storage.foldername(name))[1] in (select h::text from private.admin_household_ids() h));

create table public.meal_recipe_file (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  meal_id      uuid not null,
  kind         text not null check (kind in ('photo', 'pdf')),
  name         text not null check (name = btrim(name) and length(name) between 1 and 120),
  -- The object's name in the `recipes` bucket: the household's folder, then the meal's.
  path         text not null unique,
  size_bytes   integer not null check (size_bytes between 1 and 10485760),
  sort_order   integer not null default 0,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  check (path like household_id::text || '/' || meal_id::text || '/%'),
  foreign key (household_id, meal_id) references public.meal (household_id, id)
);
create index on public.meal_recipe_file (meal_id, sort_order);

alter table public.meal_recipe_file enable row level security;
create policy meal_recipe_file_admin_select on public.meal_recipe_file for select to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy meal_recipe_file_admin_insert on public.meal_recipe_file for insert to authenticated
  with check (household_id in (select private.admin_household_ids()));
create policy meal_recipe_file_admin_delete on public.meal_recipe_file for delete to authenticated
  using (household_id in (select private.admin_household_ids()));
create policy meal_recipe_file_device_select on public.meal_recipe_file for select to authenticated
  using (household_id = (select private.device_household_id()));
revoke all on public.meal_recipe_file from public, anon;
revoke update, truncate on public.meal_recipe_file from authenticated;
grant select, insert, delete on public.meal_recipe_file to authenticated;
create trigger trg_audit after insert or update or delete on public.meal_recipe_file
  for each row execute function private.audit_row();

alter table public.meal add column recipe_steps jsonb not null default '[]'
  check (jsonb_typeof(recipe_steps) = 'array' and jsonb_array_length(recipe_steps) <= 60);

-- [MEAL-26] A board's recipes for the days it shows: each planned library meal with a recipe.
create function public.board_recipes(p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_household uuid := private.device_household_id();
begin
  if v_household is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 42 then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id', e.id, 'meal_id', m.id, 'name', m.name, 'date', e.plan_date, 'slot', e.slot,
             'recipe_url', m.recipe_url, 'ingredients', m.ingredients, 'steps', m.recipe_steps,
             'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'name', f.name,
                                                                    'path', f.path)
                                                 order by f.sort_order, f.created_at)
                                  from public.meal_recipe_file f where f.meal_id = m.id), '[]'))
           order by e.plan_date, e.slot, e.sort_order)
      from public.meal_plan_entry e
      join public.meal m on m.id = e.meal_id
     where e.household_id = v_household and e.plan_date between p_from and p_to
       and (m.recipe_url is not null or jsonb_array_length(m.ingredients) > 0
            or jsonb_array_length(m.recipe_steps) > 0
            or exists (select from public.meal_recipe_file f where f.meal_id = m.id))), '[]');
end $$;
revoke all on function public.board_recipes(date, date) from public, anon;
grant execute on function public.board_recipes(date, date) to authenticated;
