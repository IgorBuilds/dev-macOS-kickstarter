import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brewEnv } from '../src/env.js';

test('brewEnv prepends /opt/homebrew/bin', () => {
  const e = brewEnv({ PATH: '/usr/bin' }, () => true);
  assert.ok(e.PATH.startsWith('/opt/homebrew/bin:/opt/homebrew/sbin:'));
  assert.equal(e.HOMEBREW_PREFIX, '/opt/homebrew');
});

test('brewEnv is idempotent', () => {
  const once = brewEnv({ PATH: '/usr/bin' }, () => true);
  const twice = brewEnv(once, () => true);
  assert.equal(twice.PATH, once.PATH);
});

test('brewEnv leaves env unchanged without brew', () => {
  assert.deepEqual(brewEnv({ PATH: '/usr/bin' }, () => false), { PATH: '/usr/bin' });
});

test('brewEnv does not mutate input', () => {
  const input = { PATH: '/usr/bin' };
  brewEnv(input, () => true);
  assert.equal(input.PATH, '/usr/bin');
});
