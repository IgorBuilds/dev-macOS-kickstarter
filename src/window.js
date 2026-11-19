import { mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

/** Single-quote for zsh. */
export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** Escape for an AppleScript string literal. */
const asq = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** zsh script a spawned Terminal window runs: banner, install (+after), tee to log, exit code to file. */
export function buildWindowScript(item, { logPath, exitPath }) {
  const steps = [`  {\n${item.install ?? 'true'}\n  }`];
  if (item.after) steps.push(`  {\n${item.after}\n  }`);
  return `#!/bin/zsh
set -o pipefail
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" 2>/dev/null
B=$'\\e[1m'; G=$'\\e[32m'; R=$'\\e[31m'; C=$'\\e[36m'; D=$'\\e[2m'; X=$'\\e[0m'
clear
print -r -- "\${C}\${B}🚀 macOS Kickstarter — ${item.emoji} ${item.name.replace(/["$`\\]/g, '\\$&')}\${X}"
${item.note ? `print -r -- "\${D}${item.note.replace(/["$`\\]/g, '\\$&')}\${X}"` : ''}
print ''
print -r -- "=== window: ${item.id} ===" >> ${shq(logPath)}
{
${steps.join(' &&\n')}
} 2>&1 | tee -a ${shq(logPath)}
code=$?
print -r -- "$code" > ${shq(exitPath + '.tmp')} && mv ${shq(exitPath + '.tmp')} ${shq(exitPath)}
print ''
if [ "$code" = 0 ]; then
  print -r -- "\${G}\${B}✅ Done — you can close this window.\${X}"
else
  print -r -- "\${R}\${B}❌ Failed (exit $code) — go back to the main window.\${X}"
fi
`;
}

const realOsascript = (script) =>
  new Promise((resolve, reject) => execFile('osascript', ['-e', script], (e) => (e ? reject(e) : resolve())));

/** Write <runDir>/windows/<id>.sh and ask Terminal.app to run it in a new window. */
export async function spawnWindow(item, { runDir, logPath, osascript = realOsascript, attempt = 1 }) {
  const dir = join(runDir, 'windows');
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, `${item.id}-${attempt}.sh`);
  const exitPath = join(dir, `${item.id}-${attempt}.exit`); // per attempt: a retry never reads a stale result
  rmSync(exitPath, { force: true });
  writeFileSync(scriptPath, buildWindowScript(item, { logPath, exitPath }));
  chmodSync(scriptPath, 0o755);
  await osascript(`tell application "Terminal"
  do script "/bin/zsh ${asq(shq(scriptPath))}"
  activate
end tell`);
  return { exitPath };
}

/** Poll for the exit file. Resolves the exit code, or 'abandoned' when signal aborts. */
export function waitForExit(exitPath, { pollMs = 500, signal } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { clearInterval(timer); signal?.removeEventListener('abort', onAbort); resolve(v); };
    const onAbort = () => done('abandoned');
    const tick = () => {
      if (existsSync(exitPath)) {
        const n = Number(readFileSync(exitPath, 'utf8').trim());
        done(Number.isFinite(n) ? n : 1);
      }
    };
    const timer = setInterval(tick, pollMs);
    if (signal?.aborted) return done('abandoned');
    signal?.addEventListener('abort', onAbort);
    tick();
  });
}
