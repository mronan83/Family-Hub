import { describeIssues } from '@/lib/completions';
import { redemptionCancelSchema, refusal } from '@/lib/rewards';
import { serverClient } from '@/lib/supabase/server';

// [PTS-04][US-1104] POST /api/redemptions/cancel: a child changes their mind on the board while their
// request is still waiting for a parent (nothing was spent). Once approved, only a parent cancels it,
// in the admin app, which refunds it. Cancelling twice answers the same.
export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) => Response.json(body, { status });

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
  const parsed = redemptionCancelSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });

  const { data, error } = await db.rpc('cancel_redemption', { p_id: parsed.data.id });
  if (error) {
    const r = refusal(error);
    if (r.status === 400 && r.reason === 'invalid')
      throw new Error(`cancel redemption: ${error.message}`);
    return json(r.status, { error: r.reason });
  }
  return json(200, { redemption: data });
}
