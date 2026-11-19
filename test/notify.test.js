import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyDone } from '../src/notify.js';

const rec = () => { const calls = []; return { calls, exec: async (cmd, args) => { calls.push([cmd, ...args]); } }; };

test('success → notification with Hero sound + loud afplay', async () => {
  const r = rec();
  await notifyDone({ counts: { done: 5, failed: 0 }, interrupted: false }, { exec: r.exec });
  const osa = r.calls.find((c) => c[0] === 'osascript');
  assert.match(osa.join(' '), /display notification "✅ 5 done/);
  assert.match(osa.join(' '), /with title "macOS Kickstarter"/);
  assert.match(osa.join(' '), /sound name "Hero"/);
  assert.deepEqual(r.calls.find((c) => c[0] === 'afplay'), ['afplay', '/System/Library/Sounds/Hero.aiff']);
});

test('failures → Basso sound and failed count in the message', async () => {
  const r = rec();
  await notifyDone({ counts: { done: 3, failed: 2 }, interrupted: false }, { exec: r.exec });
  assert.match(r.calls.find((c) => c[0] === 'osascript').join(' '), /❌ 2 failed/);
  assert.deepEqual(r.calls.find((c) => c[0] === 'afplay'), ['afplay', '/System/Library/Sounds/Basso.aiff']);
});

test('interrupted → says so', async () => {
  const r = rec();
  await notifyDone({ counts: { done: 1, failed: 0 }, interrupted: true }, { exec: r.exec });
  assert.match(r.calls.find((c) => c[0] === 'osascript').join(' '), /Stopped early/);
});

test('notification failures never throw', async () => {
  await notifyDone({ counts: { done: 1, failed: 0 }, interrupted: false }, { exec: async () => { throw new Error('no'); } });
});
