import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * [NFR-07] Job endpoints answer only pg_net calls that carry the job secret as a bearer token
 * (01 §5.6). The secret lives in Supabase Vault and in Vercel's production environment only, so
 * previews and local runs refuse every job call. Returns the refusal, or null to proceed.
 */
export function jobAuthError(
  request: Request,
  secret = process.env.JOB_SIGNING_SECRET,
): Response | null {
  if (!secret) return Response.json({ error: 'jobs are off' }, { status: 503 });
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  // Compare digests so the comparison takes the same time whatever the token's length.
  const given = createHash('sha256').update(token).digest();
  const expected = createHash('sha256').update(secret).digest();
  if (!token || !timingSafeEqual(given, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
