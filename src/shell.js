import { spawn } from 'node:child_process';

const TAIL = 20;

/**
 * Run a command with /bin/zsh -c. stdin is inherited (so sudo/brew can still reach the TTY);
 * stdout + stderr are merged, streamed to onChunk, and the last 20 lines are kept.
 * @returns {Promise<{code:number, tail:string[], timedOut:boolean}>}
 */
export function runShell(cmd, { env = process.env, onChunk, timeoutMs } = {}) {
  return new Promise((resolve) => {
    // Commands with a timeout (checks, version/size probes) run in their own process group so a
    // timeout can kill grandchildren too. Installs stay attached to the terminal (sudo/brew prompts).
    const detached = Boolean(timeoutMs);
    const child = spawn('/bin/zsh', ['-c', cmd], { env, detached, stdio: [detached ? 'ignore' : 'inherit', 'pipe', 'pipe'] });
    let buf = '';
    let timedOut = false;
    const onData = (d) => {
      const s = d.toString();
      buf += s;
      if (buf.length > 64_000) buf = buf.slice(-32_000);
      onChunk?.(s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      child.stdout.destroy();
      child.stderr.destroy();
    }, timeoutMs) : null;
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const lines = buf.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length);
      resolve({ code: code ?? (signal ? 128 + 9 : 1), tail: lines.slice(-TAIL), timedOut });
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, tail: [String(e.message)], timedOut });
    });
  });
}
