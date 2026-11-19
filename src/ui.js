import pc from 'picocolors';
import readline from 'node:readline';

export const STATUS = { done: '✅', confirmed: '👤', already: '⏭️', planned: '📝', failed: '❌', skipped: '🙈' };
export const RULE = pc.dim('─'.repeat(64));

export function header(sys) {
  const right = pc.dim(`${sys.model} · macOS ${sys.macos} · ${sys.arch}`);
  return `\n${pc.bold(pc.cyan('🚀 macOS Kickstarter'))}   ${right}\n${RULE}`;
}

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const fit = (s, n) => { const a = [...s]; return a.length <= n ? s : a.slice(0, Math.max(0, n - 1)).join('') + '…'; };

/** Hand-written spinner. No-op (plain lines) when stdout isn't a TTY. */
export function spinner(text, out = process.stdout) {
  if (!out.isTTY) {
    out.write(`   ${text}\n`);
    return { update() {}, stop(line) { if (line) out.write(`${line}\n`); } };
  }
  let i = 0, sub = '';
  const draw = () => {
    // Fit plain text to the width BEFORE colouring, so a line never wraps (a wrapped line can't be
    // cleared with \r and would leave one line per frame) and an escape code is never cut.
    const room = (out.columns || 80) - 1;
    const head = fit(`   X ${text}`, room);
    const tailRoom = room - [...head].length - 2;
    const tail = sub && tailRoom > 3 ? fit(sub, tailRoom) : '';
    const frame = pc.cyan(FRAMES[i++ % FRAMES.length]);
    out.write(`\r\x1b[2K${head.replace('X', frame)}${tail ? pc.dim(`  ${tail}`) : ''}`);
  };
  draw();
  const timer = setInterval(draw, 80);
  return {
    update(t) { sub = t; },
    stop(line) { clearInterval(timer); out.write('\r\x1b[2K'); if (line) out.write(`${line}\n`); },
  };
}

/** Listen for a single key on a TTY stdin; returns dispose(). Ctrl+C still interrupts. */
export function onKey(key, fn, input = process.stdin) {
  if (!input.isTTY) return () => {};
  readline.emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  const handler = (_s, k) => {
    if (k?.ctrl && k.name === 'c') process.kill(process.pid, 'SIGINT');
    else if (k?.name === key) fn();
  };
  input.on('keypress', handler);
  return () => {
    input.off('keypress', handler);
    input.setRawMode(wasRaw);
    input.pause();
  };
}

export const consoleUi = { print: (s) => console.log(s), spinner, onKey };
