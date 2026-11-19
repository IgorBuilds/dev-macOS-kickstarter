import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChoices } from '../src/picker.js';
import { expandItem } from '../src/config.js';

const config = {
  sections: [{ id: 'dev', title: '🛠 Dev' }, { id: 'apps', title: '📦 Apps' }, { id: 'links', title: '🔗 Links' }],
  items: [
    expandItem({ id: 'homebrew', name: 'Homebrew', section: 'dev', install: 'x', window: true, note: 'needs you' }),
    expandItem({ id: 'xcode', name: 'Xcode', section: 'apps', install: 'x' }),
    expandItem({ id: 'bruno', name: 'Bruno', section: 'apps', install: 'x' }),
    expandItem({ id: 'alt-tab', name: 'AltTab', section: 'apps', install: 'x' }),
    expandItem({ id: 'alfred', name: 'alfred-lower', section: 'apps', install: 'x' }),
    expandItem({ id: 'wf', name: 'Workflows', section: 'links', links: [{ name: 'a', url: 'https://a' }] }),
  ],
};
const statuses = new Map([
  ['homebrew', { state: 'installed', via: 'check' }],
  ['xcode', { state: 'missing' }],
  ['bruno', { state: 'installed', via: 'app' }],
  ['alt-tab', { state: 'missing' }],
  ['alfred', { state: 'unknown' }],
  ['wf', { state: 'confirmed', via: 'state' }],
]);
const choices = buildChoices(config, statuses);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('section headers in YAML order', () => {
  const headers = choices.filter((c) => c.value?.startsWith?.('§')).map((c) => strip(c.title));
  assert.deepEqual(headers, ['🛠 Dev', '📦 Apps', '🔗 Links']);
});

test('items A–Z (case-insensitive) within a section', () => {
  const apps = choices.filter((c) => ['xcode', 'bruno', 'alt-tab', 'alfred'].includes(c.value)).map((c) => c.value);
  assert.deepEqual(apps, ['alfred', 'alt-tab', 'bruno', 'xcode']);
});

test('one spacer between sections, none at the end', () => {
  const spacers = choices.map((c, i) => [c, i]).filter(([c]) => c.value?.startsWith?.('·'));
  assert.equal(spacers.length, 2);
  assert.ok(!choices.at(-1).value.startsWith('·'));
  assert.ok(choices[spacers[0][1] + 1].value.startsWith('§'));
});

test('headers and spacers are disabled', () => {
  for (const c of choices.filter((c) => /^[§·]/.test(c.value))) assert.equal(c.disabled, true);
});

test('installed items disabled and labelled, hand-installed say found in /Applications', () => {
  const hb = choices.find((c) => c.value === 'homebrew');
  assert.equal(hb.disabled, true);
  assert.match(strip(hb.title), /✔ Homebrew\s+already installed/);
  assert.match(strip(choices.find((c) => c.value === 'bruno').title), /found in \/Applications/);
});

test('missing selected, unknown and confirmed not selected', () => {
  assert.equal(choices.find((c) => c.value === 'xcode').selected, true);
  assert.equal(choices.find((c) => c.value === 'alfred').selected, false);
  const wf = choices.find((c) => c.value === 'wf');
  assert.equal(wf.selected, false);
  assert.match(strip(wf.title), /👤/);
});

test('window items carry a warning, notes become descriptions', () => {
  const hb = buildChoices(config, new Map([['homebrew', { state: 'missing' }]])).find((c) => c.value === 'homebrew');
  assert.match(strip(hb.title), /⚠️ opens window/);
  assert.equal(hb.description, 'needs you');
});

import prompts from 'prompts';
import { pickItems } from '../src/picker.js';

test('pickItems asks one multiselect per section with something to pick, returns ids', async () => {
  const printed = [];
  const asked = [];
  const fakePrompts = async (q, o) => { asked.push(q); return prompts(q, o); };
  prompts.inject([['xcode', 'alt-tab'], ['wf']]);
  const ids = await pickItems(config, statuses, { prompts: fakePrompts, print: (s) => printed.push(s) });
  assert.deepEqual(ids, ['xcode', 'alt-tab', 'wf']);
  assert.equal(asked.length, 2); // dev has only installed items → printed, not asked
  assert.match(strip(asked[0].message), /📦 Apps/);
  assert.ok(asked.every((q) => !q.choices.some((c) => /^[§·]/.test(c.value))));
  assert.ok(printed.some((s) => strip(s).includes('✔ Homebrew')));
});

test('pickItems cursor starts on the first selectable row', async () => {
  const asked = [];
  prompts.inject([[], []]);
  await pickItems(config, statuses, { prompts: async (q, o) => { asked.push(q); return prompts(q, o); }, print: () => {} });
  const apps = asked[0];
  assert.equal(apps.choices[apps.cursor].disabled, undefined);
});
