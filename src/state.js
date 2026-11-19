import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @typedef {{version:1, items:Record<string,{status:string, lastRun:string, version?:string|null,
 *   sizeKb?:number|null, links?:Record<string,{confirmedAt:string}>}>}} State
 */

export function dataHome(env = process.env) {
  return env.KICKSTARTER_HOME || join(env.HOME || homedir(), '.config', 'kickstarter');
}

const empty = () => ({ version: 1, items: {} });

/** Missing → empty. Corrupt → renamed to state.json.corrupt-<ts>, then empty. */
export function loadState(home, { readOnly = false } = {}) {
  const p = join(home, 'state.json');
  if (!existsSync(p)) return empty();
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'));
    if (s && typeof s === 'object' && s.items && typeof s.items === 'object') return { version: 1, items: s.items };
    throw new Error('bad shape');
  } catch {
    if (!readOnly) renameSync(p, `${p}.corrupt-${Date.now()}`);
    return empty();
  }
}

/** Atomic write (tmp + rename). */
export function saveState(home, state) {
  mkdirSync(home, { recursive: true });
  const p = join(home, 'state.json');
  writeFileSync(`${p}.tmp`, JSON.stringify(state, null, 2) + '\n');
  renameSync(`${p}.tmp`, p);
}
