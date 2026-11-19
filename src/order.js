/** @typedef {import('./config.js').Item} Item */

/** Returns the first dependency cycle found, e.g. ['a','b','a'], or null. */
export function findCycle(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const state = new Map(); // id -> 'visiting' | 'done'
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 'done' || !byId.has(id)) return null;
    if (state.get(id) === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const n of byId.get(id).needs) {
      const c = visit(n);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const i of items) {
    const c = visit(i.id);
    if (c) return c;
  }
  return null;
}

/** Picked items only, dependencies first; ties keep YAML order (Kahn's algorithm). */
export function orderForRun(items, picked) {
  const chosen = items.filter((i) => picked.has(i.id));
  const ids = new Set(chosen.map((i) => i.id));
  const indeg = new Map(chosen.map((i) => [i.id, i.needs.filter((n) => ids.has(n)).length]));
  const out = [];
  const done = new Set();
  while (out.length < chosen.length) {
    const next = chosen.find((i) => !done.has(i.id) && indeg.get(i.id) === 0);
    if (!next) throw new Error('dependency cycle among picked items');
    out.push(next);
    done.add(next.id);
    for (const i of chosen) if (i.needs.includes(next.id)) indeg.set(i.id, indeg.get(i.id) - 1);
  }
  return out;
}

/** For each picked item, transitive deps that are neither picked nor installed. */
export function missingDeps(items, picked, isInstalled) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const result = [];
  for (const item of items) {
    if (!picked.has(item.id)) continue;
    const missing = [];
    const seen = new Set();
    const walk = (id) => {
      for (const n of byId.get(id)?.needs ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!picked.has(n) && !isInstalled(n)) missing.push(n);
        walk(n);
      }
    };
    walk(item.id);
    if (missing.length) result.push({ id: item.id, missing });
  }
  return result;
}
