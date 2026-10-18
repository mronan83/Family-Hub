import { lookup } from 'node:dns/promises';
import { adminHousehold, signedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { fetchRecipePage } from '@/lib/recipe-fetch';
import { ingredientRows, recipeFromHtml } from '@/lib/recipe-read';
import { serverClient } from '@/lib/supabase/server';

// [MEAL-25] POST /api/recipes/read (WP-105, D-138 (6)): {url} → the recipe a page publishes, its
// ingredients as rows for the admin to check and its steps; nothing is saved here. An admin's only;
// the fetch takes only a public page, within its limits (lib/recipe-fetch.ts). JSON only, so no form
// on another site can post here.
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
  if (!(await adminHousehold(db, user.userId))) return json(403, { error: 'no household' });

  let url = '';
  try {
    url = String(((await request.json()) as { url?: unknown }).url ?? '').trim();
  } catch {
    return json(400, { error: 'not JSON' });
  }
  if (!url || url.length > 500) return json(400, { ok: false, why: 'bad_link' });
  const page = await fetchRecipePage(url, {
    lookup: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
    fetch,
  });
  if (!page.ok) {
    log('info', 'recipe link not read', { why: page.why });
    return json(200, page);
  }
  const recipe = recipeFromHtml(page.html);
  if (!recipe) return json(200, { ok: false, why: 'no_recipe' });
  return json(200, {
    ok: true,
    name: recipe.name,
    site: new URL(page.url).hostname.replace(/^www\./, ''),
    ingredients: ingredientRows(recipe.ingredients),
    steps: recipe.steps,
  });
}
