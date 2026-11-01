import type { SupabaseClient } from '@supabase/supabase-js';
import type { GroceryBrand } from '@/lib/grocery-brands';
import type { Bought, StapleChoice } from '@/lib/grocery-staples';
import { GOT_RECENTLY_DAYS } from '@/lib/groceries';
import type {
  GroceryCategory,
  GroceryItem,
  GroceryStore,
  LearnedWord,
  PastItem,
  Person,
  WaitingAsk,
} from '@/lib/groceries';

// Groceries (WP-104), read through RLS as the parent: the household's categories and stores, the
// list and what was got this week, the people its reasons name, and what the suggestion learns from.

export interface GroceriesData {
  categories: GroceryCategory[];
  stores: GroceryStore[];
  /** [MEAL-29] The household's brands, archived ones too (WP-116). */
  brands: GroceryBrand[];
  items: GroceryItem[];
  people: Person[];
  past: PastItem[];
  learned: LearnedWord[];
  /** [MEAL-28] New items go to: the household's preferred store, none for Any store. */
  preferredStoreId: string | null;
  /** [MEAL-22] The children's asks waiting for a parent, oldest first (WP-107). */
  asks?: WaitingAsk[];
  /** [MEAL-21] Each thing's buys, and the household's choices for them (WP-106). */
  bought?: Bought[];
  stapleChoices?: StapleChoice[];
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

export async function loadGroceries(
  db: SupabaseClient,
  householdId: string,
  now: number = Date.now(),
): Promise<GroceriesData> {
  const since = new Date(now - GOT_RECENTLY_DAYS * 86_400_000).toISOString();
  const [cats, stores, brands, items, people, past, learned, list, asks, staples] =
    await Promise.all([
      db
        .from('grocery_category')
        .select('id, name, icon, starter_key, is_other, sort_order')
        .eq('household_id', householdId),
      db.from('grocery_store').select('id, name, sort_order').eq('household_id', householdId),
      db.from('grocery_brand').select('id, name, archived_at').eq('household_id', householdId),
      db
        .from('grocery_item')
        .select(
          'id, name, amount, category_id, store_id, brand_id, status, ticked_at, ticked_by, created_at, ' +
            'ticked_member_id, ticked_device:device!grocery_item_ticked_device_id_fkey(name), ' +
            'grocery_item_reason(kind, by_user, member_id, meal_plan_entry_id, label, amount, created_at)',
        )
        .eq('household_id', householdId)
        .or(`status.eq.open,and(status.eq.ticked,ticked_at.gte.${since})`),
      db
        .from('member')
        .select('id, display_name, user_id, avatar_key, color, role, grocery_ask_ok')
        .eq('household_id', householdId),
      db
        .from('grocery_item')
        .select('name_key, category_id, store_id, brand_id, created_at')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(2000),
      db
        .from('grocery_learned_word')
        .select('word, category_id, weight')
        .eq('household_id', householdId),
      db
        .from('grocery_list')
        .select('preferred_store_id')
        .eq('household_id', householdId)
        .maybeSingle(),
      db
        .from('grocery_ask')
        .select(
          'id, member_id, name, brand_id, asked_at, board:device!grocery_ask_asked_by_fkey(name)',
        )
        .eq('household_id', householdId)
        .eq('status', 'waiting')
        .order('asked_at'),
      loadStaples(db, householdId),
    ]);
  fail('grocery categories', cats.error);
  fail('grocery stores', stores.error);
  fail('grocery brands', brands.error);
  fail('groceries', items.error);
  fail('people', people.error);
  fail('grocery history', past.error);
  fail('learned words', learned.error);
  fail('the list', list.error);
  fail('grocery asks', asks.error);
  type ItemRow = {
    id: string;
    name: string;
    amount: string | null;
    category_id: string;
    store_id: string | null;
    brand_id: string | null;
    status: 'open' | 'ticked';
    ticked_at: string | null;
    ticked_by: string | null;
    created_at: string;
    ticked_member_id?: string | null;
    ticked_device?: { name: string } | null;
    grocery_item_reason: {
      kind: GroceryItem['reasons'][number]['kind'];
      by_user: string | null;
      member_id: string | null;
      meal_plan_entry_id: string | null;
      label: string | null;
      amount: string | null;
      created_at: string;
    }[];
  };
  return {
    categories: (cats.data ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      icon: c.icon as string,
      starterKey: (c.starter_key as string | null) ?? null,
      isOther: c.is_other as boolean,
      sortOrder: c.sort_order as number,
    })),
    stores: (stores.data ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      sortOrder: s.sort_order as number,
    })),
    brands: (brands.data ?? []).map((b) => ({
      id: b.id as string,
      name: b.name as string,
      archived: b.archived_at !== null,
    })),
    items: ((items.data ?? []) as unknown as ItemRow[]).map((i) => ({
      id: i.id,
      name: i.name,
      amount: i.amount,
      categoryId: i.category_id,
      storeId: i.store_id,
      brandId: i.brand_id,
      status: i.status,
      tickedAt: i.ticked_at,
      tickedBy: i.ticked_by,
      tickedMemberId: i.ticked_member_id ?? null,
      tickedBoard: i.ticked_device?.name ?? null,
      createdAt: i.created_at,
      reasons: (i.grocery_item_reason ?? []).map((r) => ({
        kind: r.kind,
        byUser: r.by_user,
        memberId: r.member_id,
        mealPlanEntryId: r.meal_plan_entry_id,
        label: r.label,
        amount: r.amount,
        createdAt: r.created_at,
      })),
    })),
    people: (people.data ?? []).map((m) => ({
      id: m.id as string,
      name: m.display_name as string,
      userId: (m.user_id as string | null) ?? null,
      avatarKey: (m.avatar_key as string | null) ?? null,
      color: m.color as string,
      role: m.role as 'child' | 'adult',
      askOk: m.grocery_ask_ok as boolean,
    })),
    past: (past.data ?? []).map((p) => ({
      key: p.name_key as string,
      categoryId: p.category_id as string,
      storeId: (p.store_id as string | null) ?? null,
      brandId: (p.brand_id as string | null) ?? null,
      createdAt: p.created_at as string,
    })),
    learned: (learned.data ?? []).map((w) => ({
      word: w.word as string,
      categoryId: w.category_id as string,
      weight: w.weight as number,
    })),
    preferredStoreId: (list.data?.preferred_store_id as string | null | undefined) ?? null,
    asks: (
      (asks.data ?? []) as unknown as {
        id: string;
        member_id: string;
        name: string;
        brand_id: string | null;
        asked_at: string;
        board: { name: string } | null;
      }[]
    ).map((a) => ({
      id: a.id,
      memberId: a.member_id,
      name: a.name,
      brandId: a.brand_id,
      askedAt: a.asked_at,
      board: a.board?.name ?? null,
    })),
    ...staples,
  };
}

/**
 * [MEAL-21] Each thing's buys (`grocery_buys()`, read from the history) and the household's Not now
 * and Don't suggest (WP-106), for Running low?, Staples and Home's line.
 */
export async function loadStaples(
  db: SupabaseClient,
  householdId: string,
): Promise<{ bought: Bought[]; stapleChoices: StapleChoice[] }> {
  const [buys, choices] = await Promise.all([
    db.rpc('grocery_buys', { p_household: householdId }),
    db
      .from('grocery_staple')
      .select('name_key, not_now_until, off_at')
      .eq('household_id', householdId),
  ]);
  fail('grocery buys', buys.error);
  fail('staples', choices.error);
  return {
    bought: (
      (buys.data ?? []) as { name_key: string; name: string; buys: number; days: string[] }[]
    ).map((b) => ({ key: b.name_key, name: b.name, buys: b.buys, days: b.days ?? [] })),
    stapleChoices: (
      (choices.data ?? []) as {
        name_key: string;
        not_now_until: string | null;
        off_at: string | null;
      }[]
    ).map((c) => ({ key: c.name_key, notNowUntil: c.not_now_until, offAt: c.off_at })),
  };
}
