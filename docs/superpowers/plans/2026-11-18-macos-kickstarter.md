## TLDR

Build the macOS Kickstarter: one pasted `curl … | bash` line on a fresh (or used) Mac downloads a
private Node runtime and starts an interactive, colorful setup conductor driven by `items.yaml`.
It checks what's already installed, lets you pick what's missing, opens separate Terminal windows
for steps that need you (Homebrew, NVM, Xcode), and ends with a clear ✅/❌ report plus local
telemetry you can paste to Claude. `--dry-run` lets you try it safely on your current MacBook.

🚨🚨🚨 ACTIONS NEEDED FROM YOU

🚨 1. Make the GitHub repo `IgorBuilds/dev-macOS-kickstarter` **public** (it is private today) — the `curl … | bash` one-liner can't reach a private repo.

🚨 2. On each target Mac, sign in to the **App Store** before running (needed for Xcode, CotEditor, Mic Drop, Disk Space Analyzer via `mas`).

🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨

---

# macOS Kickstarter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A supervised, re-runnable Mac setup tool: bash bootstrap → Node + `prompts` conductor → `items.yaml`.

**Architecture:** `bootstrap.sh` (bash, only macOS built-ins) fetches the repo tarball and a checksum-verified Node runtime into `~/.kickstarter/`, then `exec`s `src/cli.js`. The conductor is plain ESM JavaScript split into small single-purpose modules; every side effect (shell, osascript, `open`, prompts) is injected so the runner is unit-testable and `--dry-run` is provably side-effect-free. State/telemetry live in `~/.config/kickstarter/`.

**Tech Stack:** Node (pinned LTS, private runtime), ESM `.js` + JSDoc types (no build step), `prompts@2.4.2`, `yaml@2.9.1`, `picocolors@1.1.1`, tests with built-in `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-18-macos-kickstarter-design.md`

## Global Constraints

- **No git commits.** Owner's global rule: never commit unless explicitly told. Tasks end with "tests pass", not a commit.
- Runtime deps limited to: `prompts`, `yaml`, `picocolors`. No other runtime deps without asking. Spinner is hand-written.
- `"type": "module"`, `"engines": { "node": ">=22" }`. Test command: `node --test test/`.
- Bootstrap uses only: `bash`, `curl`, `tar`, `shasum`, `uname`, `osascript`. No git, no brew.
- Repo: `IgorBuilds/dev-macOS-kickstarter`, branch `main`. Tool dir `~/.kickstarter/` (override `KICKSTARTER_DIR`). Data dir `~/.config/kickstarter/` (override `KICKSTARTER_HOME`).
- Managed-block markers, exact: `# >>> kickstarter >>>` and `# <<< kickstarter <<<`. Block appended at the **bottom**. Never edit outside markers.
- Output: always **vertical** lists, **blank line between sections**, **A–Z by name within a section**. Run order = dependency order.
- Result statuses and emojis, exact: `done ✅`, `confirmed 👤`, `already ⏭️`, `planned 📝` (dry-run only), `failed ❌`, `skipped 🙈`.
- Pause (`⏸ Needs you: opens a new Terminal window. Continue? (Y/n/skip)`) before **every** `window: true` item.
- Failure prompt choices, exact: `🔁 Retry`, `⏭️ Skip`, `🛑 Stop`.
- `--dry-run`: never installs, never edits dotfiles, never runs `sudo`, never spawns windows/opens links, **never writes `state.json`**; does write a run folder with `"dry_run": true`.
- Telemetry is **local only**. Nothing is sent over the network.
- The tool never reads, stores or logs the sudo password.

## Review Focus

1. **Apps installed by hand on a used Mac** (dragged into /Applications, not via brew): must show as installed, not get re-installed (brew would error "It seems there is already an App"). → Task 6 test `detect: app present outside brew counts as installed`.
2. **`curl … | bash` leaves stdin as the pipe**, so `prompts` gets no keyboard input and hangs or exits. → Task 13 step: `exec … </dev/tty` + grep test.
3. **Spawned window closed or crashed before writing its exit file** → the conductor would wait forever. → Task 8 test `waitForExit resolves 'abandoned' on abort` + "press `a` to abandon" hint.
4. **Ctrl+C mid-run or corrupt `state.json`** → finished work must not be lost or crash the next run. → Task 5 test `loadState: corrupt file is backed up and replaced`; Task 10 test `state saved after each item`; Task 12 SIGINT handler writes partial report.
5. **Homebrew installed earlier in the same run**: later inline commands must find `brew` without a new shell. → Task 4 test `brewEnv prepends /opt/homebrew/bin`; Task 10 test `env refreshed after each item`.

---

## File Structure

