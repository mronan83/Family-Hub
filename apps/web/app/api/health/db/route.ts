import { createClient } from '@supabase/supabase-js';
import { dbHealth } from '@/lib/health-db';
import { supabaseSettings } from '@/lib/supabase/server';

// [NFR-12] GET /api/health/db, previews only (WP-113): how long the preview takes to reach the
// database, with the browser-safe key and no session (lib/health-db.ts).
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = supabaseSettings();
  const db = settings
    ? createClient(settings.url, settings.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  const { status, body } = await dbHealth(db ? () => db.rpc('db_probe') : null);
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
