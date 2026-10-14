import { describeIssues } from '@/lib/completions';
import { lunchRequestSchema } from '@/lib/lunch-picks';
import { serverClient } from '@/lib/supabase/server';

// [MEAL-09][MEAL-11][US-707] POST /api/lunches (01 §5.7): a board asks for a child's day as they want
// it, as the board, through request_lunch(): buy or bring, and a buy day's picks. It waits for a
// parent (D-95); the same as the day already is takes back what waited. JSON only, so no form on
// another site can post here.
export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) => Response.json(body, { status });

/** The day's rules, which the board says in a child's words; anything else is a server error. */
const RULES = [
  'locked',
  'not_on_menu',
  'pick_one',
  'no_menu',
  'not_buy',
  'not_school_day',
  'not_a_child',
];

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
  const parsed = lunchRequestSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });

  const { member_id, date, mode, choices } = parsed.data;
  const { data, error } = await db.rpc('request_lunch', {
    p_member: member_id,
    p_date: date,
    p_mode: mode,
    p_choices: choices,
  });
  if (error) {
    if (error.code === '42501') return json(403, { error: 'not_allowed' });
    if (error.hint && RULES.includes(error.hint)) return json(409, { error: error.hint });
    if (error.hint === 'bad_request') return json(400, { error: 'invalid request' });
    // System Health keeps anything the lunch rules don't explain.
    throw new Error(`request lunch: ${error.message}`);
  }
  return json(200, { lunch: data });
}
