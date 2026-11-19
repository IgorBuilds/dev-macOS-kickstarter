import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, symlinkSync, lstatSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { START, END, readBlock, upsertBlock, findConflicts, applyBuiltin, builtinCheck } from '../src/managed-block.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ks-mb-'));
const repoWith = (zshrc = 'BODY', zprofile = 'PROFILE') => {
  const repo = tmp();
  mkdirSync(join(repo, 'files'));
  writeFileSync(join(repo, 'files', 'zshrc-block.zsh'), zshrc + '\n');
  writeFileSync(join(repo, 'files', 'zprofile-block.zsh'), zprofile + '\n');
  return repo;
};

test('empty text gets just the block', () => {
  assert.equal(upsertBlock('', 'body'), `${START}\nbody\n${END}\n`);
});

test('existing user lines preserved above an appended block', () => {
  const out = upsertBlock('export A=1\nalias x=y', 'body');
  assert.equal(out, `export A=1\nalias x=y\n\n${START}\nbody\n${END}\n`);
});

test('existing block replaced, outside untouched', () => {
  const before = `top\n${START}\nold\n${END}\nbottom\n`;
  assert.equal(upsertBlock(before, 'new'), `top\n${START}\nnew\n${END}\nbottom\n`);
});

test('upsert is idempotent', () => {
  const once = upsertBlock('export A=1\n', 'body');
  assert.equal(upsertBlock(once, 'body'), once);
});

test('readBlock round-trips', () => {
  assert.equal(readBlock(upsertBlock('x\n', 'a\nb')), 'a\nb');
  assert.equal(readBlock('nothing'), null);
});

test('findConflicts flags oh-my-zsh outside block with 1-based line, ignores inside', () => {
  const text = `export ZSH=x\nsource $ZSH/oh-my-zsh.sh\n${START}\nsource $ZSH/oh-my-zsh.sh\n${END}\n`;
  const c = findConflicts(text);
  assert.equal(c.length, 1);
  assert.equal(c[0].line, 2);
  assert.equal(c[0].reason, 'Oh My Zsh');
});

test('findConflicts flags spaceship, nvm, starship', () => {
  const reasons = findConflicts('ZSH_THEME="spaceship"\nexport NVM_DIR=x\neval "$(starship init zsh)"\n').map((c) => c.reason);
  assert.deepEqual(reasons, ['Spaceship prompt', 'NVM loaded twice', 'Starship init twice']);
});

test('applyBuiltin writes block, backs up only an existing changed file', () => {
  const home = tmp(), repo = repoWith();
  writeFileSync(join(home, '.zshrc'), 'export A=1\n');
  const r = applyBuiltin('zshrc', { home, repoDir: repo, dryRun: false });
  assert.equal(r.changed, true);
  assert.ok(r.backup && readdirSync(home).some((f) => f.startsWith('.zshrc.bak-')));
  assert.equal(readBlock(readFileSync(join(home, '.zshrc'), 'utf8')), 'BODY');
  const r2 = applyBuiltin('zshrc', { home, repoDir: repo, dryRun: false });
  assert.equal(r2.changed, false);
  assert.equal(r2.backup, null);
  assert.equal(readdirSync(home).filter((f) => f.startsWith('.zshrc.bak-')).length, 1);
});

test('applyBuiltin on missing file creates it without backup', () => {
  const home = tmp(), repo = repoWith();
  const r = applyBuiltin('zprofile', { home, repoDir: repo, dryRun: false });
  assert.equal(r.backup, null);
  assert.equal(readBlock(readFileSync(join(home, '.zprofile'), 'utf8')), 'PROFILE');
});

test('applyBuiltin dry-run reports change but leaves file untouched', () => {
  const home = tmp(), repo = repoWith();
  writeFileSync(join(home, '.zshrc'), 'export A=1\n');
  const r = applyBuiltin('zshrc', { home, repoDir: repo, dryRun: true });
  assert.equal(r.changed, true);
  assert.equal(readFileSync(join(home, '.zshrc'), 'utf8'), 'export A=1\n');
});

test('applyBuiltin returns conflicts', () => {
  const home = tmp(), repo = repoWith();
  writeFileSync(join(home, '.zshrc'), 'source $ZSH/oh-my-zsh.sh\n');
  assert.equal(applyBuiltin('zshrc', { home, repoDir: repo, dryRun: true }).conflicts[0].reason, 'Oh My Zsh');
});

test('builtinCheck true only after apply', () => {
  const home = tmp(), repo = repoWith();
  assert.equal(builtinCheck('zshrc', { home, repoDir: repo }), false);
  applyBuiltin('zshrc', { home, repoDir: repo, dryRun: false });
  assert.equal(builtinCheck('zshrc', { home, repoDir: repo }), true);
});

test('symlinked .zshrc: writes target, keeps link', () => {
  const home = tmp(), repo = repoWith(), dot = tmp();
  writeFileSync(join(dot, 'zshrc'), 'export A=1\n');
  symlinkSync(join(dot, 'zshrc'), join(home, '.zshrc'));
  applyBuiltin('zshrc', { home, repoDir: repo, dryRun: false });
  assert.ok(lstatSync(join(home, '.zshrc')).isSymbolicLink());
  assert.equal(readBlock(readFileSync(join(dot, 'zshrc'), 'utf8')), 'BODY');
});

test('fix I7: broken markers → refuse to edit', () => {
  assert.throws(() => upsertBlock(`a\n${START}\nb\n`, 'x'), /markers/);
  assert.throws(() => upsertBlock(`${START}\n1\n${END}\n${START}\n2\n${END}\n`, 'x'), /markers/);
  assert.throws(() => upsertBlock(`${END}\n${START}\n`, 'x'), /markers/);
});

test('fix I7: applyBuiltin leaves a file with broken markers untouched', () => {
  const home = tmp(), repo = repoWith();
  const original = `alias ll='ls -l'\n${START}\nold\nexport IMPORTANT=1\n`;
  writeFileSync(join(home, '.zshrc'), original);
  assert.throws(() => applyBuiltin('zshrc', { home, repoDir: repo, dryRun: false }), /markers/);
  assert.equal(readFileSync(join(home, '.zshrc'), 'utf8'), original);
});
