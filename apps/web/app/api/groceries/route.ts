import { describeIssues } from '@/lib/completions';
import { groceryActionSchema } from '@/lib/grocery-asks';
import { itemKey } from '@/lib/grocery-merge';
import { starterList } from '@/lib/grocery-starter';
import { suggest } from '@/lib/groceries';
import { serverClient } from '@/lib/supabase/server';

// [MEAL-22][MEAL-30] POST /api/groceries (01 §5.7): the board's Groceries, as the board (WP-107,
// D-149): ask for a thing as one of the household (ask_groceries(); a child's waits for a parent
// while their OK is on), call an ask off, tick or untick, take off, and put back with Undo. The
// database checks the board, the member and the household. JSON only, so no form on another site
// can post here.
export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) => Response.json(body, { status });

/** The rules the board says in its own words; anything else is a server error. */
const RULES = ['too_many', 'not_yours', 'not_found', 'not_a_child'];

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'send JSON' });
  }
  const db = await serverClient();
  if (!db) return json(503, { error: 'sign-in is off' });
  const { data: auth } = await db.auth.getClaims();
  if (!auth?.claims?.sub) return json(401, { error: 'not signed in' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'not JSON' });
  }
  const parsed = groceryActionSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });
  const a = parsed.data;

  let call;
  switch (a.action) {
    case 'ask': {
      // [MEAL-24] A new thing's category, from the starter list (the database keeps last time's).
      const cats = await db
        .from('grocery_category')
        .select('id, name, icon, starter_key, is_other, sort_order');
      const categories = (cats.data ?? []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        icon: c.icon as string,
        starterKey: (c.starter_key as string | null) ?? null,
        isOther: c.is_other as boolean,
        sortOrder: c.sort_order as number,
      }));
      const s = suggest(a.name, { categories, past: [], learned: [], starter: starterList });
      call = db.rpc('ask_groceries', {
        p_member: a.member_id,
        p_name: a.name,
        p_key: itemKey(a.name),
        p_category: s?.categoryId ?? null,
        p_brand: a.brand_id,
      });
      break;
    }
    case 'call_off':
      call = db.rpc('call_off_grocery_ask', { p_ask: a.ask_id });
      break;
    case 'tick':
      call = db.rpc('board_tick_groceries', {
        p_ids: a.ids,
        p_member: a.member_id,
        p_ticked: a.ticked,
      });
      break;
    case 'remove':
      call = db.rpc('board_remove_groceries', { p_ids: a.ids, p_member: a.member_id });
      break;
    case 'restore':
      call = db.rpc('board_restore_groceries', { p_ids: a.ids, p_member: a.member_id });
      break;
  }
  const { data, error } = await call;
  if (error) {
    if (error.hint && RULES.includes(error.hint)) return json(409, { error: error.hint });
    if (error.code === '42501') return json(403, { error: 'not_allowed' });
    if (error.hint === 'bad_request') return json(400, { error: 'invalid request' });
    // System Health keeps anything the board's rules don't explain.
    throw new Error(`groceries ${a.action}: ${error.message}`);
  }
  return json(200, { data });
}
