import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runShell } from './shell.js';

const pad = (n) => String(n).padStart(2, '0');
export const stamp = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/**
 * @typedef {{dir:string, logPath:string, event(type:string, data?:object):void, log(text:string):void,
 *   writeReport(md:string):void}} Run
 * @returns {Run}
 */
export function createRun({ home, dryRun, now = new Date(), info = {} }) {
  const dir = join(home, 'runs', stamp(now) + (dryRun ? '-dry' : ''));
  mkdirSync(dir, { recursive: true });
  const eventsPath = join(dir, 'events.jsonl');
  const logPath = join(dir, 'output.log');
  writeFileSync(logPath, '');
  const event = (type, data = {}) =>
    appendFileSync(eventsPath, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n');
  event('run_start', { dry_run: dryRun, ...info });
  return {
    dir,
    logPath,
    event,
    log: (text) => appendFileSync(logPath, text),
    writeReport: (md) => writeFileSync(join(dir, 'report.md'), md),
  };
}

const sh = async (cmd, env) => (await runShell(cmd, { env, timeoutMs: 120_000 })).tail.join('\n').trim();

/** Free KB on / (df "Available" column). Approximate: APFS snapshots/purgeable space add noise. */
export async function diskFreeKb() {
  const out = await sh('df -k / | tail -1');
  return Number(out.split(/\s+/)[3]) || 0;
}

/** du -sk of a path (zsh expands $(…), e.g. $(brew --prefix git)). null when missing. */
export async function sizeKb(path, env = process.env) {
  const r = await runShell(`p="${path.replace(/"/g, '\\"')}"; [ -e "$p" ] && du -sk "$p" | cut -f1`, { env, timeoutMs: 120_000 });
  const n = Number(r.tail.at(-1));
  return r.code === 0 && Number.isFinite(n) ? n : null;
}

export async function systemInfo() {
  const [model, chip, mem, macos, build, arch] = await Promise.all([
    sh('sysctl -n hw.model'),
    sh('sysctl -n machdep.cpu.brand_string'),
    sh('sysctl -n hw.memsize'),
    sh('sw_vers -productVersion'),
    sh('sw_vers -buildVersion'),
    sh('uname -m'),
  ]);
  return { model, chip, ramGb: Math.round(Number(mem) / 1024 ** 3), macos, build, arch };
}