```
bootstrap.sh                 # entry: fetch repo + Node, npm ci, exec cli (Task 13)
package.json / package-lock.json
items.yaml                   # owner-edited inventory (Task 3)
files/zshrc-block.zsh        # body of the .zshrc managed block (Task 7)
files/zprofile-block.zsh     # body of the .zprofile managed block (Task 7)
README.md                    # one-liner + how to add an item (Task 13)
src/
  config.js        # load + validate + expand shorthands → Config        (Task 1)
  order.js         # topo order, cycle detection, missing-deps guard      (Task 2)
  shell.js         # runShell (zsh -c), tail capture                       (Task 4)
  env.js           # brewEnv(): PATH after Homebrew                        (Task 4)
  state.js         # state.json load/save                                  (Task 5)
  telemetry.js     # run dir, events.jsonl, output.log, disk/size/sysinfo  (Task 5)
  detect.js        # run checks → Status per item                          (Task 6)
  managed-block.js # upsert block, conflicts, applyBuiltin                 (Task 7)
  window.js        # build script, spawn via osascript, wait for exit      (Task 8)
  links.js         # link picking/opening/confirming                       (Task 9)
  sudo.js          # sudo -v + keep-alive                                  (Task 10)
  runner.js        # main item loop                                        (Task 10)
  picker.js        # vertical sectioned multiselect                        (Task 11)
  report.js        # terminal + markdown report                            (Task 11)
  ui.js            # colors, emojis, header, spinner                       (Task 11)
  cli.js           # arg parsing + wiring + flags                          (Task 12)
test/*.test.js     # one file per src module
```

---

### Task 1: Scaffold + config loader

**Files:**
- Create: `package.json`, `src/config.js`, `test/config.test.js`, `test/fixtures/minimal.yaml`, `.gitignore` (`node_modules/`, `.runtime/`)

**Interfaces:**
- Produces:
  ```js
  /** @typedef {{name:string,url:string}} Link */
  /** @typedef {{
   *  id:string, name:string, emoji:string, section:string, needs:string[],
   *  kind:'shell'|'links'|'builtin', window:boolean, sudo:boolean,
   *  check:string|null, install:string|null, after:string|null,
   *  builtin:'zshrc'|'zprofile'|null, links:Link[], browser:string|null,
   *  app:string|null, versionCmd:string|null, sizePath:string|null, note:string|null
   * }} Item */
  /** @typedef {{sections:{id:string,title:string}[], items:Item[]}} Config */
  export class ConfigError extends Error { /** @type {string[]} */ problems }
  export function parseConfig(yamlText: string): Config   // throws ConfigError listing ALL problems
  export function loadConfig(path: string): Config
  export function expandItem(raw: object): Item
  ```

- [ ] **Step 1: `npm init`, add deps** `prompts@2.4.2 yaml@2.9.1 picocolors@1.1.1`; set `"type":"module"`, `"engines":{"node":">=22"}`, `"scripts":{"test":"node --test test/"}`.

- [ ] **Step 2: Write failing tests** in `test/config.test.js`:
  ```js
  test('brew shorthand expands', () => {
    const i = expandItem({ id:'git', name:'git', section:'dev', brew:'git' });
    assert.equal(i.kind, 'shell');
    assert.equal(i.check, 'brew list --formula git >/dev/null 2>&1');
    assert.equal(i.install, 'brew install git');
    assert.equal(i.versionCmd, 'brew list --versions git');
    assert.equal(i.sizePath, '$(brew --prefix git)');
    assert.deepEqual(i.needs, ['homebrew']);           // brew/brew_cask/brew_tap imply homebrew
  });
  test('brew_cask + brew_tap + app expand', () => {
    const i = expandItem({ id:'orca', name:'Orca', section:'apps', brew_tap:'stablyai/orca', brew_cask:'stablyai/orca/orca', app:'Orca.app' });
    assert.equal(i.check, 'brew list --cask stablyai/orca/orca >/dev/null 2>&1');
    assert.equal(i.install, 'brew tap stablyai/orca && brew install --cask stablyai/orca/orca');
    assert.equal(i.sizePath, '/Applications/Orca.app');
    assert.equal(i.versionCmd, 'brew list --cask --versions stablyai/orca/orca');
    assert.deepEqual(i.needs, ['homebrew']);
  });
  test('mas shorthand expands and implies sudo + needs mas', () => {
    const i = expandItem({ id:'xcode', name:'Xcode', section:'apps', mas:497799835, app:'Xcode.app' });
    assert.equal(i.check, 'mas list | grep -q "^497799835 "');
    assert.equal(i.install, 'mas install 497799835');
    assert.equal(i.sudo, true);
    assert.equal(i.versionCmd, 'mas list | grep "^497799835 "');
    assert.equal(i.sizePath, '/Applications/Xcode.app');
    assert.deepEqual(i.needs, ['mas']);
  });
  test('links item', () => {
    const i = expandItem({ id:'x', name:'X', section:'links', browser:'Google Chrome', links:[{name:'A',url:'https://a'}] });
    assert.equal(i.kind, 'links'); assert.equal(i.check, null);
  });
  test('builtin item', () => { assert.equal(expandItem({ id:'zshrc', name:'.zshrc', section:'dev', builtin:'zshrc' }).kind, 'builtin'); });
  test('defaults', () => {
    const i = expandItem({ id:'a', name:'A', section:'dev', install:'true' });
    assert.equal(i.emoji, '📦'); assert.equal(i.window, false); assert.equal(i.sudo, false); assert.deepEqual(i.needs, []);
  });
  test('reports all problems at once', () => {
    const yaml = `sections: [{id: dev, title: Dev}]\nitems:\n  - {id: a, name: A, section: nope, install: x}\n  - {id: a, name: B, section: dev}\n  - {id: c, name: C, section: dev, install: x, needs: [ghost]}`;
    const err = assert.throws(() => parseConfig(yaml), ConfigError);
  });
  ```
  The last test must also assert `err.problems` contains messages mentioning: unknown section `nope`, duplicate id `a`, item `a`/`B` has nothing to do (no install/links/builtin), unknown need `ghost`.
  Explicit `needs` are merged with implied ones (deduped).

