import test from 'node:test';
import assert from 'node:assert/strict';
import { selfTest } from './check-site.mjs';

test('every rule rejects its planted violator and the clean fixture passes', () => {
  const { cases, failures } = selfTest();
  assert.deepEqual(failures, []);
  assert.ok(cases >= 25, `expected at least 25 cases, ran ${cases}`);
});
