import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stamp } from './telemetry.js';

export const START = '# >>> kickstarter >>>';
export const END = '# <<< kickstarter <<<';

const FILES = {
  zshrc: { dotfile: '.zshrc', body: 'zshrc-block.zsh' },
  zprofile: { dotfile: '.zprofile', body: 'zprofile-block.zsh' },
};

const count = (text, m) => text.split(m).length - 1;

/** Location of the block, null if absent. Throws when markers are broken (so we never eat user lines). */
const span = (text) => {
  const starts = count(text, START), ends = count(text, END);
  if (!starts && !ends) return null;
  const s = text.indexOf(START), e = text.indexOf(END);
  if (starts !== 1 || ends !== 1 || e < s) {
    throw new Error(`kickstarter markers look broken (${starts} start / ${ends} end) — fix them by hand, nothing was changed`);
  }
  return { s, e: e + END.length };
};

/** Body between markers (trimmed of the newline after START / before END), or null. */
export function readBlock(text) {
  let sp;
  try { sp = span(text); } catch { return null; }
  return sp ? text.slice(sp.s + START.length, sp.e - END.length).replace(/^\n/, '').replace(/\n$/, '') : null;
}

/** Replace the block in place, or append it at the bottom with one blank line before. */
export function upsertBlock(text, body) {
  const block = `${START}\n${body.replace(/\n+$/, '')}\n${END}`;
  const sp = span(text);
  if (sp) return text.slice(0, sp.s) + block + text.slice(sp.e);
  const trimmed = text.replace(/\n+$/, '');
  return (trimmed ? `${trimmed}\n\n` : '') + block + '\n';
}

const PATTERNS = [
  [/oh-my-zsh\.sh/, 'Oh My Zsh'],
  [/spaceship/i, 'Spaceship prompt'],
  [/nvm\.sh|NVM_DIR=/, 'NVM loaded twice'],
  [/starship init/, 'Starship init twice'],
];

/** Lines outside the managed block that clash with it. Line numbers are 1-based. */
export function findConflicts(text) {
  let sp;
  try { sp = span(text); } catch { sp = null; }
  const out = [];
  let offset = 0;
  text.split('\n').forEach((line, i) => {
    const inside = sp && offset >= sp.s && offset < sp.e;
    offset += line.length + 1;
    if (inside || /^\s*#/.test(line)) return;
    const hit = PATTERNS.find(([re]) => re.test(line));
    if (hit) out.push({ line: i + 1, text: line.trim(), reason: hit[1] });
  });
  return out;
}

const paths = (kind, home, repoDir) => {
  const f = FILES[kind];
  if (!f) throw new Error(`unknown builtin "${kind}"`);
  return { file: join(home, f.dotfile), body: readFileSync(join(repoDir, 'files', f.body), 'utf8') };
};

/**
 * Write/refresh the managed block. Backs up an existing file (once per change) before writing.
 * Writes through symlinks. Dry-run computes the result but writes nothing.
 */
export function applyBuiltin(kind, { home, repoDir, dryRun, now = new Date() }) {
  const { file, body } = paths(kind, home, repoDir);
  const existed = existsSync(file);
  const before = existed ? readFileSync(file, 'utf8') : '';
  const after = upsertBlock(before, body);
  const conflicts = findConflicts(after);
  const changed = after !== before;
  let backup = null;
  if (changed && !dryRun) {
    if (existed) {
      backup = `${file}.bak-${stamp(now)}`;
      writeFileSync(backup, before);
    }
    writeFileSync(file, after);
  }
  return { changed, backup, conflicts };
}

/** True when the dotfile's block matches the repo body exactly. */
export function builtinCheck(kind, { home, repoDir }) {
  const { file, body } = paths(kind, home, repoDir);
  if (!existsSync(file)) return false;
  return readBlock(readFileSync(file, 'utf8')) === body.replace(/\n+$/, '');
}
