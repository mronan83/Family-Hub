// [MEAL-27-f] The run's tag for an e2e spec's made-up names (scripts/e2e-names.mjs, WP-125).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameTag } from './e2e-names.mjs';

test('[MEAL-27-f] a run’s tag is letters only, of the length asked', () => {
  for (let i = 0; i < 500; i += 1) assert.match(nameTag(), /^[a-z]{5}$/);
  assert.match(nameTag(8), /^[a-z]{8}$/);
  // The ends of the range: never past "z".
  assert.equal(
    nameTag(3, () => 0),
    'aaa',
  );
  assert.equal(
    nameTag(3, () => 0.9999999),
    'zzz',
  );
});
