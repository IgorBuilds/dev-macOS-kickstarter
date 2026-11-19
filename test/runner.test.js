import { test } from 'node:test';
import assert from 'node:assert/strict';
import prompts from 'prompts';
import { runItems } from '../src/runner.js';
import { expandItem } from '../src/config.js';

const mk = (o) => expandItem({ section: 'dev', name: o.id, ...o });

function fakeCtx(over = {}) {
  const calls = { runShell: [], spawnWindow: [], applyBuiltin: [], saveState: 0, brewEnv: 0, events: [], links: 0 };
  let disk = 1000;
  const ctx = {
    calls,
    env: { PATH: '/usr/bin' },
    run: { dir: '/run', logPath: '/run/output.log', event: (type, data) => calls.events.push({ type, ...data }), log: () => {}, writeReport: () => {} },
    state: { version: 1, items: {} },
    home: '/home', repoDir: '/repo', dryRun: false, prompts,
    ui: { print: () => {}, spinner: () => ({ update() {}, stop() {} }), onKey: () => () => {} },
    runShell: async (cmd) => { calls.runShell.push(cmd); return { code: 0, tail: ['ok'], timedOut: false }; },
    spawnWindow: async (item) => { calls.spawnWindow.push(item.id); return { exitPath: '/x' }; },
    waitForExit: async () => 0,
    applyBuiltin: (kind, o) => { calls.applyBuiltin.push(o.dryRun); return { changed: true, backup: null, conflicts: [] }; },
    runLinksItem: async () => { calls.links++; return { status: 'confirmed', opened: ['u'], confirmed: ['u'] }; },
    detectItem: async () => ({ state: 'installed', via: 'check' }),
    diskFreeKb: async () => (disk -= 100),
    sizeKb: async () => 42,
    saveState: () => { calls.saveState++; },
    brewEnv: (env) => { calls.brewEnv++; return { ...env, PATH: '/opt/homebrew/bin:' + env.PATH }; },
    ...over,
  };
  return ctx;
}

test('inline success → done, attempts 1, start+end events, disk delta', async () => {
  const ctx = fakeCtx();
  const [r] = await runItems([mk({ id: 'git', brew: 'git' })], ctx);
  assert.equal(r.status, 'done');
  assert.equal(r.attempts, 1);
  assert.equal(r.diskDeltaKb, -100);
  assert.equal(r.sizeKb, 42);
  assert.deepEqual(ctx.calls.events.map((e) => e.type), ['start', 'check_after', 'end']);
  assert.equal(ctx.calls.events[2].status, 'done');
  assert.equal(ctx.calls.events[2].bundle_size, 42);
});

test('install then after both run', async () => {
  const ctx = fakeCtx();
  await runItems([mk({ id: 'a', install: 'I', after: 'A' })], ctx);
  assert.deepEqual(ctx.calls.runShell.slice(0, 2), ['I', 'A']);
});

test('exit 0 but re-check fails → prompt; Skip → failed', async () => {
  const ctx = fakeCtx({ detectItem: async () => ({ state: 'missing' }) });
  prompts.inject(['skip']);
  const [r] = await runItems([mk({ id: 'a', install: 'I', check: 'C' })], ctx);
  assert.equal(r.status, 'failed');
});

test('fail → Retry → success → done with attempts 2', async () => {
  let n = 0;
  const ctx = fakeCtx({ runShell: async () => ({ code: n++ === 0 ? 1 : 0, tail: ['x'], timedOut: false }) });
  prompts.inject(['retry']);
  const [r] = await runItems([mk({ id: 'a', install: 'I' })], ctx);
  assert.equal(r.status, 'done');
  assert.equal(r.attempts, 2);
});

test('fail → Stop → failed, later items skipped and never run', async () => {
  const ran = [];
  const ctx = fakeCtx({ runShell: async (c) => { ran.push(c); return { code: 1, tail: ['boom'], timedOut: false }; } });
  prompts.inject(['stop']);
  const rs = await runItems([mk({ id: 'a', install: 'A' }), mk({ id: 'b', install: 'B' })], ctx);
  assert.deepEqual(rs.map((r) => r.status), ['failed', 'skipped']);
  assert.deepEqual(rs[0].tail, ['boom']);
  assert.ok(!ran.includes('B'));
});

test('window item: pause answered skip → skipped, no spawn', async () => {
  const ctx = fakeCtx();
  prompts.inject(['skip']);
  const [r] = await runItems([mk({ id: 'nvm', install: 'I', window: true })], ctx);
  assert.equal(r.status, 'skipped');
  assert.equal(ctx.calls.spawnWindow.length, 0);
});

