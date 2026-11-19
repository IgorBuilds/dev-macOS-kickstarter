import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildWindowScript, spawnWindow, waitForExit } from '../src/window.js';
import { expandItem } from '../src/config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ks-win-'));
const item = (extra = {}) => expandItem({ id: 'nvm', name: 'NVM', section: 'dev', install: 'echo INSTALL', after: 'echo AFTER', ...extra });

test('script runs install then after, tees to log, writes exit code, uses pipefail', () => {
  const s = buildWindowScript(item(), { logPath: '/l/output.log', exitPath: '/l/nvm.exit' });
  assert.ok(s.startsWith('#!/bin/zsh'));
  assert.match(s, /pipefail/);
  assert.ok(s.indexOf('echo INSTALL') < s.indexOf('echo AFTER'));
  assert.match(s, /tee -a '\/l\/output.log'/);
  assert.match(s, /'\/l\/nvm.exit'/);
});

test('no after → no empty block', () => {
  const s = buildWindowScript(item({ after: undefined }), { logPath: '/l', exitPath: '/e' });
  assert.doesNotMatch(s, /\{\s*\}/);
});

test('executed script writes the install exit code', () => {
  const d = tmp();
  const exitPath = join(d, 'x.exit'), logPath = join(d, 'out.log'), sp = join(d, 's.sh');
  writeFileSync(sp, buildWindowScript(item({ install: 'echo boom; exit 4', after: 'echo NEVER' }), { logPath, exitPath }));
  execFileSync('/bin/zsh', [sp], { stdio: 'ignore' });
  assert.equal(readFileSync(exitPath, 'utf8').trim(), '4');
  assert.match(readFileSync(logPath, 'utf8'), /boom/);
  assert.doesNotMatch(readFileSync(logPath, 'utf8'), /NEVER/);
});

test('executed script success writes 0', () => {
  const d = tmp();
  const exitPath = join(d, 'x.exit'), sp = join(d, 's.sh');
  writeFileSync(sp, buildWindowScript(item(), { logPath: join(d, 'l'), exitPath }));
  execFileSync('/bin/zsh', [sp], { stdio: 'ignore' });
  assert.equal(readFileSync(exitPath, 'utf8').trim(), '0');
});

test('spawnWindow writes executable script and tells Terminal to run it, escaping the path', async () => {
  const runDir = join(tmp(), 'my "run" dir');
  let applescript;
  const { exitPath } = await spawnWindow(item(), { runDir, logPath: join(runDir, 'out.log'), osascript: async (s) => { applescript = s; } });
  const scriptPath = join(runDir, 'windows', 'nvm-1.sh');
  assert.ok(existsSync(scriptPath));
  assert.ok(statSync(scriptPath).mode & 0o100);
  assert.match(applescript, /tell application "Terminal"/);
  assert.match(applescript, /do script/);
  assert.ok(applescript.includes('my \\"run\\" dir'));
  assert.equal(exitPath, join(runDir, 'windows', 'nvm-1.exit'));
});

test('waitForExit resolves the code once the file appears', async () => {
  const p = join(tmp(), 'a.exit');
  setTimeout(() => writeFileSync(p, '0\n'), 100);
  assert.equal(await waitForExit(p, { pollMs: 20 }), 0);
});

test("waitForExit resolves 'abandoned' on abort", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  assert.equal(await waitForExit(join(tmp(), 'never.exit'), { pollMs: 20, signal: ac.signal }), 'abandoned');
});

test('fix C1: each attempt gets its own exit file, stale file removed', async () => {
  const runDir = tmp();
  const noop = async () => {};
  const a1 = await spawnWindow(item(), { runDir, logPath: join(runDir, 'l'), osascript: noop, attempt: 1 });
  writeFileSync(a1.exitPath, '1\n');
  const a2 = await spawnWindow(item(), { runDir, logPath: join(runDir, 'l'), osascript: noop, attempt: 2 });
  assert.notEqual(a1.exitPath, a2.exitPath);
  assert.ok(!existsSync(a2.exitPath));
});
