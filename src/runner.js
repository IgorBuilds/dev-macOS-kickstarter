import pc from 'picocolors';
import { ask } from './cancel.js';

/**
 * @typedef {{id:string, name:string, section:string, emoji:string,
 *   status:'done'|'confirmed'|'already'|'planned'|'failed'|'skipped',
 *   exitCode?:number|null, durationMs:number, attempts:number, diskDeltaKb?:number|null, sizeKb?:number|null,
 *   version?:string|null, tail?:string[], commands?:string[], note?:string}} Result
 */

const BUILTIN_FILE = { zshrc: '~/.zshrc', zprofile: '~/.zprofile' };

/** Human-readable list of what an item would do (dry-run + logs). */
export function describe(item) {
  if (item.kind === 'links') return item.links.map((l) => `open ${l.url}`);
  if (item.kind === 'builtin') return [`update kickstarter block in ${BUILTIN_FILE[item.builtin]}`];
  const cmds = [item.install, item.after].filter(Boolean);
  return item.window ? [`🪟 in a new Terminal window: ${cmds.join(' && ')}`] : cmds;
}

const FAIL_CHOICES = [
  { title: '🔁 Retry', value: 'retry' },
  { title: '⏭️ Skip', value: 'skip' },
  { title: '🛑 Stop', value: 'stop' },
];

/**
 * Run picked items in order. Every side effect comes from ctx (see test/runner.test.js for the shape).
 * @returns {Promise<Result[]>}
 */
export async function runItems(ordered, ctx) {
  const results = ctx.results ?? []; // shared with the CLI so Ctrl+C can still report finished items
  let stopped = false;
  const total = ordered.length;

  for (const [idx, item] of ordered.entries()) {
    const base = { id: item.id, name: item.name, section: item.section, emoji: item.emoji };
    if (stopped) {
      results.push({ ...base, status: 'skipped', durationMs: 0, attempts: 0, note: 'run stopped' });
      continue;
    }
    ctx.ui.print(`\n${pc.bold(`[${idx + 1}/${total}]`)} ${item.emoji} ${pc.bold(item.name)}`);
    const blocker = !ctx.dryRun && item.needs
      .map((n) => results.find((r) => r.id === n))
      .find((r) => r && (r.status === 'failed' || r.status === 'skipped'));
    if (blocker) {
      const note = `needs ${blocker.name} (${blocker.status})`;
      ctx.ui.print(pc.yellow(`   🙈 Skipped — ${note}`));
      ctx.run.event('end', { id: item.id, status: 'skipped', reason: note });
      results.push({ ...base, status: 'skipped', durationMs: 0, attempts: 0, note });
      continue;
    }
    if (item.note) ctx.ui.print(pc.dim(`   ${item.note}`));
    ctx.run.event('start', { id: item.id, attempt: 1 });
    const t0 = Date.now();

    if (ctx.dryRun) {
      let commands = describe(item);
      if (item.kind === 'builtin') {
        const r = ctx.applyBuiltin(item.builtin, { home: ctx.home, repoDir: ctx.repoDir, dryRun: true });
        if (!r.changed) commands = ['(already up to date)'];
        commands.push(...r.conflicts.map((c) => `⚠️ line ${c.line}: ${c.reason} — ${c.text}`));
      }
      if (item.kind === 'links') {
        const r = await ctx.runLinksItem(item, { state: ctx.state, prompts: ctx.prompts, dryRun: true });
        commands = r.opened.map((u) => `open ${u}`);
      }
      for (const c of commands) ctx.ui.print(pc.dim(`   📝 ${c}`));
      const res = { ...base, status: 'planned', durationMs: 0, attempts: 0, commands };
      ctx.run.event('end', { id: item.id, status: 'planned', commands });
      results.push(res);
      continue;
    }

    if (item.window) {
      const go = await ask(ctx.prompts, {
        type: 'select',
        message: '⏸  Needs you: opens a new Terminal window. Continue?',
        choices: [
          { title: '▶️  Continue', value: 'continue' },
          { title: '⏭️  Skip this one', value: 'skip' },
          { title: '🛑 Stop the run', value: 'stop' },
        ],
      });
      ctx.run.event('prompt', { id: item.id, question: 'window_pause', answer: go });
      if (go !== 'continue') {
        if (go === 'stop') stopped = true;
        results.push({ ...base, status: 'skipped', durationMs: Date.now() - t0, attempts: 0 });
        ctx.run.event('end', { id: item.id, status: 'skipped' });
        continue;
      }
    }

    const diskBefore = await ctx.diskFreeKb();
    let attempts = 0, status = null, exitCode = null, tail = [], extra = {};
    while (!status) {
      attempts++;
      let out;
      try {
        out = await attempt(item, ctx, idx, total, attempts);
      } catch (e) {
        out = { ok: false, exitCode: null, tail: [String(e.message ?? e)] };
        ctx.run.event('error', { id: item.id, message: String(e.message ?? e), attempt: attempts });
      }
      exitCode = out.exitCode; tail = out.tail ?? []; extra = out.extra ?? {};
      let ok = out.ok;
      if (out.final) { status = out.final; break; }
      if (ok && (item.check || item.kind === 'builtin')) {
        const st = await ctx.detectItem(item, { state: ctx.state, env: ctx.env });
        ctx.run.event('check_after', { id: item.id, result: st.state });
        if (st.state !== 'installed') { ok = false; tail = [...tail, '(command succeeded but the check still fails)']; }
      }
      if (ok) { status = 'done'; break; }
      ctx.ui.print(pc.red(`   ❌ Failed${exitCode != null ? ` (exit ${exitCode})` : ''}`));
      for (const l of tail.slice(-5)) ctx.ui.print(pc.dim(`      ${l}`));
      const choice = await ask(ctx.prompts, { type: 'select', message: 'What now?', choices: FAIL_CHOICES });
      ctx.run.event('prompt', { id: item.id, question: 'failure', answer: choice, attempt: attempts });
      if (choice === 'retry') continue;
      status = 'failed';
      if (choice === 'stop') stopped = true;
    }

    const diskAfter = await ctx.diskFreeKb();
    const res = { ...base, status, exitCode, attempts, durationMs: Date.now() - t0, diskDeltaKb: diskAfter - diskBefore, ...extra };
    if (status === 'done') {
      if (item.sizePath) res.sizeKb = await ctx.sizeKb(item.sizePath, ctx.env);
      if (item.versionCmd) {
        const v = await ctx.runShell(item.versionCmd, { env: ctx.env, timeoutMs: 15_000 });
        res.version = v.code === 0 ? (v.tail.at(-1) ?? null) : null;
      }
      ctx.ui.print(pc.green(`   ✅ Done`) + pc.dim(` · ${Math.round(res.durationMs / 1000)}s`));
    } else if (status === 'failed') {
      res.tail = tail;
    }
    ctx.run.event('end', {
      id: item.id, status, exit_code: exitCode, attempt: attempts, duration_ms: res.durationMs,
      disk_free_before: diskBefore, disk_free_after: diskAfter, disk_delta: res.diskDeltaKb,
      bundle_size: res.sizeKb ?? null, version_installed: res.version ?? null,
      ...(status === 'failed' ? { stderr_tail: tail } : {}),
      ...(extra.opened ? { links_opened: extra.opened, links_confirmed: extra.confirmed } : {}),
    });
    const prev = ctx.state.items[item.id] ?? {};
    ctx.state.items[item.id] = {
      ...prev, status, lastRun: new Date().toISOString(),
      ...(res.version !== undefined ? { version: res.version } : {}),
      ...(res.sizeKb !== undefined ? { sizeKb: res.sizeKb } : {}),
    };
    ctx.saveState(ctx.state);
    ctx.env = ctx.brewEnv(ctx.env);
    results.push(res);
  }
  return results;
}

