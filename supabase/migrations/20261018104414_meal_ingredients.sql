-- [MEAL-07] A meal's ingredients (WP-105, D-138 (6)): the library meal's `ingredients`, kept since
-- WP-25 for this, now checked: a list of up to 60 rows, each a name (1 to 80 characters), an amount
-- to buy ("1 can", "8", "1 lb": not the recipe's spoonfuls; up to 40, or none) and whether the family
-- usually has it (salt, oil), so the week's review starts it unticked.

create function private.meal_ingredients_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 60
     and not exists (
       select from jsonb_array_elements(p) x
        where jsonb_typeof(x) <> 'object'
           or jsonb_typeof(x -> 'name') is distinct from 'string'
           or length(btrim(x ->> 'name')) not between 1 and 80
           or (x ? 'amount' and jsonb_typeof(x -> 'amount') not in ('string', 'null'))
           or length(x ->> 'amount') > 40
           or (x ? 'have' and jsonb_typeof(x -> 'have') <> 'boolean'))
$$;

alter table public.meal add constraint meal_ingredients_shape check (private.meal_ingredients_ok(ingredients));

revoke all on function private.meal_ingredients_ok(jsonb) from public, anon;
grant execute on function private.meal_ingredients_ok(jsonb) to authenticated;
