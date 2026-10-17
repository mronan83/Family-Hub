// [D-127] The iPhone in CI (WP-100): the UI suite's iPhone project in WebKit, and the screenshots
// kept for a side-by-side with a mockup. Read from the config and the workflow, so a change that
// drops either fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../e2e/ui.config.ts', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const shots = readFileSync(new URL('./screen-shots.mjs', import.meta.url), 'utf8');

test('[NFR-16-h] the UI suite runs the goal, form and admin layout specs as an iPhone in WebKit', () => {
  const iphone = config.slice(config.indexOf("name: 'iphone'"));
  assert.match(iphone, /devices\['iPhone 13'\]/);
  for (const spec of ['controls', 'goals', 'goal-steps', 'goal-perfect', 'forms', 'admin-day']) {
    assert.ok(iphone.includes(`'${spec}.spec.ts'`), `${spec} runs on the iPhone`);
  }
  assert.match(ci, /playwright install --with-deps chromium webkit/);
});

test('[NFR-16-h] CI keeps iPhone and laptop screenshots of the goal screens as an artifact', () => {
  assert.match(ci, /node scripts\/screen-shots\.mjs --out=screen-shots/);
  assert.match(ci, /name: screen-shots/);
  assert.match(shots, /devices\['iPhone 13'\]/);
  for (const page of ['/dev/goals?form=new', '/dev/goals?form=repeating', '/dev/goals']) {
    assert.ok(shots.includes(`'${page}`), `${page} is shot`);
  }
});
