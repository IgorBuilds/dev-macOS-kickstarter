import { spawnSync as realSpawnSync } from 'node:child_process';

/**
 * Ask for the admin password once (`sudo -v`, sudo handles the password — we never see it),
 * then refresh the timestamp every 60 s until stop().
 */
export function startSudoKeepAlive({ spawnSync = realSpawnSync, setInterval: si = setInterval, clearInterval: ci = clearInterval } = {}) {
  const r = spawnSync('sudo', ['-v'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('sudo authentication failed');
  const timer = si(() => spawnSync('sudo', ['-n', '-v'], { stdio: 'ignore' }), 60_000);
  timer.unref?.();
  return { stop: () => ci(timer) };
}
