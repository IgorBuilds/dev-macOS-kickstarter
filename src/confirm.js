import pc from 'picocolors';
import { ask } from './cancel.js';

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Last look before anything is installed: picks grouped by section (A–Z), then
 * ▶️ Start / ↩️ Go back and change / 🛑 Cancel. Returns 'start' | 'back' | 'cancel'.
 */
export async function confirmPlan(ordered, { config, prompts, ui, allowBack = true }) {
  const windows = ordered.filter((i) => i.window).length;
  ui.print('');
  ui.print(pc.bold(`📋 Ready to set up ${ordered.length} item${ordered.length === 1 ? '' : 's'}:`));
  for (const sec of config.sections) {
    const items = ordered.filter((i) => i.section === sec.id).sort(byName);
    if (!items.length) continue;
    ui.print('');
    ui.print(`   ${pc.bold(sec.title)}`);
    for (const i of items) ui.print(`     ${i.emoji} ${i.name}${i.window ? `  ${pc.dim('🪟')}` : ''}`);
  }
  ui.print('');
  if (windows) ui.print(pc.dim(`   🪟 = opens a new Terminal window (${windows})`));
  ui.print(pc.dim('   Runs in dependency order.'));
  ui.print('');
  const choices = [{ title: '▶️  Start', value: 'start' }];
  if (allowBack) choices.push({ title: '↩️  Go back and change', value: 'back' });
  choices.push({ title: '🛑 Cancel', value: 'cancel' });
  return ask(prompts, { type: 'select', message: 'Look good?', choices });
}
