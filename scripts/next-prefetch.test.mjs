// [NFR-16][D-110][D-152] The UI suite and the screenshot script answer Next.js's router prefetches
// themselves (scripts/next-prefetch.mjs, WP-118): only prefetches, every UI spec, every context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { answerPrefetches, isRouterPrefetch } from './next-prefetch.mjs';

const at = (path) => `http://localhost:3100${path}`;

test('[NFR-16-u] a router prefetch is a GET with _rsc and the prefetch header; a tap or a page load is not', () => {
  for (const kind of ['1', '2', '3']) {
    assert.equal(
      isRouterPrefetch(at('/admin/goals?_rsc=NKdt6'), { rsc: '1', 'next-router-prefetch': kind }),
      true,
      `prefetch header ${kind}`,
    );
  }
  // A tap's navigation fetches the route with `_rsc` but no prefetch header: it goes to the server.
  assert.equal(isRouterPrefetch(at('/admin/goals?_rsc=NKdt6'), { rsc: '1' }), false);
  assert.equal(isRouterPrefetch(at('/dev/goals?form=steps&theme=day'), {}), false);
  assert.equal(
    isRouterPrefetch(at('/dev/goals/summaries'), { 'next-router-prefetch': '1' }),
    false,
  );
});

test('[NFR-16-u] answerPrefetches answers a prefetch 204 at once and passes every other request on', async () => {
  const routes = [];
  await answerPrefetches({ route: async (match, handler) => routes.push({ match, handler }) });
  assert.equal(routes.length, 1);
  const [{ match, handler }] = routes;
  // Only requests with `_rsc` are routed at all; the page's own loads, fonts and saves never are.
  assert.equal(match(new URL(at('/admin/goals?_rsc=NKdt6'))), true);
  assert.equal(match(new URL(at('/dev/goals?form=steps'))), false);
  assert.equal(match(new URL(at('/brand/fonts.css'))), false);

  const answer = async (url, headers) => {
    const did = [];
    await handler({
      request: () => ({ url: () => url, allHeaders: async () => headers }),
      fulfill: async (how) => did.push(['fulfill', how]),
      fallback: async () => did.push(['fallback']),
    });
    return did;
  };
  assert.deepEqual(await answer(at('/admin/goals?_rsc=a'), { 'next-router-prefetch': '1' }), [
    ['fulfill', { status: 204 }],
  ]);
  assert.deepEqual(await answer(at('/admin/goals?_rsc=a'), { rsc: '1' }), [['fallback']]);
});

test('[NFR-16-v] every UI spec takes its test from e2e/ui/test.ts, and every screenshot context answers prefetches', () => {
  const dir = new URL('../e2e/ui/', import.meta.url);
  const specs = readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));
  assert.ok(specs.length > 0);
  const wrong = specs.filter((f) => {
    const text = readFileSync(new URL(f, dir), 'utf8');
    return (
      text.includes("from '@playwright/test'") ||
      !/import \{[^}]*\btest\b[^}]*\} from '\.\/test';/.test(text)
    );
  });
  assert.deepEqual(wrong, [], 'specs not importing test from ./test');

  const shots = readFileSync(new URL('./screen-shots.mjs', import.meta.url), 'utf8');
  // One place makes a context, and it answers prefetches before any page opens.
  assert.equal(shots.match(/\.newContext\(/g)?.length, 1, 'contexts made outside contextFor()');
  assert.match(
    shots,
    /async function contextFor\([^)]*\) \{\n\s+const context = await browser\.newContext\([^\n]*\n\s+await answerPrefetches\(context\);/,
  );
});
