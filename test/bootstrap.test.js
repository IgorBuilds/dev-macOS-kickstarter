import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../bootstrap.sh', import.meta.url));
const src = readFileSync(path, 'utf8');

test('bootstrap.sh parses with bash -n and is executable', () => {
  execFileSync('bash', ['-n', path]);
  assert.ok(statSync(path).mode & 0o100);
});

test('reattaches the keyboard for curl | bash', () => {
  assert.match(src, /<\s*\/dev\/tty/);
});

test('verifies the Node download checksum', () => {
  assert.match(src, /shasum -a 256/);
  assert.match(src, /SHASUMS256\.txt/);
});

test('points at the right repo and pins a Node major', () => {
  assert.match(src, /IgorBuilds\/dev-macOS-kickstarter/);
  assert.match(src, /^NODE_MAJOR=\d+$/m);
});

test('never invokes git', () => {
  assert.doesNotMatch(src.replace(/^\s*#.*$/gm, ''), /(^|[\s;|&(])git\s/m);
});

test('fix M13: Node is extracted in a temp dir, then moved into place', () => {
  assert.match(src, /tar -xzf "\$TMP\/\$TARBALL" -C "\$TMP"/);
  assert.match(src, /mv "\$TMP\/\$NODE_NAME" "\$NODE_DIR"/);
});
