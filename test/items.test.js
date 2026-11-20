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
  assert.ok(config.sections.length >= 4);
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

test('window items include homebrew, nvm, xcode and every sudo item', () => {
  const w = new Set(config.items.filter((i) => i.window).map((i) => i.id));
  for (const id of ['homebrew', 'nvm', 'xcode', 'teamviewer', 'onedrive', 'docker-desktop']) assert.ok(w.has(id), id);
  for (const i of config.items) if (i.sudo) assert.ok(i.window, i.id);
});

test('fix M9: NVM after fails if nvm install fails (last line chains with &&)', () => {
  const nvm = config.items.find((i) => i.id === 'nvm');
  assert.match(nvm.after.trim().split('\n').at(-1), /nvm install --lts &&/);
});

const EMOJI = /^\p{Emoji_Presentation}$/u;

test('item emojis are single wide emoji (no U+FE0F) so labels never overlap', () => {
  for (const i of config.items) assert.match(i.emoji, EMOJI, `${i.id}: ${i.emoji} (${[...i.emoji].map((c) => c.codePointAt(0).toString(16)).join(' ')})`);
});

test('section titles start with one wide emoji and a single space', () => {
  for (const s of config.sections) {
    const [first, ...rest] = [...s.title];
    assert.match(first, EMOJI, s.title);
    assert.match(rest.join(''), /^ \S/, s.title);
  }
});

test('mobile section and new tools', () => {
  assert.deepEqual(config.sections.map((s) => s.id), ['dev', 'mobile', 'apps', 'links', 'macos']);
  for (const id of 'pnpm bun deno gh ffmpeg supabase cocoapods watchman eas-cli'.split(' ')) assert.ok(ids.has(id), `missing ${id}`);
  const sec = (id) => config.items.find((i) => i.id === id).section;
  for (const id of ['xcode', 'android-studio', 'cocoapods', 'watchman', 'eas-cli']) assert.equal(sec(id), 'mobile', id);
});

test('pnpm comes from Homebrew, not from an nvm Node', () => {
  assert.equal(config.items.find((i) => i.id === 'pnpm').install, 'brew install pnpm');
});

test('bun and deno also count as installed when already on PATH (official installers)', () => {
  for (const id of ['bun', 'deno']) assert.match(config.items.find((i) => i.id === id).check, new RegExp(`\\|\\| command -v ${id}`));
});

test('free ⌘Space for Alfred: macOS item after Alfred, disables Spotlight hotkey 64 and applies it live', () => {
  const i = config.items.find((x) => x.id === 'spotlight-shortcut');
  assert.ok(i, 'missing spotlight-shortcut');
  assert.equal(i.section, 'macos');
  assert.ok(i.needs.includes('alfred'));
  assert.match(i.check, /AppleSymbolicHotKeys:64:enabled/);
  assert.match(i.install, /-dict-add 64 .*<false\/>/);
  assert.match(i.install, /<integer>32<\/integer><integer>49<\/integer><integer>1048576<\/integer>/);
  assert.match(i.install, /activateSettings -u/);
});

test('OrbStack app via official cask', () => {
  const i = config.items.find((x) => x.id === 'orbstack');
  assert.ok(i, 'missing orbstack');
  assert.equal(i.section, 'apps');
  assert.equal(i.install, 'brew install --cask orbstack');
  assert.deepEqual(i.app, ['OrbStack.app']);
});

test('Sublime Text app via official cask', () => {
  const i = config.items.find((x) => x.id === 'sublime-text');
  assert.ok(i, 'missing sublime-text');
  assert.equal(i.section, 'apps');
  assert.equal(i.install, 'brew install --cask sublime-text');
  assert.deepEqual(i.app, ['Sublime Text.app']);
});

test('heavy apps start unticked in the open-apps step; tips exist for key apps', () => {
  const by = (id) => config.items.find((i) => i.id === id);
  for (const id of ['xcode', 'android-studio', 'docker-desktop']) assert.equal(by(id).heavy, true, id);
  for (const id of ['alfred', 'alt-tab', 'rectangle-pro', 'cleanshot']) assert.ok(by(id).setup, id);
});

test('AltTab on ⌘Tab: macOS item after AltTab, sets its hold key to ⌘ and restarts it', () => {
  const i = config.items.find((x) => x.id === 'alttab-cmd-tab');
  assert.ok(i, 'missing alttab-cmd-tab');
  assert.equal(i.section, 'macos');
  assert.ok(i.needs.includes('alt-tab'));
  assert.match(i.check, /com\.lwouis\.alt-tab-macos holdShortcut/);
  assert.match(i.install, /defaults write com\.lwouis\.alt-tab-macos holdShortcut '<dict><key>secureData<\/key><data>[A-Za-z0-9+/=]+<\/data><key>string<\/key><string>⌘<\/string><\/dict>'/);
  assert.match(i.install, /open -a AltTab/);
});
