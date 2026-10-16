import { screenHelper } from '@/lib/kiosk-scripts';

// [DEV-07] The Pi's screen helper itself (WP-34), fetched by the installer.
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(screenHelper(new URL(request.url).origin), {
    headers: { 'Content-Type': 'text/x-python; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
