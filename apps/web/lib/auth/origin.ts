/**
 * This deployment's origin, for links the app hands out (magic link and reset redirects, invite
 * links). Vercel sets the forwarded headers at its edge; Supabase Auth also refuses any redirect not
 * on its allow list (05 §0, Y-9).
 */
export function requestOrigin(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  const proto =
    headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0]?.trim() || 'https'}://${host.split(',')[0]?.trim()}`;
}