test('window item: continue → spawn + wait → done', async () => {
  const ctx = fakeCtx();
  prompts.inject(['continue']);
  const [r] = await runItems([mk({ id: 'nvm', install: 'I', window: true })], ctx);
  assert.equal(r.status, 'done');
  assert.deepEqual(ctx.calls.spawnWindow, ['nvm']);
});

test('window item: stop at pause → this and rest skipped', async () => {
  const ctx = fakeCtx();
  prompts.inject(['stop']);
  const rs = await runItems([mk({ id: 'nvm', install: 'I', window: true }), mk({ id: 'b', install: 'B' })], ctx);
  assert.deepEqual(rs.map((r) => r.status), ['skipped', 'skipped']);
});

test("window abandoned → failure prompt", async () => {
  const ctx = fakeCtx({ waitForExit: async () => 'abandoned' });
  prompts.inject(['continue', 'skip']);
  const [r] = await runItems([mk({ id: 'nvm', install: 'I', window: true })], ctx);
  assert.equal(r.status, 'failed');
});

test('builtin applies for real, links delegate', async () => {
  const ctx = fakeCtx();
  const rs = await runItems([mk({ id: 'zshrc', builtin: 'zshrc' }), mk({ id: 'l', links: [{ name: 'A', url: 'https://a' }] })], ctx);
  assert.deepEqual(ctx.calls.applyBuiltin, [false]);
  assert.equal(ctx.calls.links, 1);
  assert.deepEqual(rs.map((r) => r.status), ['done', 'confirmed']);
});

test('state saved after each item', async () => {
  const ctx = fakeCtx();
  await runItems([mk({ id: 'a', install: 'A' }), mk({ id: 'b', install: 'B' }), mk({ id: 'c', install: 'C' })], ctx);
  assert.equal(ctx.calls.saveState, 3);
  assert.equal(ctx.state.items.a.status, 'done');
});

test('env refreshed after each item', async () => {
  const ctx = fakeCtx();
  await runItems([mk({ id: 'a', install: 'A' }), mk({ id: 'b', install: 'B' })], ctx);
  assert.equal(ctx.calls.brewEnv, 2);
  assert.ok(ctx.env.PATH.startsWith('/opt/homebrew/bin:'));
});

test('dry-run: planned, commands listed, nothing executed or saved', async () => {
  const ctx = fakeCtx({ dryRun: true });
  const rs = await runItems([
    mk({ id: 'a', install: 'A', after: 'B' }),
    mk({ id: 'w', install: 'W', window: true }),
    mk({ id: 'zshrc', builtin: 'zshrc' }),
  ], ctx);
  assert.ok(rs.every((r) => r.status === 'planned'));
  assert.deepEqual(rs[0].commands, ['A', 'B']);
  assert.match(rs[1].commands[0], /new Terminal window/);
  assert.equal(ctx.calls.runShell.length, 0);
  assert.equal(ctx.calls.spawnWindow.length, 0);
  assert.equal(ctx.calls.saveState, 0);
  assert.deepEqual(ctx.calls.applyBuiltin, [true]);
});

test('fix C1: runner passes the attempt number to spawnWindow', async () => {
  const attempts = [];
  let n = 0;
  const ctx = fakeCtx({
    spawnWindow: async (item, o) => { attempts.push(o.attempt); return { exitPath: `/x${o.attempt}` }; },
    waitForExit: async () => (n++ === 0 ? 1 : 0),
  });
  prompts.inject(['continue', 'retry']);
  await runItems([mk({ id: 'nvm', install: 'I', window: true })], ctx);
  assert.deepEqual(attempts, [1, 2]);
});

test('fix I3: a throwing side effect fails the item, not the run', async () => {
  const ctx = fakeCtx({ spawnWindow: async () => { throw new Error('Not authorized to send Apple events to Terminal'); } });
  prompts.inject(['continue', 'skip']);
  const rs = await runItems([mk({ id: 'nvm', install: 'I', window: true }), mk({ id: 'b', install: 'B' })], ctx);
  assert.equal(rs[0].status, 'failed');
  assert.match(rs[0].tail.join('\n'), /Not authorized/);
  assert.equal(rs[1].status, 'done');
});

test('fix I4: items whose picked dependency failed are skipped automatically', async () => {
  const ran = [];
  const ctx = fakeCtx({ runShell: async (c) => { ran.push(c); return { code: c === 'HB' ? 1 : 0, tail: ['x'], timedOut: false }; } });
  prompts.inject(['skip']);
  const rs = await runItems([mk({ id: 'homebrew', name: 'Homebrew', install: 'HB' }), mk({ id: 'git', install: 'GIT', needs: ['homebrew'] }), mk({ id: 'other', install: 'OTHER' })], ctx);
  assert.deepEqual(rs.map((r) => r.status), ['failed', 'skipped', 'done']);
  assert.match(rs[1].note, /needs Homebrew \(failed\)/);
  assert.ok(!ran.includes('GIT'));
});
