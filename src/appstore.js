import pc from 'picocolors';
import { execFile } from 'node:child_process';
import { ask } from './cancel.js';

const openApp = (app) => new Promise((res, rej) => execFile('open', ['-a', app], (e) => (e ? rej(e) : res())));

/**
 * Friendly reminder before App Store (mas) installs: mas can't sign in for you.
 * Returns the items to run (App Store ones dropped if the user chooses to skip them).
 */
export async function appStoreReminder(ordered, { dryRun, prompts, ui, open = openApp }) {
  const store = ordered.filter((i) => i.appStore);
  if (!store.length) return ordered;
  const names = store.map((i) => i.name).join(', ');
  ui.print('');
  ui.print(pc.cyan(`🛍️  Friendly reminder: sign in to the App Store first`) + pc.dim(` — needed for ${names}.`));
  ui.print(pc.dim(`   mas can't sign in for you. Open the App Store app → Sign In (bottom-left).`));
  if (dryRun) return ordered;
  for (;;) {
    const answer = await ask(prompts, {
      type: 'select',
      message: 'Are you signed in to the App Store?',
      choices: [
        { title: '✅ Yes, I’m signed in — continue', value: 'ok' },
        { title: '🛍️  Open the App Store for me', value: 'open' },
        { title: `⏭️  Skip App Store apps this run`, value: 'skip' },
      ],
    });
    if (answer === 'ok') return ordered;
    if (answer === 'skip') return ordered.filter((i) => !i.appStore);
    await open('App Store').catch(() => ui.print(pc.yellow('   ⚠️  Couldn’t open the App Store — open it from Launchpad.')));
    ui.print(pc.dim('   Sign in there, then come back here.'));
  }
}
