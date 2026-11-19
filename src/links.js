import { execFile } from 'node:child_process';
import { ask } from './cancel.js';

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Multiselect choices for an item's links, A–Z. Confirmed ones are labelled 👤 and unticked. */
export function linkChoices(item, state) {
  const confirmed = state.items[item.id]?.links ?? {};
  return [...item.links].sort(byName).map((l) => ({
    title: confirmed[l.url] ? `👤 ${l.name}  (you confirmed)` : l.name,
    value: l.url,
    description: l.url,
    selected: false,
  }));
}

export const openUrl = (url, browser) =>
  new Promise((resolve, reject) =>
    execFile('open', browser ? ['-a', browser, url] : [url], (e) => (e ? reject(e) : resolve())));

/**
 * Pick links → open them → ask which were installed → remember confirmations in state.
 * @returns {Promise<{status:'confirmed'|'skipped'|'planned', opened:string[], confirmed:string[]}>}
 */
export async function runLinksItem(item, { state, prompts, open = openUrl, dryRun, now = new Date() }) {
  const known = state.items[item.id]?.links ?? {};
  if (dryRun) {
    const opened = [...item.links].sort(byName).filter((l) => !known[l.url]).map((l) => l.url);
    return { status: 'planned', opened, confirmed: [] };
  }
  const opened = (await ask(prompts, {
    type: 'multiselect',
    message: `Which ${item.name} do you want to open?`,
    choices: linkChoices(item, state),
    hint: 'space = toggle · a = all · enter = open',
    instructions: false,
  })) ?? [];
  if (!opened.length) return { status: 'skipped', opened: [], confirmed: [] };
  for (const url of opened) await open(url, item.browser);
  const nameOf = new Map(item.links.map((l) => [l.url, l.name]));
  const confirmed = (await ask(prompts, {
    type: 'multiselect',
    message: 'Which did you install?',
    choices: opened.map((url) => ({ title: nameOf.get(url), value: url, selected: true })),
    hint: 'space = toggle · enter = done',
    instructions: false,
  })) ?? [];
  if (confirmed.length) {
    const entry = (state.items[item.id] ??= { status: 'confirmed', lastRun: now.toISOString() });
    entry.links ??= {};
    for (const url of confirmed) entry.links[url] = { confirmedAt: now.toISOString() };
  }
  return { status: confirmed.length ? 'confirmed' : 'skipped', opened, confirmed };
}
