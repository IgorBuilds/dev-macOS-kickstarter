import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState, dataHome } from '../src/state.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ks-state-'));

test('loadState on missing dir returns empty state', () => {
  assert.deepEqual(loadState(join(tmp(), 'nope')), { version: 1, items: {} });
});

test('saveState then loadState round-trips', () => {
  const home = join(tmp(), 'deep');
  const s = { version: 1, items: { git: { status: 'done', lastRun: '2026-11-18T00:00:00Z' } } };
  saveState(home, s);
  assert.deepEqual(loadState(home), s);
});

test('loadState: corrupt file is backed up and replaced', () => {
  const home = tmp();
  writeFileSync(join(home, 'state.json'), '{oops');
  assert.deepEqual(loadState(home), { version: 1, items: {} });
  assert.ok(readdirSync(home).some((f) => f.startsWith('state.json.corrupt-')));
});

test('dataHome honors KICKSTARTER_HOME', () => {
  assert.equal(dataHome({ KICKSTARTER_HOME: '/x/y', HOME: '/h' }), '/x/y');
  assert.equal(dataHome({ HOME: '/h' }), '/h/.config/kickstarter');
});

import { recordOptOuts } from '../src/state.js';

test('recordOptOuts: missing items left unticked are remembered, ticked ones cleared', () => {
  const s = { version: 1, items: { bruno: { optedOut: '2026-01-01T00:00:00.000Z' }, git: { status: 'done', lastRun: 'x' } } };
  recordOptOuts(s, { missing: ['bruno', 'teamviewer', 'warp'], picked: ['bruno', 'warp'], now: new Date('2026-11-20T10:00:00Z') });
  assert.equal(s.items.bruno.optedOut, undefined);
  assert.equal(s.items.warp?.optedOut, undefined);
  assert.equal(s.items.teamviewer.optedOut, '2026-11-20T10:00:00.000Z');
  assert.deepEqual(s.items.git, { status: 'done', lastRun: 'x' });
});

test('optedOutIds lists remembered opt-outs', async () => {
  const { optedOutIds } = await import('../src/state.js');
  assert.deepEqual([...optedOutIds({ version: 1, items: { a: { optedOut: 'x' }, b: {} } })], ['a']);
});
