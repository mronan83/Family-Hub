import { adminHousehold, signedIn } from '@/lib/auth/session';
import { describeIssues } from '@/lib/completions';
import { formOf, liveRequestSchema } from '@/lib/goal-live';
import { liveSummaries } from '@/lib/goal-form-preview';
import { serverClient } from '@/lib/supabase/server';

// [NFR-16][D-128] POST /api/goals/summaries (WP-101, WP-110): the goal form as it stands, worked out as
// Preview works it out, without saving, as this admin through RLS. A route, not a server action, so a
// summary never holds the form's save behind it. JSON only, so no form on another site can post here.
export const dynamic = 'force-dynamic';

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'send JSON' });
  }
  const db = await serverClient();
  if (!db) return json(503, { error: 'sign-in is off' });
  const user = await signedIn(db);
  if (!user) return json(401, { error: 'not signed in' });
  const household = await adminHousehold(db, user.userId);
  if (!household) return json(403, { error: 'no household' });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'not JSON' });
  }
  const parsed = liveRequestSchema.safeParse(body);
  if (!parsed.success)
    return json(400, { error: 'invalid request', issues: describeIssues(parsed.error) });
  return json(200, { summaries: await liveSummaries(db, household.id, formOf(parsed.data.form)) });
}
