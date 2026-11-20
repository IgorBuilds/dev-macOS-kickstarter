import pc from 'picocolors';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { ask } from './cancel.js';

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const run = (args) => new Promise((res, rej) => execFile('open', args, (e) => (e ? rej(e) : res())));

/** Items from this run that ended ✅ done and are apps you can open. */
export function openableItems(items, results) {
  const done = new Set(results.filter((r) => r.status === 'done').map((r) => r.id));
  return items.filter((i) => i.app?.length && done.has(i.id));
}

/** Checklist rows: A–Z, setup tip inline, heavy apps unticked. */
export function openChoices(items) {
  return [...items].sort(byName).map((i) => ({
    title: `${i.emoji} ${i.name}${i.setup ? pc.dim(`  → ${i.setup}`) : ''}${i.heavy ? pc.dim('  (heavy — unticked)') : ''}`,
    value: i.id,
    selected: !i.heavy,
  }));
}

/** Path of the first bundle that exists, else the plain app name for `open -a`. */
const appTarget = (item, exists) => {
  const found = item.app.find((a) => exists(`/Applications/${a}`));
  return found ? `/Applications/${found}` : item.app[0].replace(/\.app$/, '');
};

/**
 * "🚀 Open your new apps to set them up?" → pick → one by one (guided) or all at once.
 * `open(target)` defaults to `open -a <target>`.
 */
export async function offerOpenApps(items, { prompts, ui, open = (t) => run(['-a', t]), exists = existsSync }) {
  if (!items.length) return;
  ui.print('');
  const ids = await ask(prompts, {
    type: 'multiselect',
    message: '🚀 Open your new apps to set them up?',
    choices: openChoices(items),
    hint: 'space = toggle · a = all · enter = next',
    instructions: false,
  });
  const picked = [...items].sort(byName).filter((i) => (ids ?? []).includes(i.id));
  if (!picked.length) return;

  const mode = picked.length === 1 ? 'all' : await ask(prompts, {
    type: 'select',
    message: 'How do you want to open them?',
    choices: [
      { title: '🧭 One by one — set each up, then Next', value: 'guided' },
      { title: '🚀 All at once', value: 'all' },
    ],
  });

  const openOne = async (item) => {
    try { await open(appTarget(item, exists)); } catch { ui.print(pc.yellow(`   ⚠️  Couldn’t open ${item.name} — open it from Launchpad.`)); }
  };

  if (mode === 'all') {
    for (const item of picked) await openOne(item);
    ui.print('');
    for (const item of picked) ui.print(`   ${item.emoji} ${pc.bold(item.name)}${item.setup ? pc.dim(`  → ${item.setup}`) : ''}`);
    return;
  }
  for (const [n, item] of picked.entries()) {
    ui.print('');
    ui.print(`${pc.bold(`[${n + 1}/${picked.length}]`)} ${item.emoji} ${pc.bold(item.name)}`);
    if (item.setup) ui.print(`   ${pc.cyan('→')} ${item.setup}`);
    await openOne(item);
    if (n === picked.length - 1) break;
    const next = await ask(prompts, {
      type: 'select',
      message: 'Done with this one?',
      choices: [{ title: '▶️  Next app', value: 'next' }, { title: '🛑 Stop opening apps', value: 'stop' }],
    });
    if (next === 'stop') break;
  }
}
