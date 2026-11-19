import { test } from 'node:test';
import assert from 'node:assert/strict';
import prompts from 'prompts';
import { linkChoices, runLinksItem } from '../src/links.js';
import { expandItem } from '../src/config.js';

const item = expandItem({
  id: 'ext', name: 'Chrome extensions', section: 'links', browser: 'Google Chrome',
  links: [{ name: 'Zeta', url: 'https://z' }, { name: 'Alpha', url: 'https://a' }, { name: 'Mid', url: 'https://m' }],
});
const fresh = () => ({ version: 1, items: {} });
const recorder = () => { const calls = []; return { calls, open: async (url, browser) => { calls.push([url, browser]); } }; };

test('linkChoices are A–Z and mark confirmed ones', () => {
  const state = { version: 1, items: { ext: { links: { 'https://m': { confirmedAt: 'x' } } } } };
  const c = linkChoices(item, state);
  assert.deepEqual(c.map((x) => x.value), ['https://a', 'https://m', 'https://z']);
  assert.match(c[1].title, /👤 Mid/);
  assert.ok(c.every((x) => x.selected === false));
});

test('opens picked links in the item browser and records confirmations', async () => {
  const state = fresh(), r = recorder();
  prompts.inject([['https://a', 'https://z'], ['https://a']]);
  const res = await runLinksItem(item, { state, prompts, open: r.open, dryRun: false });
  assert.deepEqual(r.calls, [['https://a', 'Google Chrome'], ['https://z', 'Google Chrome']]);
  assert.equal(res.status, 'confirmed');
  assert.deepEqual(res.confirmed, ['https://a']);
  assert.ok(state.items.ext.links['https://a'].confirmedAt);
  assert.equal(state.items.ext.links['https://z'], undefined);
});

test('picking nothing skips without opening', async () => {
  const r = recorder();
  prompts.inject([[]]);
  const res = await runLinksItem(item, { state: fresh(), prompts, open: r.open, dryRun: false });
  assert.equal(res.status, 'skipped');
  assert.equal(r.calls.length, 0);
});

test('opened but none confirmed → skipped', async () => {
  const r = recorder();
  prompts.inject([['https://a'], []]);
  const res = await runLinksItem(item, { state: fresh(), prompts, open: r.open, dryRun: false });
  assert.equal(res.status, 'skipped');
  assert.deepEqual(res.opened, ['https://a']);
});

test('dry-run never opens, status planned, lists unconfirmed links', async () => {
  const r = recorder();
  const state = { version: 1, items: { ext: { links: { 'https://m': { confirmedAt: 'x' } } } } };
  const res = await runLinksItem(item, { state, prompts, open: r.open, dryRun: true });
  assert.equal(res.status, 'planned');
  assert.equal(r.calls.length, 0);
  assert.deepEqual(res.opened, ['https://a', 'https://z']);
});
