import { existsSync } from 'node:fs';
import { runShell as realRunShell } from './shell.js';

/** @typedef {{state:'installed'|'missing'|'unknown'|'confirmed', via?:'check'|'app'|'state'}} Status */

/**
 * @param {import('./config.js').Item} item
 * @param {{state:any, env:object, runShell?:Function, exists?:(p:string)=>boolean, timeoutMs?:number,
 *   builtinCheck?:(item:any)=>boolean}} deps
 * @returns {Promise<Status>}
 */
export async function detectItem(item, deps) {
  const { state, env, runShell = realRunShell, exists = existsSync, timeoutMs = 10_000, builtinCheck } = deps;
  if (item.kind === 'links') {
    const confirmed = state.items[item.id]?.links ?? {};
    return item.links.every((l) => confirmed[l.url]) ? { state: 'confirmed', via: 'state' } : { state: 'unknown' };
  }
  if (item.kind === 'builtin' && builtinCheck) {
    return builtinCheck(item) ? { state: 'installed', via: 'check' } : { state: 'missing' };
  }
  if (item.check) {
    const r = await runShell(item.check, { env, timeoutMs });
    if (r.code === 0 && !r.timedOut) return { state: 'installed', via: 'check' };
  }
  if (item.app?.some((a) => exists(`/Applications/${a}`))) return { state: 'installed', via: 'app' };
  return item.check ? { state: 'missing' } : { state: 'unknown' };
}

/** @returns {Promise<Map<string, Status>>} */
export async function detectAll(items, deps) {
  const results = await Promise.all(items.map((i) => detectItem(i, deps)));
  return new Map(items.map((i, n) => [i.id, results[n]]));
}
