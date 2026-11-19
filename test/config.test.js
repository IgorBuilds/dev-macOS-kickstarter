import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandItem, parseConfig, ConfigError } from '../src/config.js';

test('brew shorthand expands', () => {
  const i = expandItem({ id: 'git', name: 'git', section: 'dev', brew: 'git' });
  assert.equal(i.kind, 'shell');
  assert.equal(i.check, 'brew list --formula git >/dev/null 2>&1');
  assert.equal(i.install, 'brew install git');
  assert.equal(i.versionCmd, 'brew list --versions git');
  assert.equal(i.sizePath, '$(brew --prefix git)');
  assert.deepEqual(i.needs, ['homebrew']);
});

test('brew_cask + brew_tap + app expand', () => {
  const i = expandItem({ id: 'orca', name: 'Orca', section: 'apps', brew_tap: 'stablyai/orca', brew_cask: 'stablyai/orca/orca', app: 'Orca.app' });
  assert.equal(i.check, 'brew list --cask stablyai/orca/orca >/dev/null 2>&1');
  assert.equal(i.install, 'brew tap stablyai/orca && { brew trust --cask stablyai/orca/orca 2>/dev/null || true; } && brew install --cask stablyai/orca/orca');
  assert.equal(i.sizePath, '/Applications/Orca.app');
  assert.equal(i.versionCmd, 'brew list --cask --versions stablyai/orca/orca');
  assert.deepEqual(i.needs, ['homebrew']);
});

test('mas shorthand expands and implies sudo + needs mas', () => {
  const i = expandItem({ id: 'xcode', name: 'Xcode', section: 'apps', mas: 497799835, app: 'Xcode.app' });
  assert.equal(i.check, 'mas list | grep -q "^497799835 "');
  assert.equal(i.install, 'mas install 497799835');
  assert.equal(i.sudo, true);
  assert.equal(i.versionCmd, 'mas list | grep "^497799835 "');
  assert.equal(i.sizePath, '/Applications/Xcode.app');
  assert.deepEqual(i.needs, ['mas']);
});

test('explicit needs merge with implied ones, deduped', () => {
  const i = expandItem({ id: 'a', name: 'A', section: 'apps', brew_cask: 'a', needs: ['x', 'homebrew'] });
  assert.deepEqual(i.needs.sort(), ['homebrew', 'x']);
});

test('explicit check/install override shorthand', () => {
  const i = expandItem({ id: 'a', name: 'A', section: 'dev', brew: 'a', check: 'true', install: 'echo hi' });
  assert.equal(i.check, 'true');
  assert.equal(i.install, 'echo hi');
});

test('links item', () => {
  const i = expandItem({ id: 'x', name: 'X', section: 'links', browser: 'Google Chrome', links: [{ name: 'A', url: 'https://a' }] });
  assert.equal(i.kind, 'links');
  assert.equal(i.check, null);
  assert.equal(i.browser, 'Google Chrome');
});

test('builtin item', () => {
  assert.equal(expandItem({ id: 'zshrc', name: '.zshrc', section: 'dev', builtin: 'zshrc' }).kind, 'builtin');
});

test('defaults', () => {
  const i = expandItem({ id: 'a', name: 'A', section: 'dev', install: 'true' });
  assert.equal(i.emoji, '📦');
  assert.equal(i.window, false);
  assert.equal(i.sudo, false);
  assert.deepEqual(i.needs, []);
  assert.equal(i.note, null);
});

test('parseConfig returns sections and items', () => {
  const c = parseConfig(`sections: [{id: dev, title: Dev}]\nitems:\n  - {id: git, name: git, section: dev, brew: git}\n  - {id: homebrew, name: Homebrew, section: dev, install: x}`);
  assert.equal(c.sections[0].id, 'dev');
  assert.equal(c.items.length, 2);
});

test('reports all problems at once', () => {
  const yaml = `sections: [{id: dev, title: Dev}]
items:
  - {id: a, name: A, section: nope, install: x}
  - {id: a, name: B, section: dev}
  - {id: c, name: C, section: dev, install: x, needs: [ghost]}
  - {id: Bad_Id, name: D, section: dev, install: x}`;
  let err;
  assert.throws(() => { try { parseConfig(yaml); } catch (e) { err = e; throw e; } }, ConfigError);
  const all = err.problems.join('\n');
  assert.match(all, /unknown section "nope"/);
  assert.match(all, /duplicate id "a"/);
  assert.match(all, /"B".*nothing to do/);
  assert.match(all, /unknown need "ghost"/);
  assert.match(all, /invalid id "Bad_Id"/);
});

test('invalid YAML becomes ConfigError', () => {
  assert.throws(() => parseConfig('items: [unclosed'), ConfigError);
});

test('app accepts a list of alternative bundle names', () => {
  const i = expandItem({ id: 'alfred', name: 'Alfred', section: 'apps', brew_cask: 'alfred', app: ['Alfred 6.app', 'Alfred 5.app'] });
  assert.deepEqual(i.app, ['Alfred 6.app', 'Alfred 5.app']);
  assert.equal(i.sizePath, '/Applications/Alfred 6.app');
  assert.deepEqual(expandItem({ id: 'a', name: 'A', section: 'apps', brew_cask: 'a', app: 'A.app' }).app, ['A.app']);
});

test('brew_tap + brew_cask also trusts just that cask (Homebrew 7 refuses untrusted taps)', () => {
  const i = expandItem({ id: 'orca', name: 'Orca', section: 'apps', brew_tap: 'stablyai/orca', brew_cask: 'stablyai/orca/orca' });
  assert.equal(i.install, 'brew tap stablyai/orca && { brew trust --cask stablyai/orca/orca 2>/dev/null || true; } && brew install --cask stablyai/orca/orca');
});

test('brew_tap + brew formula trusts just that formula', () => {
  const i = expandItem({ id: 'x', name: 'X', section: 'dev', brew_tap: 'a/b', brew: 'a/b/x' });
  assert.equal(i.install, 'brew tap a/b && { brew trust --formula a/b/x 2>/dev/null || true; } && brew install a/b/x');
});

test('sudo items run in their own window by default', () => {
  assert.equal(expandItem({ id: 'tv', name: 'TV', section: 'apps', brew_cask: 'teamviewer', sudo: true }).window, true);
  assert.equal(expandItem({ id: 'm', name: 'M', section: 'apps', mas: 1 }).window, true);
  assert.equal(expandItem({ id: 'n', name: 'N', section: 'apps', mas: 1, window: false }).window, false);
});
