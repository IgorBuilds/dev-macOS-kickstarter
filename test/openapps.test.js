import { test } from 'node:test';
import assert from 'node:assert/strict';
import prompts from 'prompts';
import { openableItems, openChoices, offerOpenApps } from '../src/openapps.js';
import { expandItem } from '../src/config.js';

const alfred = expandItem({ id: 'alfred', name: 'Alfred', section: 'apps', brew_cask: 'alfred', app: ['Alfred 6.app', 'Alfred 5.app'], setup: 'Set hotkey ⌘Space' });
const alt = expandItem({ id: 'alt-tab', name: 'AltTab', section: 'apps', brew_cask: 'alt-tab', app: 'AltTab.app' });
const xcode = expandItem({ id: 'xcode', name: 'Xcode', section: 'mobile', mas: 1, app: 'Xcode.app', heavy: true });
const git = expandItem({ id: 'git', name: 'git', section: 'dev', brew: 'git' });
const items = [alfred, alt, xcode, git];
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const quiet = () => { const lines = []; return { lines, ui: { print: (s) => lines.push(strip(s)) } }; };
const opener = () => { const opened = []; return { opened, open: async (path) => { opened.push(path); } }; };
const exists = (p) => p !== '/Applications/Alfred 6.app';

test('openableItems: only done items with an app', () => {
  const results = [{ id: 'alfred', status: 'done' }, { id: 'git', status: 'done' }, { id: 'alt-tab', status: 'already' }, { id: 'xcode', status: 'done' }];
  assert.deepEqual(openableItems(items, results).map((i) => i.id), ['alfred', 'xcode']);
});

test('openChoices: A–Z, heavy unticked, setup tip shown', () => {
  const c = openChoices([xcode, alt, alfred]);
  assert.deepEqual(c.map((x) => x.value), ['alfred', 'alt-tab', 'xcode']);
  assert.equal(c.find((x) => x.value === 'xcode').selected, false);
  assert.equal(c.find((x) => x.value === 'alfred').selected, true);
  assert.match(strip(c[0].title), /Set hotkey ⌘Space/);
});

test('one by one: opens each, shows tip, waits for Next; Stop halts', async () => {
  const o = opener(), q = quiet();
  prompts.inject([['alfred', 'alt-tab', 'xcode'], 'guided', 'next', 'stop']);
  await offerOpenApps([alfred, alt, xcode], { prompts, ui: q.ui, open: o.open, exists });
  assert.deepEqual(o.opened, ['/Applications/Alfred 5.app', '/Applications/AltTab.app']);
  assert.ok(q.lines.some((l) => l.includes('Set hotkey ⌘Space')));
});

test('all at once: opens every pick, lists tips', async () => {
  const o = opener(), q = quiet();
  prompts.inject([['alfred', 'alt-tab'], 'all']);
  await offerOpenApps([alfred, alt], { prompts, ui: q.ui, open: o.open, exists });
  assert.deepEqual(o.opened, ['/Applications/Alfred 5.app', '/Applications/AltTab.app']);
  assert.ok(q.lines.some((l) => l.includes('Set hotkey ⌘Space')));
});

test('single pick skips the how question', async () => {
  const o = opener();
  let asked = 0;
  const spy = async (qq, opt) => { asked++; return prompts(qq, opt); };
  prompts.inject([['alt-tab']]);
  await offerOpenApps([alfred, alt], { prompts: spy, ui: quiet().ui, open: o.open, exists });
  assert.equal(asked, 1);
  assert.deepEqual(o.opened, ['/Applications/AltTab.app']);
});

test('nothing picked or nothing openable → opens nothing', async () => {
  const o = opener();
  prompts.inject([[]]);
  await offerOpenApps([alfred], { prompts, ui: quiet().ui, open: o.open, exists });
  await offerOpenApps([], { prompts, ui: quiet().ui, open: o.open, exists });
  assert.equal(o.opened.length, 0);
});
