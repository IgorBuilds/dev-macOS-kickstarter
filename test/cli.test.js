import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';
import { parseArgs, main } from '../src/cli.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ks-cli-'));
const silentUi = { print: () => {}, spinner: () => ({ update() {}, stop() {} }), onKey: () => () => {} };
const deps = (home, over = {}) => {
  const out = [];
  return {
    out,
    env: { ...process.env, KICKSTARTER_HOME: home, HOME: home },
    prompts,
    ui: { ...silentUi, print: (s) => out.push(s) },
    systemInfo: async () => ({ model: 'Test', chip: 'M', ramGb: 8, macos: '27.0', build: 'X', arch: 'arm64' }),
    detectAll: async (items) => new Map(items.map((i) => [i.id, { state: 'missing' }])),
    installSignalHandlers: false,
    ...over,
  };
};

test('parseArgs handles flags', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--only', 'git,nvm']), { dryRun: true, only: ['git', 'nvm'], list: false, report: null, help: false });
  assert.equal(parseArgs(['--report']).report, 'last');
  assert.equal(parseArgs(['--report', '2026-11-18_143205']).report, '2026-11-18_143205');
  assert.equal(parseArgs(['--list']).list, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
});

test('--only with unknown id exits 2', async () => {
  assert.equal(await main(['--only', 'ghost'], deps(tmp())), 2);
});

test('--dry-run --only git: exit 0, -dry run folder, no state.json', async () => {
  const home = tmp();
  prompts.inject([true]); // add missing dep homebrew
  const code = await main(['--dry-run', '--only', 'git'], deps(home));
  assert.equal(code, 0);
  const runs = readdirSync(join(home, 'runs'));
  assert.equal(runs.length, 1);
  assert.match(runs[0], /-dry$/);
  assert.ok(!existsSync(join(home, 'state.json')));
  const md = readFileSync(join(home, 'runs', runs[0], 'report.md'), 'utf8');
  assert.match(md, /Dry-run report/);
  assert.match(md, /brew install git/);
  const events = readFileSync(join(home, 'runs', runs[0], 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(events[0].type, 'run_start');
  assert.equal(events[0].tool_version, 'local');
  assert.equal(events.at(-1).type, 'run_end');
});

test('installed items appear as already in the report', async () => {
  const home = tmp();
  const d = deps(home, { detectAll: async (items) => new Map(items.map((i) => [i.id, { state: i.id === 'git' ? 'missing' : 'installed', via: 'check' }])) });
  await main(['--dry-run', '--only', 'git'], d);
  const run = readdirSync(join(home, 'runs'))[0];
  assert.match(readFileSync(join(home, 'runs', run, 'report.md'), 'utf8'), /⏭️ already/);
});

test('--report last prints newest report; none → 1', async () => {
  const home = tmp();
  assert.equal(await main(['--report'], deps(home)), 1);
  for (const [n, body] of [['2026-01-01_000000', 'OLD'], ['2026-02-01_000000', 'NEW']]) {
    mkdirSync(join(home, 'runs', n), { recursive: true });
    writeFileSync(join(home, 'runs', n, 'report.md'), body);
  }
  const d = deps(home);
  assert.equal(await main(['--report'], d), 0);
  assert.ok(d.out.join('\n').includes('NEW'));
});

test('--list prints sections and does not create a run', async () => {
  const home = tmp();
  const d = deps(home);
  assert.equal(await main(['--list'], d), 0);
  assert.ok(d.out.join('\n').includes('Homebrew'));
  assert.ok(!existsSync(join(home, 'runs')));
});

test('fix M10: dry-run never renames a corrupt state.json', async () => {
  const home = tmp();
  writeFileSync(join(home, 'state.json'), '{oops');
  await main(['--dry-run', '--only', 'keyboard-navigation'], deps(home));
  assert.equal(readFileSync(join(home, 'state.json'), 'utf8'), '{oops');
  assert.ok(!readdirSync(home).some((f) => f.includes('corrupt')));
});

test('fix C2: Ctrl+C while the report is being written does not crash; report still written', async () => {
  const home = tmp();
  let diskCalls = 0;
  let exitCode = null;
  const d = deps(home, {
    installSignalHandlers: true,
    exit: (c) => { exitCode = c; },
    diskFreeKb: async () => { if (++diskCalls === 2) process.emit('SIGINT'); return 1000; },
  });
  const code = await main(['--dry-run', '--only', 'keyboard-navigation'], d);
  await new Promise((r) => setTimeout(r, 50));
  const run = readdirSync(join(home, 'runs'))[0];
  assert.ok(existsSync(join(home, 'runs', run, 'report.md')));
  assert.equal(code, 0);
  assert.equal(exitCode, 0);
});

test('dry-run never sends the finish notification', async () => {
  const home = tmp();
  let notified = 0;
  await main(['--dry-run', '--only', 'keyboard-navigation'], deps(home, { notify: async () => { notified++; } }));
  assert.equal(notified, 0);
});

test('opt-outs from the picker are saved, and not in dry-run', async () => {
  const { recordOptOuts } = await import('../src/state.js');
  assert.equal(typeof recordOptOuts, 'function');
  const home = tmp();
  const d = deps(home, { detectAll: async (items) => new Map(items.map((i) => [i.id, { state: i.id === 'bruno' ? 'missing' : 'installed', via: 'check' }])) });
  prompts.inject([[]]); // apps section: untick bruno (only section with something to pick)
  await main(['--dry-run'], d);
  assert.ok(!existsSync(join(home, 'state.json')), 'dry-run must not save opt-outs');
});

test('real run: unticked missing items are remembered and start unticked next time', async () => {
  const home = tmp();
  const detect = async (items) => new Map(items.map((i) => [i.id, { state: i.id === 'bruno' ? 'missing' : 'installed', via: 'check' }]));
  prompts.inject([[]]); // untick bruno → nothing picked → nothing installs
  await main([], deps(home, { detectAll: detect, notify: async () => {} }));
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'));
  assert.ok(state.items.bruno.optedOut);

  const asked = [];
  const spy = async (q, o) => { asked.push(q); return prompts(q, o); };
  prompts.inject([[]]);
  await main([], deps(home, { detectAll: detect, prompts: spy, notify: async () => {} }));
  const bruno = asked[0].choices.find((c) => c.value === 'bruno');
  assert.equal(bruno.selected, false);
});

test('confirm step: go back reopens the picker with your picks kept; cancel installs nothing', async () => {
  const home = tmp();
  const detect = async (items) => new Map(items.map((i) => [i.id, { state: i.id === 'bruno' ? 'missing' : 'installed', via: 'check' }]));
  const asked = [];
  const spy = async (q, o) => { asked.push(q); return prompts(q, o); };
  let ran = 0;
  prompts.inject([['bruno'], 'back', ['bruno'], 'cancel']);
  const code = await main([], deps(home, { detectAll: detect, prompts: spy, notify: async () => {}, runShell: async () => { ran++; return { code: 0, tail: [], timedOut: false }; } }));
  assert.equal(code, 0);
  assert.equal(ran, 0);
  const pickers = asked.filter((q) => q.type === 'multiselect');
  assert.equal(pickers.length, 2);
  assert.equal(pickers[1].choices.find((c) => c.value === 'bruno').selected, true);
});
