#!/usr/bin/env node
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import realPrompts from 'prompts';
import pc from 'picocolors';
import { loadConfig, ConfigError } from './config.js';
import { orderForRun, missingDeps } from './order.js';
import { runShell as realRunShell } from './shell.js';
import { brewEnv } from './env.js';
import { dataHome, loadState, saveState, recordOptOuts, optedOutIds } from './state.js';
import { createRun, diskFreeKb as realDiskFreeKb, sizeKb, systemInfo as realSystemInfo } from './telemetry.js';
import { detectItem, detectAll as realDetectAll } from './detect.js';
import { applyBuiltin, builtinCheck } from './managed-block.js';
import { spawnWindow, waitForExit } from './window.js';
import { runLinksItem } from './links.js';
import { runItems } from './runner.js';
import { pickItems } from './picker.js';
import { renderReport } from './report.js';
import { header, consoleUi, STATUS, RULE } from './ui.js';
import { ask, Cancelled } from './cancel.js';
import { appStoreReminder } from './appstore.js';
import { notifyDone } from './notify.js';
import { confirmPlan } from './confirm.js';
import { offerOpenApps as realOfferOpenApps, openableItems } from './openapps.js';

const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const HELP = `
${pc.bold('🚀 macOS Kickstarter')}

Usage: ./bootstrap.sh [options]      (or: node src/cli.js [options])

  --dry-run           Check + pick + show the exact commands. Changes nothing.
  --only a,b          Skip the picker; set up just these item ids.
  --list              Show every item and whether it's installed, then exit.
  --open              Open apps the kickstarter installed (one by one or all at once) to set them up.
  --report [name]     Print the last run's report (or a specific run folder name).
  -h, --help          This help.
`;

