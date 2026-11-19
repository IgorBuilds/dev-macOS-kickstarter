import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spinner } from '../src/ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('fix I6: spinner frames fit the terminal width and never cut an escape code', async () => {
  const writes = [];
  const out = { isTTY: true, columns: 80, write: (s) => writes.push(s) };
  const sp = spinner('🪟 Waiting for the Homebrew window…  (press a to abandon)', out);
  sp.update('==> Downloading https://ghcr.io/v2/homebrew/core/some/very/long/path/that/keeps/going/and/going');
  await sleep(120);
  sp.stop();
  const frames = writes.filter((w) => w.includes('Waiting'));
  assert.ok(frames.some((w) => w.includes('Downloading')), 'sub text was drawn');
  for (const w of frames) {
    const visible = w.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
    assert.ok([...visible].length <= 79, `too wide (${[...visible].length}): ${visible}`);
    assert.doesNotMatch(w.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''), /\x1b/, 'dangling escape');
  }
});
