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

/**
 * Remember opt-outs from the picker: a missing item (pre-ticked) that was left unticked is
 * remembered so it starts unticked next run; anything picked clears a previous opt-out.
 */
export function recordOptOuts(state, { missing, picked, now = new Date() }) {
  const chosen = new Set(picked);
  for (const id of chosen) if (state.items[id]) delete state.items[id].optedOut;
  for (const id of missing) {
    if (chosen.has(id)) continue;
    state.items[id] = { ...(state.items[id] ?? {}), optedOut: now.toISOString() };
  }
  return state;
}

/** Ids the user opted out of in an earlier run. */
export function optedOutIds(state) {
  return new Set(Object.entries(state.items).filter(([, v]) => v?.optedOut).map(([id]) => id));
}
