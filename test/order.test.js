import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCycle, orderForRun, missingDeps } from '../src/order.js';
import { parseConfig, ConfigError } from '../src/config.js';

const it = (id, needs = []) => ({ id, name: id, needs });

test('orderForRun puts deps first even if YAML lists them later', () => {
  const items = [it('git', ['homebrew']), it('homebrew')];
  assert.deepEqual(orderForRun(items, new Set(['git', 'homebrew'])).map((i) => i.id), ['homebrew', 'git']);
});

test('orderForRun keeps YAML order for ties and only returns picked', () => {
  const items = [it('homebrew'), it('b', ['homebrew']), it('a', ['homebrew']), it('c', ['homebrew'])];
  assert.deepEqual(orderForRun(items, new Set(['homebrew', 'b', 'a'])).map((i) => i.id), ['homebrew', 'b', 'a']);
});

test('orderForRun ignores deps that are not picked', () => {
  const items = [it('homebrew'), it('git', ['homebrew'])];
  assert.deepEqual(orderForRun(items, new Set(['git'])).map((i) => i.id), ['git']);
});

test('findCycle detects a<->b', () => {
  assert.deepEqual(findCycle([it('a', ['b']), it('b', ['a'])]), ['a', 'b', 'a']);
});

test('findCycle returns null for a DAG', () => {
  assert.equal(findCycle([it('a'), it('b', ['a'])]), null);
});

test('missingDeps reports deps neither picked nor installed', () => {
  const items = [it('starship'), it('zshrc', ['starship'])];
  assert.deepEqual(missingDeps(items, new Set(['zshrc']), () => false), [{ id: 'zshrc', missing: ['starship'] }]);
  assert.deepEqual(missingDeps(items, new Set(['zshrc']), (id) => id === 'starship'), []);
});

test('missingDeps is transitive', () => {
  const items = [it('homebrew'), it('nvm', ['homebrew']), it('ni', ['nvm'])];
  assert.deepEqual(missingDeps(items, new Set(['ni']), () => false), [{ id: 'ni', missing: ['nvm', 'homebrew'] }]);
});

test('parseConfig rejects cycles', () => {
  const yaml = `sections: [{id: dev, title: Dev}]\nitems:\n  - {id: a, name: a, section: dev, install: x, needs: [b]}\n  - {id: b, name: b, section: dev, install: x, needs: [a]}`;
  let err;
  try { parseConfig(yaml); } catch (e) { err = e; }
  assert.ok(err instanceof ConfigError);
  assert.match(err.problems.join('\n'), /cycle: a → b → a/);
});
