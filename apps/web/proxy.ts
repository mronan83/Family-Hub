import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { signInPath } from './lib/auth/next';
import { supabaseSettings } from './lib/supabase/server';

/**
 * [ACC-02] Keeps the Supabase session fresh on every page (Server Components cannot write cookies)
 * and sends a signed-out visitor from /admin to sign in. This is the quick check only: every admin
 * page and action verifies the user again on the server (lib/auth/session.ts), and RLS decides
 * what any query returns.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const settings = supabaseSettings();
  let signedIn = false;

  if (settings) {
    const db = createServerClient(settings.url, settings.key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    });
    const { data } = await db.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }

  const { pathname, search } = request.nextUrl;
  if (!signedIn && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    const url = new URL(signInPath(`${pathname}${search}`), request.url);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  // Pages only: not static files, icons, the service worker, or API routes (jobs use a bearer token).
  matcher: [
    '/((?!api/|_next/static|_next/image|brand/|icons/|sw\\.js|.*\\.(?:svg|png|ico|webmanifest|woff2)$).*)',
  ],
};
