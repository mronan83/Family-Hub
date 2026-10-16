import { installScript } from '@/lib/kiosk-scripts';

// [DEV-07] The Pi's screen helper installer (WP-34): `curl -fsSL <site>/api/kiosk/install | bash`.
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(installScript(new URL(request.url).origin), {
    headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