- [ ] **Step 3: Run** `node --test test/config.test.js` → FAIL (module not found).
- [ ] **Step 4: Implement** `src/config.js`. Explicit `check`/`install` in YAML override shorthand-generated ones. `id` must match `/^[a-z0-9-]+$/`. Cycle detection is delegated to `findCycle` from Task 2 — call it at the end of `parseConfig` once Task 2 exists (add in Task 2).
- [ ] **Step 5: Run** `node --test test/config.test.js` → PASS.

---

### Task 2: Ordering + dependency guard

**Files:** Create `src/order.js`, `test/order.test.js`; Modify `src/config.js` (call `findCycle`).

**Interfaces:**
- Consumes: `Item` (Task 1).
- Produces:
  ```js
  export function findCycle(items: Item[]): string[]|null             // e.g. ['a','b','a']
  export function orderForRun(items: Item[], picked: Set<string>): Item[]  // only picked, deps first, ties keep YAML order
  export function missingDeps(items: Item[], picked: Set<string>, isInstalled: (id:string)=>boolean):
    {id:string, missing:string[]}[]                                    // transitive
  ```

- [ ] **Step 1: Failing tests:** `orderForRun` puts `homebrew` before `git` even if YAML lists git first; ties preserve YAML order; `findCycle` returns `['a','b','a']` for a↔b; `missingDeps` reports `zshrc → ['starship']` when starship is neither picked nor installed, and reports nothing when installed; transitive (`ni → nvm → homebrew`). `parseConfig` throws `ConfigError` with a problem mentioning `cycle: a → b → a`.
- [ ] **Step 2: Run** `node --test test/order.test.js` → FAIL.
- [ ] **Step 3: Implement** (Kahn's algorithm, queue seeded in YAML index order).
- [ ] **Step 4: Run** `npm test` → PASS.

---

### Task 3: `items.yaml` inventory

**Files:** Create `items.yaml`, `test/items.test.js`

**Interfaces:** Consumes `loadConfig`, `findCycle`.

Content is the spec §5.6 inventory verbatim, with these exact fields:

- Sections in order: `dev "🛠  Dev"`, `apps "📦 Apps"`, `links "🔗 Links"`, `macos "⚙️  macOS settings"`.
- **homebrew**: emoji 🍺, `window: true`, `check: test -x /opt/homebrew/bin/brew`, install = official script, `builtin` not used; `.zprofile` handled by separate item **zprofile** (`builtin: zprofile`, needs homebrew).
- **git** `brew: git` · **mas** `brew: mas` · **starship** `brew: starship` · **zsh-autosuggestions** `brew: zsh-autosuggestions`.
- **nvm**: `brew: nvm`, `window: true`, `after: mkdir -p ~/.nvm && export NVM_DIR="$HOME/.nvm" && . "$(brew --prefix nvm)/nvm.sh" && nvm install --lts`.
- **ni**: needs `[nvm]`, check `export NVM_DIR="$HOME/.nvm"; . "$(brew --prefix nvm)/nvm.sh"; command -v ni >/dev/null`, install same prefix + `npm i -g @antfu/ni`.
- **zshrc**: `builtin: zshrc`, needs `[starship, zsh-autosuggestions, nvm]`.
- **claude-code** `brew_cask: claude-code` · **codex** `brew_cask: codex` (section dev; no `app`).
- Apps (section apps, each with `app:` = bundle name): alfred `Alfred 5.app`, alt-tab `AltTab.app`, android-studio `Android Studio.app`, bruno `Bruno.app`, claude `Claude.app`, cleanshot `CleanShot X.app`, codex-app `Codex.app`, dbeaver-community `DBeaver.app`, docker-desktop `Docker.app` (sudo), google-chrome `Google Chrome.app`, libreoffice `LibreOffice.app`, onedrive `OneDrive.app` (sudo), orca (tap), rectangle-pro `Rectangle Pro.app`, teamviewer `TeamViewer.app` (sudo), trackweight (tap `krishkrosh/apps`, cask `krishkrosh/apps/trackweight`), warp `Warp.app`.
  Implementer verifies each `app` name with `brew info --cask --json=v2 <cask>` (`artifacts[].app`) and corrects it.
- mas: cot-editor `1024640650`, mic-drop `1489816366`, disk-space-analyzer `446243721`, xcode `497799835` (`window: true`). Notes from spec (Alfred Powerpack, Xcode ~10 GB).
- Links: **alfred-workflows** (needs alfred, 11 links from spec), **chrome-extensions** (needs google-chrome, `browser: Google Chrome`, 2 links), **office-365** (1 link).
- macOS: **keyboard-navigation** (check `[ "$(defaults read NSGlobalDomain AppleKeyboardUIMode 2>/dev/null)" = 2 ]`), **chrome-swipe** (needs google-chrome, check `[ "$(defaults read com.google.Chrome AppleEnableSwipeNavigateWithScrolls 2>/dev/null)" = 0 ]`, note "Restart Chrome").

- [ ] **Step 1: Failing test** `test/items.test.js`: real `items.yaml` loads without `ConfigError`; every `brew_cask`/`mas` item in section `apps` except taps has non-null `app`; ids include all of: `homebrew git mas starship zsh-autosuggestions nvm ni zshrc zprofile claude-code codex claude codex-app google-chrome xcode alfred-workflows chrome-extensions keyboard-navigation chrome-swipe`; ids include none of `bartender vscode slack figma webstorm macgpt oh-my-zsh spaceship`; `alfred-workflows` has 11 links.
- [ ] **Step 2: Run** → FAIL. **Step 3:** write `items.yaml`. **Step 4: Run** `npm test` → PASS.

---

### Task 4: Shell runner + brew env

**Files:** Create `src/shell.js`, `src/env.js`, `test/shell.test.js`, `test/env.test.js`

**Interfaces:**
- Produces:
  ```js
  export function runShell(cmd: string, opts?: {env?:object, onChunk?:(s:string)=>void, timeoutMs?:number}):
    Promise<{code:number, tail:string[], timedOut:boolean}>   // /bin/zsh -c; stdin 'inherit'; stdout+stderr merged; tail = last 20 lines
  export function brewEnv(env: object, exists?: (p:string)=>boolean): object
  ```

- [ ] **Step 1: Failing tests:** `runShell('echo hi; exit 3')` → `{code:3, tail:['hi']}`; 30 lines output → tail length 20 ending with line 30; `onChunk` receives output; `timeoutMs:200` on `sleep 5` → `timedOut:true`, code ≠ 0. `brewEnv({PATH:'/usr/bin'}, ()=>true)` → PATH starts with `/opt/homebrew/bin:/opt/homebrew/sbin:` and sets `HOMEBREW_PREFIX=/opt/homebrew`; idempotent (calling twice doesn't duplicate); `exists=()=>false` → env unchanged.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement (`child_process.spawn('/bin/zsh',['-c',cmd],{stdio:['inherit','pipe','pipe']})`). **Step 4: Run** → PASS.

---

### Task 5: State + telemetry

**Files:** Create `src/state.js`, `src/telemetry.js`, `test/state.test.js`, `test/telemetry.test.js`

**Interfaces:**
- Produces:
  ```js
  /** State = {version:1, items:{[id]:{status:string, lastRun:string, version?:string, sizeKb?:number,
   *          links?:{[url]:{confirmedAt:string}}}}} */
  export function dataHome(env=process.env): string              // KICKSTARTER_HOME || ~/.config/kickstarter
  export function loadState(home: string): State                  // missing → empty; corrupt → rename to state.json.corrupt-<ts>, return empty
  export function saveState(home: string, state: State): void     // atomic: write tmp + rename
  export function createRun(o:{home:string, dryRun:boolean, now?:Date}): Run
  /** Run = { dir:string, logPath:string, event(type:string, data?:object):void, log(text:string):void,
   *          writeReport(md:string):void } */
  export function diskFreeKb(): Promise<number>                    // df -k / → "Available" column
  export function sizeKb(path: string, env?: object): Promise<number|null>   // du -sk via zsh (expands $(…)); null if missing
  export function systemInfo(): Promise<{model:string, chip:string, ramGb:number, macos:string, build:string, arch:string}>
  ```
- Run dir name: `runs/YYYY-MM-DD_HHMMSS` (+`-dry` suffix in dry-run). Files: `events.jsonl`, `output.log`, `report.md`. Each event line: `{"ts":ISO,"type":…, …data}`. First event `run_start` includes `dry_run`.

- [ ] **Step 1: Failing tests** (tmp dirs via `fs.mkdtempSync`): `loadState` on missing dir → `{version:1, items:{}}`; `saveState`→`loadState` round-trips; **`loadState: corrupt file is backed up and replaced`** (write `{oops`, expect empty state and a `state.json.corrupt-*` file); `createRun` with `now=2026-11-18T14:32:05` → dir ends `runs/2026-11-18_143205`, dry → `…_143205-dry`; `event('x',{a:1})` appends one parseable JSON line with `type:'x', a:1, ts`; first line is `run_start` with `dry_run`; `log` appends to `output.log`; `diskFreeKb()` > 0; `sizeKb(tmpdir)` is a number; `sizeKb('/nope')` → null; `systemInfo().arch` is `arm64` or `x86_64`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement (`sysctl -n hw.model`, `sysctl -n machdep.cpu.brand_string`, `sysctl -n hw.memsize`, `sw_vers -productVersion` / `-buildVersion`, `uname -m`). **Step 4: Run** → PASS.

---

### Task 6: Detection

**Files:** Create `src/detect.js`, `test/detect.test.js`

**Interfaces:**
- Consumes: `Item`, `runShell`, `State`.
- Produces:
  ```js
  /** Status = {state:'installed'|'missing'|'unknown'|'confirmed', via?:'check'|'app'|'state'} */
  export function detectItem(item: Item, deps:{state:State, env:object, runShell:Function, exists:(p)=>boolean, timeoutMs?:number}): Promise<Status>
  export function detectAll(items: Item[], deps): Promise<Map<string,Status>>   // parallel, timeout 10000 ms each
  ```
- Rules: `shell`/`builtin` with check exit 0 → `installed via check`; else if `app` and `/Applications/<app>` exists → `installed via app`; else `missing`. No check and not links → `unknown`. Links: all links in `state.items[id].links` → `confirmed via state`; else `unknown`. Builtin check = block present and equal to the file body (Task 7 supplies `builtinCheck`; wire it in Task 7).

- [ ] **Step 1: Failing tests** with fake `runShell`/`exists`: check exit 0 → installed; exit 1 → missing; **`detect: app present outside brew counts as installed`** (check exit 1, `exists('/Applications/Alfred 5.app')` true → `{state:'installed', via:'app'}`); check timing out → missing; links all confirmed → confirmed; links partially confirmed → unknown; `detectAll` returns a Map with every id.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS.

---

### Task 7: Managed blocks (`.zshrc` / `.zprofile`)

**Files:** Create `src/managed-block.js`, `files/zshrc-block.zsh`, `files/zprofile-block.zsh`, `test/managed-block.test.js`; Modify `src/detect.js` (builtin check).

`files/zshrc-block.zsh` content = spec §5.5 block body (without markers). `files/zprofile-block.zsh` = `eval "$(/opt/homebrew/bin/brew shellenv)"`.

**Interfaces:**
- Produces:
  ```js
  export const START = '# >>> kickstarter >>>', END = '# <<< kickstarter <<<';
  export function readBlock(text: string): string|null
  export function upsertBlock(text: string, body: string): string     // replace in place, else append at bottom with one blank line before
  export function findConflicts(text: string): {line:number, text:string, reason:string}[]  // outside block only
  export function applyBuiltin(kind:'zshrc'|'zprofile', o:{home:string, repoDir:string, dryRun:boolean, now?:Date}):
    {changed:boolean, backup:string|null, conflicts:{line,text,reason}[]}
  export function builtinCheck(kind, o:{home, repoDir}): boolean
  ```
- Conflict patterns (outside block): `oh-my-zsh.sh` → "Oh My Zsh", `spaceship` → "Spaceship prompt", `nvm.sh` or `NVM_DIR=` → "NVM loaded twice", `starship init` → "Starship init twice".

- [ ] **Step 1: Failing tests:** empty text → `START\nbody\nEND\n`; existing user lines preserved byte-for-byte above the block; existing block replaced, content outside untouched; upsert twice → identical (idempotent); `readBlock` round-trip; `findConflicts` flags `source $ZSH/oh-my-zsh.sh` on correct 1-based line and ignores same text **inside** the block; `applyBuiltin` with tmp home writes file, creates `.zshrc.bak-<ts>` only when the file existed and content changed; second call → `changed:false`, no new backup; `dryRun:true` → file untouched, `changed:true` reported; `builtinCheck` true after apply; follows a symlinked `.zshrc` (writes target, keeps link).
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement; wire `builtinCheck` into `detectItem` for `kind:'builtin'`. **Step 4: Run** → PASS.

---

### Task 8: Window spawner

**Files:** Create `src/window.js`, `test/window.test.js`

**Interfaces:**
- Produces:
  ```js
  export function buildWindowScript(item: Item, o:{logPath:string, exitPath:string}): string
  export function spawnWindow(item: Item, o:{runDir:string, logPath:string, osascript?:(script:string)=>Promise<void>}):
    Promise<{exitPath:string}>    // writes <runDir>/windows/<id>.sh (chmod 755), tells Terminal to run it, activates Terminal
  export function waitForExit(exitPath: string, o?:{pollMs?:number, signal?:AbortSignal}): Promise<number|'abandoned'>
  ```
- Script shape: `#!/bin/zsh`, `set -o pipefail`, `eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null`, colored banner with item name + note, `{ install } && { after }` piped through `tee -a <logPath>`, write `$?` to `exitPath`, print `✅ Done — you can close this window` or `❌ Failed (exit N) — go back to the main window`. `after` omitted when null. AppleScript must quote the path safely (escape `\` and `"`).

- [ ] **Step 1: Failing tests:** script contains install and after in order, `tee -a`, writes to exitPath, has `pipefail`; no `after` → no empty `{ }`; executing the generated script via `zsh` with `install:'exit 4'` writes `4` to exitPath; `spawnWindow` with fake `osascript` receives AppleScript containing `do script` and the escaped script path (test path with a space and a `"`); `waitForExit` resolves `0` after file appears (write it 100 ms later); **`waitForExit resolves 'abandoned' on abort`**.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement (default `osascript` = `execFile('osascript',['-e',script])`). **Step 4: Run** → PASS.

---

### Task 9: Link items

**Files:** Create `src/links.js`, `test/links.test.js`

**Interfaces:**
- Produces:
  ```js
  export function linkChoices(item: Item, state: State): {title:string, value:string, selected:boolean, description?:string}[]
     // A–Z by name; already-confirmed links titled "👤 <name>  (you confirmed)" and selected:false; others selected:false
  export function runLinksItem(item: Item, deps:{state:State, prompts:Function, open:(url,browser)=>Promise<void>, dryRun:boolean, now?:Date}):
    Promise<{status:'confirmed'|'skipped'|'planned', opened:string[], confirmed:string[]}>
  ```
- Flow: multiselect "Which <name> do you want to open?" → open each (`open -a "<browser>" url` or `open url`) → multiselect "Which did you install?" (opened, all pre-selected) → write `state.items[id].links[url].confirmedAt` for confirmed. None picked → `skipped`. Dry-run → no prompts for confirmation, no `open`, status `planned`, `opened` = list it *would* open (all non-confirmed).

- [ ] **Step 1: Failing tests** using `prompts.inject([...])`: picks 2 of 3 → `open` called twice with browser; confirm 1 → state has 1 `confirmedAt`, status `confirmed`; pick none → `skipped`, `open` never called; dry-run → `open` never called, status `planned`; `linkChoices` is A–Z.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS.

---

### Task 10: Runner (+ sudo keep-alive)

**Files:** Create `src/runner.js`, `src/sudo.js`, `test/runner.test.js`

**Interfaces:**
- Consumes: everything above (all injected).
- Produces:
  ```js
  export function startSudoKeepAlive(o?:{spawnSync?, setInterval?}): {stop():void}   // `sudo -v` (stdio inherit) throws on failure; then `sudo -n -v` every 60000 ms, timer unref'd
  /** Result = {id, name, section, status:'done'|'confirmed'|'already'|'planned'|'failed'|'skipped',
   *           exitCode?:number, durationMs:number, attempts:number, diskDeltaKb?:number, sizeKb?:number|null,
   *           version?:string|null, tail?:string[], commands?:string[]} */
  export function runItems(ordered: Item[], ctx: RunCtx): Promise<Result[]>
  /** RunCtx = {env, run:Run, state:State, home, repoDir, dryRun:boolean, prompts, ui,
   *   runShell, spawnWindow, waitForExit, applyBuiltin, runLinksItem, detectItem, diskFreeKb, sizeKb,
   *   saveState:(state)=>void, brewEnv} */
  ```
- Per item: print `[n/N] emoji Name`; event `start`; disk before → act → disk after → re-`detectItem` (`check_after`) → `sizeKb(sizePath)` + `versionCmd` when present → event `end` with all spec §5.10 fields → update `state.items[id]` → **`saveState` after each item** (skipped in dry-run) → `ctx.env = brewEnv(ctx.env)`.
- Window items: confirm `⏸ Needs you: opens a new Terminal window. Continue? (Y/n/skip)` (`n` = stop run, `skip` = skipped); while waiting show spinner + hint `press a to abandon` (abort controller on keypress `a`).
- Inline shell: `install` then `after`, output → `run.log`. Builtin → `applyBuiltin`, print conflicts as ⚠️ lines.
- Success = exit 0 **and** re-check passes (if a check exists). Otherwise failure prompt `🔁 Retry / ⏭️ Skip / 🛑 Stop`; Stop → all remaining items `skipped`.
- Dry-run: status `planned`, `commands` = the resolved commands, **no** `runShell` for install/after, no `spawnWindow`, no `applyBuiltin` writes (call with `dryRun:true` only), no `saveState`, no sudo.

- [ ] **Step 1: Failing tests** with fakes recording calls:
  - inline success → `done`, `attempts:1`, events `start`+`end` written, `diskDeltaKb` = after − before.
  - exit 0 but re-check fails → prompt shown; answer Skip → `skipped`.
  - fail → Retry → success → `done`, `attempts:2`.
  - fail → Stop → this `failed`, all later items `skipped`, later `runShell` never called.
  - window item: pause answered `skip` → `skipped`, `spawnWindow` not called; answered Y → `spawnWindow` then `waitForExit`; `'abandoned'` → failure prompt.
  - **`state saved after each item`**: `saveState` call count == items count.
  - **`env refreshed after each item`**: `brewEnv` called after each item and `ctx.env` replaced.
  - **dry-run**: every result `planned`, `commands` non-empty for shell items, `runShell`/`spawnWindow`/`saveState` never called, `applyBuiltin` only with `dryRun:true`.
  - `startSudoKeepAlive`: fake `spawnSync` status 1 → throws; status 0 → interval registered with 60000.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS.

---

### Task 11: UI, picker, report

**Files:** Create `src/ui.js`, `src/picker.js`, `src/report.js`, `test/picker.test.js`, `test/report.test.js`

**Interfaces:**
- Produces:
  ```js
  // ui.js
  export const STATUS = { done:'✅', confirmed:'👤', already:'⏭️', planned:'📝', failed:'❌', skipped:'🙈' };
  export function header(sys): string                 // "🚀 macOS Kickstarter   <model> · macOS <ver> · <arch>" + rule
  export function spinner(text: string): {update(t:string):void, stop(finalLine?:string):void}   // hand-written, 80 ms frames ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, no-op when !isTTY
  // picker.js
  export function buildChoices(config: Config, statuses: Map<string,Status>): Choice[]
  export function pickItems(config, statuses, {prompts}): Promise<string[]>
  // report.js
  export function renderReport(results: Result[], o:{dryRun:boolean, runDir:string, sys, startedAt:Date, endedAt:Date, diskStartKb:number, diskEndKb:number}):
    {terminal:string, markdown:string}
  ```
- `buildChoices`: per section in YAML order → disabled header choice (section title, bold), items **A–Z by name**, then a disabled spacer choice `' '` between sections (not after the last). installed → `disabled:true`, title `✔ <name>  already installed` (+ `(not via brew)` when `via:'app'`); confirmed → selectable, `selected:false`, `👤`; missing → `selected:true`; unknown → `selected:false`. Window items get `  ⚠️ opens window` suffix. `note` → `description`.
  If prompts renders disabled rows badly in practice (verify manually in Task 12), switch `pickItems` to one multiselect per section with same ordering — keep `buildChoices` tests.
- Report: summary line `✅ n done   👤 n confirmed   ⏭️ n already there   ❌ n failed   🙈 n skipped` (+`📝 n planned` in dry-run, title `📋 Dry-run report`); then groups in that order, **vertical, A–Z** within group, blank line between groups; failed rows show `exit N · see <runDir>/output.log` + last 5 tail lines; footer: duration, disk used, `Run folder: <runDir>`, and (non-dry) `🔁 Open a new terminal (or run: exec zsh) to load .zshrc changes`. Markdown version adds a table: `| Item | Status | Duration | Size | Version | Attempts |`.

- [ ] **Step 1: Failing tests:** picker — headers in section order; within section names A–Z (`AltTab` before `Bruno` before `Xcode`); exactly one spacer between consecutive sections and none at end; installed disabled with `already installed`; missing selected; `(not via brew)` for via app; window suffix present. Report — counts correct; groups ordered; A–Z within group; failed row includes `exit 1` and runDir; dry-run title and `📝`; markdown has table header exact string above.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS.

---

### Task 12: CLI wiring + flags

**Files:** Create `src/cli.js`, `test/cli.test.js`

**Interfaces:**
- Produces:
  ```js
  export function parseArgs(argv: string[]): {dryRun:boolean, only:string[]|null, list:boolean, report:string|null, help:boolean}
  export async function main(argv: string[], deps?): Promise<number>   // exit code
  ```
- Flow (spec §5.3): header(systemInfo) → loadConfig(`<repoDir>/items.yaml`) (on `ConfigError` print every problem, exit 2) → loadState → createRun → `run_start` event with sys/tool version (`KICKSTARTER_VERSION` env, else `local`)/node version/flags → spinner "🔍 Checking what's already here…" + detectAll → pick (or `--only`) → `missingDeps` guard (prompt "Add <deps>?" default yes) → `orderForRun` → if any picked item has `sudo` and not dry-run: print `🔐 Some installs need your password once.` + startSudoKeepAlive → runItems → renderReport → print + writeReport → `run_end` event → stop keep-alive → exit 0 (1 if any failed).
- `--list`: detect + print sectioned vertical status list, exit 0. `--report [last|<dir-name>]`: print saved `report.md` (last = newest run dir), exit 0/1 if none. `--only a,b`: skip picker; unknown id → error exit 2. `--help`.
- SIGINT: write partial report (results so far + remaining `skipped`) and `run_end{interrupted:true}`, stop keep-alive, exit 130.
- prompts cancel (Esc/Ctrl+C inside prompt) is treated the same as SIGINT.

- [ ] **Step 1: Failing tests:** `parseArgs(['--dry-run','--only','git,nvm'])` → `{dryRun:true, only:['git','nvm'], …}`; `parseArgs(['--report'])` → `report:'last'`; `main(['--only','ghost'])` with fake deps → 2; `main(['--dry-run','--only','git'])` with fakes → 0, run dir ends `-dry`, `state.json` not created.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** `npm test` → all PASS.
- [ ] **Step 5: Manual check** `node src/cli.js --list` and `node src/cli.js --dry-run` on the current MacBook. Verify picker layout (vertical, blank line between sections, A–Z, headers). If disabled rows look wrong, apply the per-section fallback from Task 11.

---

### Task 13: `bootstrap.sh` + README

**Files:** Create `bootstrap.sh` (chmod 755), `README.md`, `test/bootstrap.test.js`

Behavior (spec §5.1):
1. `set -euo pipefail`; require `uname -s` = Darwin; map `uname -m` → `arm64`|`x64`.
2. Constants: `REPO=IgorBuilds/dev-macOS-kickstarter`, `NODE_VERSION=` latest **LTS** from https://nodejs.org/dist/index.json at implementation time (pin exact, e.g. `v24.x.y`), `KICKSTARTER_DIR=${KICKSTARTER_DIR:-$HOME/.kickstarter}`.
3. **Local mode** if `${BASH_SOURCE[0]:-}` is a file and its dir has `items.yaml` → `APP_DIR` = that dir, `KICKSTARTER_VERSION=local`. **Remote mode** otherwise: `sha=$(curl -fsSL -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/$REPO/commits/main)`; download `https://codeload.github.com/$REPO/tar.gz/$sha` → extract (`--strip-components 1`) into `$KICKSTARTER_DIR/app.new`, then swap to `$KICKSTARTER_DIR/app`; `KICKSTARTER_VERSION=${sha:0:7}`.
4. Node: if `$KICKSTARTER_DIR/.runtime/node-$NODE_VERSION/bin/node` missing → download `https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$ARCH.tar.gz` and `SHASUMS256.txt`, verify with `shasum -a 256 -c` on the matching line (abort with clear ❌ message on mismatch), extract.
5. `PATH="$NODE_BIN:$PATH" npm ci --omit=dev --no-audit --no-fund` in `APP_DIR` (skip if `node_modules/.package-lock.json` matches lockfile hash — builder's call).
6. **`exec "$NODE_BIN/node" "$APP_DIR/src/cli.js" "$@" </dev/tty`** — required because under `curl | bash` stdin is the script pipe.
7. Pretty, emoji'd progress lines (`📥 Downloading…`, `🔐 Verifying Node checksum…`, `✅`), no color codes when not a TTY.

README: what it is, the one-liner (`curl -fsSL https://raw.githubusercontent.com/IgorBuilds/dev-macOS-kickstarter/main/bootstrap.sh | bash`), passing flags through curl (`| bash -s -- --dry-run`), local use (`./bootstrap.sh --dry-run`), flags table, where data lives, how to add an item (one brew_cask example + one custom check/install example), list of shorthands.

- [ ] **Step 1: Failing test** `test/bootstrap.test.js`: `bash -n bootstrap.sh` exits 0; file contains `</dev/tty`, `shasum -a 256`, `IgorBuilds/dev-macOS-kickstarter`, and a `NODE_VERSION=v` line matching `/^NODE_VERSION=v\d+\.\d+\.\d+$/m`; no `git ` command invocations.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement bootstrap + README. **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Manual smoke** on current MacBook: `KICKSTARTER_DIR=$(mktemp -d) ./bootstrap.sh --dry-run` → Node downloaded + verified, picker appears and accepts keyboard, dry-run report printed, `~/.config/kickstarter/state.json` unchanged (compare mtime before/after), run folder ends `-dry`.

---

## Test scenarios (end-to-end, manual, owner)

| # | Where | Command | Expect |
|---|---|---|---|
| 1 | Current MacBook | `./bootstrap.sh --list` | Installed apps (incl. hand-installed) show ✔; nothing changes |
| 2 | Current MacBook | `./bootstrap.sh --dry-run` | Picker vertical/A–Z/blank lines; report `📝 planned`; no windows/tabs/sudo; `state.json` untouched |
| 3 | Current MacBook | `./bootstrap.sh --only keyboard-navigation` | Real run of one harmless item → ✅, `state.json` updated, run folder has events/log/report |
| 4 | Current MacBook | `./bootstrap.sh --report` | Prints last report |
| 5 | Mac mini (fresh) | one-liner from README | Homebrew window opens, conductor waits, continues; full run; final report; new terminal shows Starship prompt |
| 6 | Mac mini | re-run one-liner | Everything ✔ already installed; links 👤 confirmed; nothing re-installed |
