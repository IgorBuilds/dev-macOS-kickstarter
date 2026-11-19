import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (e) => (e ? rej(e) : res())));
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * macOS notification + a sound you can hear from across the room when the run ends.
 * Hero = all good, Basso = something failed. Never throws.
 */
export async function notifyDone({ counts, interrupted }, { exec = run } = {}) {
  const failed = counts.failed ?? 0;
  const sound = failed ? 'Basso' : 'Hero';
  const parts = [`✅ ${counts.done ?? 0} done`];
  if (failed) parts.push(`❌ ${failed} failed`);
  const title = 'macOS Kickstarter';
  const subtitle = interrupted ? 'Stopped early' : failed ? 'Finished — needs a look' : 'All set 🎉';
  const script = `display notification "${esc(parts.join(' · '))}" with title "${title}" subtitle "${esc(subtitle)}" sound name "${sound}"`;
  await Promise.allSettled([
    exec('osascript', ['-e', script]),
    exec('afplay', [`/System/Library/Sounds/${sound}.aiff`]),
  ]);
}
