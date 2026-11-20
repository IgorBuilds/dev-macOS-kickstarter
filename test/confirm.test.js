import { test } from 'node:test';
import assert from 'node:assert/strict';
import prompts from 'prompts';
import { confirmPlan } from '../src/confirm.js';
import { expandItem } from '../src/config.js';

const config = { sections: [{ id: 'dev', title: '💻 Dev' }, { id: 'apps', title: '📦 Apps' }] };
const items = [
  expandItem({ id: 'homebrew', name: 'Homebrew', emoji: '🍺', section: 'dev', install: 'x', window: true }),
  expandItem({ id: 'zed', name: 'Zed', section: 'apps', install: 'x' }),
  expandItem({ id: 'bruno', name: 'Bruno', section: 'apps', install: 'x' }),
];
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const capture = () => { const lines = []; return { lines, ui: { print: (s) => lines.push(strip(s)) } }; };

test('summary lists picks by section, A–Z, marks window items with 🪟, no ⚠️', async () => {
  const c = capture();
  prompts.inject(['start']);
  await confirmPlan(items, { config, prompts, ui: c.ui, allowBack: true });
  const out = c.lines.join('\n');
  assert.match(out, /Ready to set up 3 items/);
  assert.ok(out.indexOf('💻 Dev') < out.indexOf('Homebrew') && out.indexOf('📦 Apps') < out.indexOf('Bruno'));
  assert.ok(out.indexOf('Bruno') < out.indexOf('Zed'));
  assert.match(out, /Homebrew\s+🪟/);
  assert.doesNotMatch(out, /⚠️/);
});

test('returns the chosen action', async () => {
  for (const a of ['start', 'back', 'cancel']) {
    prompts.inject([a]);
    assert.equal(await confirmPlan(items, { config, prompts, ui: capture().ui, allowBack: true }), a);
  }
});

test('without allowBack there is no "go back" choice', async () => {
  let q;
  prompts.inject(['start']);
  await confirmPlan(items, { config, prompts: async (qq, o) => { q = qq; return prompts(qq, o); }, ui: capture().ui, allowBack: false });
  assert.ok(!q.choices.some((c) => c.value === 'back'));
});
