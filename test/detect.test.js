import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectItem, detectAll } from '../src/detect.js';
import { expandItem } from '../src/config.js';

const shellWith = (code, timedOut = false) => async () => ({ code, tail: [], timedOut });
const base = { state: { version: 1, items: {} }, env: {}, exists: () => false };
const alfred = expandItem({ id: 'alfred', name: 'Alfred', section: 'apps', brew_cask: 'alfred', app: ['Alfred 6.app', 'Alfred 5.app'] });

test('check exit 0 → installed via check', async () => {
  assert.deepEqual(await detectItem(alfred, { ...base, runShell: shellWith(0) }), { state: 'installed', via: 'check' });
});

test('check exit 1 → missing', async () => {
  assert.deepEqual(await detectItem(alfred, { ...base, runShell: shellWith(1) }), { state: 'missing' });
});

test('detect: app present outside brew counts as installed', async () => {
  const exists = (p) => p === '/Applications/Alfred 5.app';
  assert.deepEqual(await detectItem(alfred, { ...base, exists, runShell: shellWith(1) }), { state: 'installed', via: 'app' });
});

test('check timing out → missing', async () => {
  assert.deepEqual(await detectItem(alfred, { ...base, runShell: shellWith(137, true) }), { state: 'missing' });
});

test('no check and not links → unknown', async () => {
  const i = expandItem({ id: 'x', name: 'X', section: 'dev', install: 'true' });
  assert.deepEqual(await detectItem(i, { ...base, runShell: shellWith(0) }), { state: 'unknown' });
});

const links = expandItem({ id: 'l', name: 'L', section: 'links', links: [{ name: 'A', url: 'https://a' }, { name: 'B', url: 'https://b' }] });

test('links all confirmed in state → confirmed', async () => {
  const state = { version: 1, items: { l: { links: { 'https://a': { confirmedAt: 'x' }, 'https://b': { confirmedAt: 'x' } } } } };
  assert.deepEqual(await detectItem(links, { ...base, state, runShell: shellWith(1) }), { state: 'confirmed', via: 'state' });
});

test('links partially confirmed → unknown', async () => {
  const state = { version: 1, items: { l: { links: { 'https://a': { confirmedAt: 'x' } } } } };
  assert.deepEqual(await detectItem(links, { ...base, state, runShell: shellWith(1) }), { state: 'unknown' });
});

test('check runs with given env', async () => {
  let seenEnv;
  await detectItem(alfred, { ...base, env: { A: '1' }, runShell: async (_c, o) => { seenEnv = o.env; return { code: 0, tail: [], timedOut: false }; } });
  assert.deepEqual(seenEnv, { A: '1' });
});

test('detectAll returns a Map with every id', async () => {
  const m = await detectAll([alfred, links], { ...base, runShell: shellWith(0) });
  assert.deepEqual([...m.keys()], ['alfred', 'l']);
});

test('builtin items use injected builtinCheck', async () => {
  const z = expandItem({ id: 'zshrc', name: '.zshrc', section: 'dev', builtin: 'zshrc' });
  assert.deepEqual(await detectItem(z, { ...base, runShell: shellWith(1), builtinCheck: () => true }), { state: 'installed', via: 'check' });
  assert.deepEqual(await detectItem(z, { ...base, runShell: shellWith(0), builtinCheck: () => false }), { state: 'missing' });
});
