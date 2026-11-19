import { test } from 'node:test';
import assert from 'node:assert/strict';
import prompts from 'prompts';
import { appStoreReminder } from '../src/appstore.js';
import { expandItem } from '../src/config.js';

const xcode = expandItem({ id: 'xcode', name: 'Xcode', section: 'apps', mas: 497799835, app: 'Xcode.app' });
const git = expandItem({ id: 'git', name: 'git', section: 'dev', brew: 'git' });
const quiet = () => { const lines = []; return { lines, ui: { print: (s) => lines.push(s) } }; };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('no App Store items → no reminder, everything kept', async () => {
  const q = quiet();
  const r = await appStoreReminder([git], { dryRun: false, prompts, ui: q.ui, open: async () => {} });
  assert.deepEqual(r.map((i) => i.id), ['git']);
  assert.equal(q.lines.length, 0);
});

test('dry-run → friendly reminder printed, no prompt', async () => {
  const q = quiet();
  const r = await appStoreReminder([git, xcode], { dryRun: true, prompts, ui: q.ui, open: async () => {} });
  assert.equal(r.length, 2);
  assert.match(strip(q.lines.join('\n')), /sign in to the App Store/i);
  assert.match(strip(q.lines.join('\n')), /Xcode/);
});

test('signed in → keeps everything', async () => {
  prompts.inject(['ok']);
  const r = await appStoreReminder([git, xcode], { dryRun: false, prompts, ui: quiet().ui, open: async () => {} });
  assert.deepEqual(r.map((i) => i.id), ['git', 'xcode']);
});

test('open App Store → opens it, then asks again', async () => {
  const opened = [];
  prompts.inject(['open', 'ok']);
  const r = await appStoreReminder([xcode], { dryRun: false, prompts, ui: quiet().ui, open: async (app) => opened.push(app) });
  assert.deepEqual(opened, ['App Store']);
  assert.equal(r.length, 1);
});

test('skip → drops App Store items (and only them)', async () => {
  prompts.inject(['skip']);
  const r = await appStoreReminder([git, xcode], { dryRun: false, prompts, ui: quiet().ui, open: async () => {} });
  assert.deepEqual(r.map((i) => i.id), ['git']);
});