export function parseArgs(argv) {
  const o = { dryRun: false, only: null, list: false, report: null, help: false, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--list') o.list = true;
    else if (a === '--open') o.open = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--only') o.only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--report') o.report = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : 'last';
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

const LIST_MARK = {
  installed: pc.green('✔'), missing: pc.red('✗'), unknown: pc.dim('?'), confirmed: '👤',
};

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const prompts = deps.prompts ?? realPrompts;
  const ui = deps.ui ?? consoleUi;
  const systemInfo = deps.systemInfo ?? realSystemInfo;
  const detectAll = deps.detectAll ?? realDetectAll;
  const repoDir = deps.repoDir ?? REPO_DIR;
  const home = dataHome(env);
  const userHome = env.HOME || homedir();
  const exit = deps.exit ?? ((c) => process.exit(c));
  const diskFreeKb = deps.diskFreeKb ?? realDiskFreeKb;
  const notify = deps.notify ?? notifyDone;
  const runShell = deps.runShell ?? realRunShell;
  const offerOpenApps = deps.offerOpenApps ?? realOfferOpenApps;

  let args;
  try { args = parseArgs(argv); } catch (e) { ui.print(pc.red(`❌ ${e.message}`)); ui.print(HELP); return 2; }
  if (args.help) { ui.print(HELP); return 0; }

  if (args.report) {
    const runsDir = join(home, 'runs');
    const names = existsSync(runsDir) ? readdirSync(runsDir).filter((n) => existsSync(join(runsDir, n, 'report.md'))).sort() : [];
    const name = args.report === 'last' ? names.at(-1) : names.find((n) => n === args.report);
    if (!name) { ui.print(pc.red('❌ No saved report found.')); return 1; }
    ui.print(readFileSync(join(runsDir, name, 'report.md'), 'utf8'));
    return 0;
  }

  const sys = await systemInfo();
  ui.print(header(sys));

  let config;
  try { config = loadConfig(join(repoDir, 'items.yaml')); } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    ui.print(pc.red(`❌ items.yaml has problems:`));
    for (const p of e.problems) ui.print(pc.red(`   • ${p}`));
    return 2;
  }
  if (args.only) {
    const unknown = args.only.filter((id) => !config.items.some((i) => i.id === id));
    if (unknown.length) { ui.print(pc.red(`❌ Unknown item id(s): ${unknown.join(', ')}`)); return 2; }
  }

  const state = loadState(home, { readOnly: args.dryRun || args.list || args.open });
  if (args.open) {
    const installed = config.items.filter((i) => i.app?.length && state.items[i.id]?.status === 'done');
    if (!installed.length) { ui.print('\n🤷 No apps installed by the kickstarter yet.'); return 0; }
    try { await offerOpenApps(installed, { prompts, ui }); } catch (e) { if (!(e instanceof Cancelled)) throw e; }
    return 0;
  }
  let runEnv = brewEnv({ ...env });
  const detectDeps = {
    state, env: runEnv,
    builtinCheck: (item) => builtinCheck(item.builtin, { home: userHome, repoDir }),
  };
  const spin = ui.spinner('🔍 Checking what’s already here…');
  const statuses = await detectAll(config.items, detectDeps);
  spin.stop();

  if (args.list) {
    for (const sec of config.sections) {
      ui.print(`\n${pc.bold(sec.title)}`);
      const items = config.items.filter((i) => i.section === sec.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      for (const i of items) {
        const st = statuses.get(i.id);
        ui.print(`  ${LIST_MARK[st.state]} ${i.emoji} ${i.name}${st.via === 'app' ? pc.dim('  (found in /Applications)') : ''}`);
      }
    }
    ui.print(`\n${pc.dim(`${LIST_MARK.installed} installed   ${LIST_MARK.missing} missing   ${LIST_MARK.unknown} can’t check   👤 you confirmed`)}`);
    return 0;
  }

  const startedAt = deps.now ?? new Date();
  const diskStartKb = await diskFreeKb();
  const run = createRun({
    home, dryRun: args.dryRun, now: startedAt,
    info: {
      tool_version: env.KICKSTARTER_VERSION || 'local', node_version: process.version,
      system: sys, flags: argv, disk_free_start: diskStartKb,
    },
  });
  for (const [id, st] of statuses) run.event('detect', { id, result: st.state, via: st.via ?? null });

  const results = [];
  let ordered = [];
  let finalizing = null;

  // Memoised: Ctrl+C during cleanup (or a second Ctrl+C) gets the same promise, never a crash.
  // Deferred start so `finalizing` is set before any work (and any re-entrant SIGINT) happens.
  const finalize = (interrupted) => (finalizing ??= Promise.resolve().then(() => doFinalize(interrupted)));
  const doFinalize = async (interrupted) => {
    const doneIds = new Set(results.map((r) => r.id));
    for (const item of ordered) {
      if (!doneIds.has(item.id)) results.push({ id: item.id, name: item.name, emoji: item.emoji, section: item.section, status: 'skipped', durationMs: 0, attempts: 0, note: 'interrupted' });
    }
    const picked = new Set(ordered.map((i) => i.id));
    for (const item of config.items) {
      const st = statuses.get(item.id);
      if (!picked.has(item.id) && (st.state === 'installed' || st.state === 'confirmed')) {
        results.push({ id: item.id, name: item.name, emoji: item.emoji, section: item.section, status: 'already', durationMs: 0, attempts: 0 });
      }
    }
    const endedAt = new Date();
    {
      const diskEndKb = await diskFreeKb();
      const rep = renderReport(results, { dryRun: args.dryRun, runDir: run.dir, sys, startedAt, endedAt, diskStartKb, diskEndKb });
      ui.print(rep.terminal);
      run.writeReport(rep.markdown);
      const failed = results.filter((r) => r.status === 'failed').length;
      if (!args.dryRun) await notify({ counts: { done: results.filter((r) => r.status === 'done').length, failed }, interrupted });
      run.event('run_end', {
        interrupted, duration_ms: endedAt - startedAt, disk_free_end: diskEndKb,
        counts: Object.fromEntries(Object.keys(STATUS).map((s) => [s, results.filter((r) => r.status === s).length])),
      });
      return interrupted ? 130 : failed ? 1 : 0;
    }
  };

  let onSigint;
  if (deps.installSignalHandlers !== false) {
    onSigint = () => { ui.print(pc.yellow('\n\n🛑 Interrupted — writing the report…')); finalize(true).then((c) => exit(c)); };
    process.on('SIGINT', onSigint);
  }

  try {
    let picked;
    let preselected = null;
    const missingIds = config.items.filter((i) => statuses.get(i.id)?.state === 'missing').map((i) => i.id);
    const nameOf = (id) => config.items.find((i) => i.id === id)?.name ?? id;
    for (;;) {
      picked = args.only
        ? new Set(args.only)
        : new Set(await pickItems(config, statuses, { prompts, print: ui.print, optedOut: optedOutIds(state), preselected }));
      if (!picked.size) break;
      const isInstalled = (id) => statuses.get(id)?.state === 'installed';
      const missing = missingDeps(config.items, picked, isInstalled);
      if (missing.length) {
        const all = [...new Set(missing.flatMap((m) => m.missing))];
        ui.print(pc.yellow(`\n⚠️  Some picks need things that aren’t installed or picked:`));
        for (const m of missing) ui.print(pc.yellow(`   • ${nameOf(m.id)} → ${m.missing.map(nameOf).join(', ')}`));
        const add = await ask(prompts, { type: 'confirm', message: `Add ${all.map(nameOf).join(', ')} to this run?`, initial: true });
        run.event('prompt', { question: 'add_missing_deps', answer: add, ids: all });
        if (add) all.forEach((id) => picked.add(id));
      }
      ordered = orderForRun(config.items, picked);
      if (args.dryRun) break;
      const go = await confirmPlan(ordered, { config, prompts, ui, allowBack: !args.only });
      run.event('prompt', { question: 'confirm_plan', answer: go });
      if (go === 'start') break;
      if (go === 'cancel') {
        ordered = [];
        ui.print('\n👋 Cancelled — nothing was installed.');
        return await finalize(false);
      }
      preselected = picked; // 'back': reopen the picker with these picks kept
    }
    if (!args.only && !args.dryRun) {
      recordOptOuts(state, { missing: missingIds, picked: [...picked] });
      saveState(home, state);
    }
    if (!picked.size) { ui.print('\n👋 Nothing picked.'); return await finalize(false); }
    run.event('picked', { ids: [...picked] });
    const kept = await appStoreReminder(ordered, { dryRun: args.dryRun, prompts, ui });
    for (const item of ordered.filter((i) => !kept.includes(i))) {
      results.push({ id: item.id, name: item.name, emoji: item.emoji, section: item.section, status: 'skipped', durationMs: 0, attempts: 0, note: 'App Store skipped' });
      run.event('end', { id: item.id, status: 'skipped', reason: 'app_store_skipped' });
    }
    ordered = kept;
    ui.print(`\n${RULE}\n${pc.bold(args.dryRun ? '📝 Dry run — nothing will change' : `▶️  Running ${ordered.length} item(s)`)}`);

    await runItems(ordered, {
      results, env: runEnv, run, state, home: userHome, repoDir, dryRun: args.dryRun, prompts, ui,
      runShell, spawnWindow, waitForExit, applyBuiltin, runLinksItem, detectItem: (item, d) => detectItem(item, { ...detectDeps, ...d }),
      diskFreeKb, sizeKb,
      saveState: (s) => saveState(home, s),
      brewEnv,
    });
    const code = await finalize(false);
    if (!args.dryRun) await offerOpenApps(openableItems(config.items, results), { prompts, ui });
    return code;
  } catch (e) {
    if (e instanceof Cancelled) { ui.print(pc.yellow('\n🛑 Cancelled.')); return await finalize(true); }
    run.event('crash', { message: e.message, stack: e.stack });
    ui.print(pc.red(`\n💥 ${e.message}`));
    await finalize(true);
    return 1;
  } finally {
    if (onSigint) process.off('SIGINT', onSigint);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
