import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/report.js';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const r = (id, status, extra = {}) => ({ id, name: id, emoji: '📦', section: 'apps', status, durationMs: 1000, attempts: 1, ...extra });
const results = [
  r('Zed', 'done', { sizeKb: 2048, version: 'zed 1.0' }),
  r('Alpha', 'done'),
  r('Docker', 'failed', { exitCode: 1, tail: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'] }),
  r('Git', 'already'),
  r('Links', 'confirmed'),
  r('Bruno', 'skipped'),
];
const opts = { dryRun: false, runDir: '/runs/2026-11-18_143205', sys: { model: 'Mac16,10', macos: '27.0', arch: 'arm64' },
  startedAt: new Date(0), endedAt: new Date(125_000), diskStartKb: 10_000_000, diskEndKb: 7_000_000 };

test('summary counts', () => {
  const t = strip(renderReport(results, opts).terminal);
  assert.match(t, /✅ 2 done\s+👤 1 confirmed\s+⏭️ 1 already there\s+❌ 1 failed\s+🙈 1 skipped/);
});

test('groups ordered done → confirmed → already → failed → skipped, A–Z inside', () => {
  const t = strip(renderReport(results, opts).terminal);
  const pos = (s) => t.indexOf(s);
  assert.ok(pos('Alpha') < pos('Zed'));
  assert.ok(pos('Zed') < pos('Links') && pos('Links') < pos('Git') && pos('Git') < pos('Docker') && pos('Docker') < pos('Bruno'));
});

test('failed row shows exit code, log path and last 5 tail lines', () => {
  const t = strip(renderReport(results, opts).terminal);
  assert.match(t, /exit 1 · see \/runs\/2026-11-18_143205\/output\.log/);
  assert.ok(t.includes('l6') && t.includes('l2') && !t.includes('l1\n'));
});

test('footer has duration, disk used, run folder and new-terminal hint', () => {
  const t = strip(renderReport(results, opts).terminal);
  assert.match(t, /2m 5s/);
  assert.match(t, /2\.9 GB/);
  assert.match(t, /Run folder: \/runs\/2026-11-18_143205/);
  assert.match(t, /exec zsh/);
});

test('dry-run title and planned count, no zsh hint', () => {
  const t = strip(renderReport([r('A', 'planned')], { ...opts, dryRun: true }).terminal);
  assert.match(t, /📋 Dry-run report/);
  assert.match(t, /📝 1 planned/);
  assert.doesNotMatch(t, /exec zsh/);
});

test('markdown has the per-item table', () => {
  const md = renderReport(results, opts).markdown;
  assert.ok(md.includes('| Item | Status | Duration | Size | Version | Attempts |'));
  assert.match(md, /\| Zed \| ✅ done \| 1s \| 2\.0 MB \| zed 1\.0 \| 1 \|/);
  assert.ok(!/\x1b\[/.test(md));
});
