// [NFR-16-u][NFR-16-v][D-110][D-152] The UI suite and the screenshot script answer Next.js's router
// prefetches themselves, at once and with nothing (WP-118).
//
// A <Link> that comes into view makes the page fetch that route ahead of a tap: a GET with `_rsc=` in
// its URL and a `Next-Router-Prefetch` header. Playwright's WebKit fails a page.goto ("WebKit
// encountered an internal error", or no answer until the time limit) when it starts while such a
// fetch is still in flight and has to be cancelled; Chrome never does. The /dev pages these runs read
// prefetch their /admin links, which a run without sign-in can't open anyway, so nothing is lost: a
// prefetch answered 204 is dropped by the router, and a tap still navigates. Every other request,
// the page's own loads and saves included, goes to the server as before.

/** Next.js's prefetch header (`1`, `2` or `3` by kind of prefetch), lower-cased as Playwright gives it. */
const PREFETCH = 'next-router-prefetch';

/** Whether a request is one of the router's prefetches: `_rsc=` in the URL and the prefetch header. */
export function isRouterPrefetch(url, headers) {
  return new URL(url).searchParams.has('_rsc') && Boolean(headers[PREFETCH]);
}

/** Answers every router prefetch in a browser context with 204 No Content; all else is untouched. */
export async function answerPrefetches(context) {
  await context.route(
    (url) => url.searchParams.has('_rsc'),
    async (route) => {
      const request = route.request();
      if (isRouterPrefetch(request.url(), await request.allHeaders())) {
        await route.fulfill({ status: 204 });
      } else {
        await route.fallback();
      }
    },
  );
}
