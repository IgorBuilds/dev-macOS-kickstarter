import pc from 'picocolors';
import { ask } from './cancel.js';

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Vertical multiselect choices: section header, items A–Z, blank spacer between sections.
 * Header values start with "§", spacers with "·" (both disabled).
 */
export function buildChoices(config, statuses, optedOut = new Set(), preselected = null) {
  const out = [];
  config.sections.forEach((sec, n) => {
    const items = config.items.filter((i) => i.section === sec.id).sort(byName);
    if (!items.length) return;
    if (out.length) out.push({ title: ' ', value: `·${n}`, disabled: true });
    out.push({ title: pc.bold(sec.title), value: `§${sec.id}`, disabled: true });
    for (const item of items) {
      const st = statuses.get(item.id) ?? { state: 'unknown' };
      const warn = item.window ? pc.dim('  🪟 opens window') : '';
      const base = { value: item.id, description: item.note ?? undefined };
      if (st.state === 'installed') {
        out.push({ ...base, disabled: true, selected: false,
          title: `${pc.green('✔')} ${item.name}  ${pc.dim(`already installed${st.via === 'app' ? ' (found in /Applications)' : ''}`)}` });
      } else if (st.state === 'confirmed') {
        out.push({ ...base, selected: false, title: `👤 ${item.name}  ${pc.dim('you confirmed')}${warn}` });
      } else {
        const skipped = optedOut.has(item.id);
        out.push({ ...base, selected: preselected ? preselected.has(item.id) : st.state === 'missing' && !skipped,
          title: `${item.emoji} ${item.name}${st.state === 'unknown' ? pc.dim('  (can’t check)') : ''}${skipped ? pc.dim('  (skipped last time)') : ''}${warn}` });
      }
    }
  });
  return out;
}

/**
 * Show one vertical multiselect per section (A–Z, blank line between sections).
 * Sections where everything is already installed are printed, not asked. Returns picked ids.
 */
export async function pickItems(config, statuses, { prompts, print = (t) => console.log(t), optedOut = new Set(), preselected = null }) {
  const picked = [];
  for (const sec of config.sections) {
    const choices = buildChoices({ sections: [sec], items: config.items }, statuses, optedOut, preselected).slice(1); // drop header row
    if (!choices.length) continue;
    print('');
    const cursor = choices.findIndex((c) => !c.disabled);
    if (cursor === -1) {
      print(pc.bold(sec.title));
      for (const c of choices) print(`  ${c.title}`);
      continue;
    }
    const ids = await ask(prompts, {
      type: 'multiselect',
      message: pc.bold(sec.title),
      choices,
      cursor,
      hint: 'space = toggle · a = all · enter = next',
      instructions: false,
      optionsPerPage: Math.max(10, (process.stdout.rows || 30) - 6),
      warn: '✔ already installed — nothing to do',
    });
    picked.push(...(ids ?? []));
  }
  return picked;
}
