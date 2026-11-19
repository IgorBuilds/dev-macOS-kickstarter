import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, diskFreeKb, sizeKb, systemInfo } from '../src/telemetry.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ks-tel-'));
const now = new Date(2026, 10, 18, 14, 32, 5);

test('createRun names the run dir by local timestamp', () => {
  assert.match(createRun({ home: tmp(), dryRun: false, now }).dir, /runs\/2026-11-18_143205$/);
  assert.match(createRun({ home: tmp(), dryRun: true, now }).dir, /runs\/2026-11-18_143205-dry$/);
});

test('first event is run_start with dry_run, then appended events', () => {
  const run = createRun({ home: tmp(), dryRun: true, now });
  run.event('x', { a: 1 });
  const lines = readFileSync(join(run.dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].type, 'run_start');
  assert.equal(lines[0].dry_run, true);
  assert.equal(lines[1].type, 'x');
  assert.equal(lines[1].a, 1);
  assert.ok(lines[1].ts);
});

test('log appends to output.log and writeReport writes report.md', () => {
  const run = createRun({ home: tmp(), dryRun: false, now });
  run.log('hello\n');
  run.log('world\n');
  run.writeReport('# r');
  assert.equal(readFileSync(run.logPath, 'utf8'), 'hello\nworld\n');
  assert.equal(readFileSync(join(run.dir, 'report.md'), 'utf8'), '# r');
});

test('diskFreeKb is positive', async () => {
  assert.ok((await diskFreeKb()) > 0);
});

test('sizeKb measures a dir and returns null for missing', async () => {
  assert.equal(typeof (await sizeKb(tmp())), 'number');
  assert.equal(await sizeKb('/nope/nope'), null);
});

test('systemInfo reports arch and macOS version', async () => {
  const s = await systemInfo();
  assert.ok(['arm64', 'x86_64'].includes(s.arch));
  assert.match(s.macos, /^\d+/);
  assert.ok(s.ramGb > 0);
});