/** One attempt. Returns ok/exitCode/tail, or `final` for items whose status is decided directly. */
async function attempt(item, ctx, idx, total, attemptNo) {
  if (item.kind === 'links') {
    const r = await ctx.runLinksItem(item, { state: ctx.state, prompts: ctx.prompts, dryRun: false });
    return { final: r.status, extra: { opened: r.opened, confirmed: r.confirmed } };
  }
  if (item.kind === 'builtin') {
    const r = ctx.applyBuiltin(item.builtin, { home: ctx.home, repoDir: ctx.repoDir, dryRun: false });
    if (r.backup) ctx.ui.print(pc.dim(`   💾 Backup: ${r.backup}`));
    for (const c of r.conflicts) ctx.ui.print(pc.yellow(`   ⚠️  line ${c.line}: ${c.reason} — ${c.text}`));
    return { ok: true, exitCode: 0 };
  }
  ctx.run.log(`\n=== [${idx + 1}/${total}] ${item.id} ===\n`);
  if (item.window) {
    const { exitPath } = await ctx.spawnWindow(item, { runDir: ctx.run.dir, logPath: ctx.run.logPath, attempt: attemptNo });
    ctx.run.event('window_spawned', { id: item.id });
    const ac = new AbortController();
    const spin = ctx.ui.spinner(`🪟 Waiting for the ${item.name} window…  ${pc.dim('(press a to abandon)')}`);
    const dispose = ctx.ui.onKey('a', () => ac.abort());
    const code = await ctx.waitForExit(exitPath, { signal: ac.signal });
    dispose();
    spin.stop();
    if (code === 'abandoned') return { ok: false, exitCode: null, tail: ['(window abandoned)'] };
    return { ok: code === 0, exitCode: code, tail: [] };
  }
  const spin = ctx.ui.spinner(`Running…`);
  let last = { code: 0, tail: [] };
  for (const cmd of [item.install, item.after].filter(Boolean)) {
    ctx.run.log(`$ ${cmd}\n`);
    last = await ctx.runShell(cmd, { env: ctx.env, onChunk: (s) => { ctx.run.log(s); spin.update(lastLine(s)); } });
    if (last.code !== 0) break;
  }
  spin.stop();
  return { ok: last.code === 0, exitCode: last.code, tail: last.tail };
}

const lastLine = (s) => s.trim().split('\n').at(-1)?.slice(0, 70) ?? '';
