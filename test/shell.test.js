import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShell } from '../src/shell.js';

test('runShell returns exit code and tail', async () => {
  const r = await runShell('echo hi; exit 3');
  assert.equal(r.code, 3);
  assert.deepEqual(r.tail, ['hi']);
  assert.equal(r.timedOut, false);
});

test('tail keeps the last 20 lines', async () => {
  const r = await runShell('for i in $(seq 1 30); do echo line$i; done');
  assert.equal(r.tail.length, 20);
  assert.equal(r.tail.at(-1), 'line30');
  assert.equal(r.tail[0], 'line11');
});

test('stderr is merged and onChunk receives output', async () => {
  let seen = '';
  const r = await runShell('echo out; echo err >&2', { onChunk: (s) => { seen += s; } });
  assert.match(seen, /out/);
  assert.match(seen, /err/);
  assert.ok(r.tail.includes('err'));
});

test('env is passed through', async () => {
  const r = await runShell('echo $KS_TEST', { env: { ...process.env, KS_TEST: 'yes' } });
  assert.deepEqual(r.tail, ['yes']);
});

test('timeout kills the command', async () => {
  const r = await runShell('sleep 5', { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.notEqual(r.code, 0);
});

test('fix I5: timeout also stops grandchildren holding the pipe', async () => {
  const t0 = Date.now();
  const r = await runShell('sleep 3 | cat', { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
});
