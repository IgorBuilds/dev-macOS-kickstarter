import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const config = loadConfig(fileURLToPath(new URL('../items.yaml', import.meta.url)));
const ids = new Set(config.items.map((i) => i.id));

test('items.yaml loads without problems', () => {
  assert.ok(config.items.length > 30);
});

test('sections in order', () => {
  assert.deepEqual(config.sections.map((s) => s.id), ['dev', 'apps', 'links', 'macos']);
});

test('required items present', () => {
  for (const id of 'homebrew git mas starship zsh-autosuggestions nvm ni zshrc zprofile claude-code codex claude codex-app google-chrome xcode alfred-workflows chrome-extensions keyboard-navigation chrome-swipe'.split(' ')) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});

test('removed items absent', () => {
  for (const id of 'bartender vscode slack figma webstorm macgpt oh-my-zsh spaceship open-chrome-profile'.split(' ')) {
    assert.ok(!ids.has(id), `should not have ${id}`);
  }
});

test('every app in apps section has an app bundle name', () => {
  for (const i of config.items.filter((x) => x.section === 'apps')) assert.ok(i.app?.length, `${i.id} lacks app`);
});

test('alfred workflows has 11 links, chrome extensions open in Chrome', () => {
  assert.equal(config.items.find((i) => i.id === 'alfred-workflows').links.length, 11);
  const ext = config.items.find((i) => i.id === 'chrome-extensions');
  assert.equal(ext.browser, 'Google Chrome');
  assert.ok(ext.needs.includes('google-chrome'));
});

test('window items are homebrew, nvm, xcode', () => {
  assert.deepEqual(config.items.filter((i) => i.window).map((i) => i.id).sort(), ['homebrew', 'nvm', 'xcode']);
});

test('fix M9: NVM after fails if nvm install fails (last line chains with &&)', () => {
  const nvm = config.items.find((i) => i.id === 'nvm');
  assert.match(nvm.after.trim().split('\n').at(-1), /nvm install --lts &&/);
});
