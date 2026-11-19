# macOS Kickstarter — Design

Date: 2026-11-18
Status: approved 2026-11-18

## 1. Intent

The owner has kept a Notion page ("New MacBook's first steps") of how they set
up a Mac: dev tools, apps, Alfred workflows, Chrome extensions, a few macOS
tweaks. Following it by hand works, but past attempts to batch it left them
**unsure what actually succeeded**. They are now setting up a Mac mini for the
first time and want to turn the guide into a supervised, repeatable tool.

What success looks like:

- On a **freshly reset Mac**, one pasted line gets them from nothing to fully set up,
  pausing only where a human is genuinely needed.
- On an **already-used Mac**, the same tool shows what is already there and only
  offers what's missing.
- At the end there is an unambiguous report of what was done, skipped, failed.
- Adding a new item = editing a config file, not code.

## 2. Goals / Non-goals / Anti-goals

**Goals**
- Interactive "conductor" in the main terminal; steps that need the user run in a
  **separate Terminal window** the conductor spawns and waits on.
- Per-item "already done?" check wherever possible (idempotent re-runs).
- Link-only items (Alfred workflows, Chrome extensions, paid apps without casks):
  checklist → open chosen links as browser tabs.
- Highly scannable output: colors, emojis, vertical lists, blank lines between
  sections, A–Z within sections.
- Config-driven: one YAML file describes every item.
- Final report + persistent log file.

**Non-goals**
- Secrets management (repo is public; no tokens, license keys, or passwords in config).
- Uninstalling / rollback.
- Configuring app *preferences* beyond the explicit `defaults write` items below.
- Supporting Intel Macs or macOS versions older than the current one (arm64 only is fine;
  builder may support Intel cheaply if it falls out naturally).
- Running unattended / CI.

**Anti-goals (would make it a failure even if it "works")**
- A batch that runs everything blind and leaves the user guessing what happened.
- Destroying user content on a used Mac (e.g. wiping an existing `.zshrc`).
- A wall of unstructured output where failures scroll away.
- Silently treating "window closed" or "user said they did it" as verified success.

## 3. Constraints

- **Fresh Mac has no Node, no Homebrew, no git** (git needs Xcode CLT). Entry point
  must work with only what ships with macOS: `bash`/`zsh`, `curl`, `tar`, `osascript`, `shasum`.
- Repo is **public** on GitHub → entry is a one-liner:
  `curl -fsSL https://raw.githubusercontent.com/<owner>/dev-macOS-kickstarter/main/bootstrap.sh | bash`
- Owner's global rule: **no commits unless explicitly asked.**
- Owner wants to use **Node + the `prompts` npm library** (https://www.npmjs.com/package/prompts).
- `mas` (App Store CLI) cannot sign in; user must already be signed into the App Store.
- `brew install nvm` is unsupported upstream but is the owner's chosen method; its caveats
  (mkdir `~/.nvm`, shell lines) must be handled.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A ✅ chosen** | Tiny bash `bootstrap.sh` → downloads private Node runtime → Node + `prompts` conductor reading `items.yaml` | Two languages (small bash + JS). Gives the nice UX from step 1, including Homebrew. |
| B | Pure bash/zsh | Zero deps, but ugly/limited menus, YAML parsing needs `yq` (needs brew), bash rots past a few hundred lines. Works against readability goal. |
| C | Bun-compiled single binary as GitHub release | No runtime download, but every change needs rebuild + release. Overkill for a personal tool. |

Owner picked **A**.

## 5. Decided design

### 5.1 Bootstrap (`bootstrap.sh`)

1. Detect arch (`uname -m`), require macOS.
2. Download repo as tarball (`https://codeload.github.com/<owner>/dev-macOS-kickstarter/tar.gz/main`)
   into `~/.kickstarter/` (if run from a local checkout instead, use that checkout).
3. Download official Node LTS tarball from nodejs.org into `~/.kickstarter/.runtime/`,
   verify against nodejs.org `SHASUMS256.txt`. Pinned version in bootstrap.
   This Node is **private to the tool** — never added to the user's PATH, never conflicts with NVM.
4. `npm ci` with that Node.
5. `exec` the conductor with that Node. Pass through args (e.g. `--dry-run`).

Re-running the one-liner updates the tool (re-downloads tarball; reuses runtime if version matches).

### 5.2 Config (`items.yaml`)

One YAML file, owner-edited. Long scripts live in `scripts/*.sh` and are referenced.
Sketch of the item shape (builder may refine field names):

```yaml
sections:
  - id: dev
    title: "🛠  Dev"
  - id: apps
    title: "📦 Apps"
  - id: links
    title: "🔗 Links"
  - id: macos
    title: "⚙️  macOS settings"

items:
  - id: homebrew
    name: Homebrew
    emoji: 🍺
    section: dev
    window: true                 # runs in a spawned Terminal window
    check: command -v brew
    install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    after: |                     # post-install, still inside the window
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    note: Asks for your password and to press RETURN.

  - id: alfred
    name: Alfred
    section: apps
    needs: [homebrew]
    brew_cask: alfred            # shorthand → check + install generated
    note: Buy Powerpack for workflows.

  - id: orca
    name: Orca
    section: apps
    needs: [homebrew]
    brew_tap: stablyai/orca
    brew_cask: stablyai/orca/orca

  - id: xcode
    name: Xcode
    section: apps
    needs: [mas]
    mas: 497799835               # shorthand → mas list check + mas install
    window: true                 # ~10 GB, show progress

  - id: zshrc
    name: .zshrc managed block
    section: dev
    needs: [starship, zsh-autosuggestions, nvm]
    script: scripts/zshrc.sh

  - id: alfred-workflows
    name: Alfred workflows
    section: links
    links:
      - { name: Browser Tabs, url: https://alfred.app/workflows/epilande/browser-tabs/ }
      - …
```

Shorthands the builder should support: `brew` (formula), `brew_cask`, `brew_tap`, `mas`,
`links`, plus raw `check` / `install` / `after` / `script`. Shorthands expand to standard
check/install commands so most items are one or two lines.

`needs:` declares dependencies → run order is a topological sort; display order is A–Z within section.

### 5.3 Run flow

1. **Header**: tool name, Mac model, macOS version, arch.
2. **Detect**: run every item's `check` (fast, parallel ok, short timeout). Items with no
   check are "unknown".
3. **Pick** (prompts multiselect): vertical list, **blank line between sections**, section
   headers, **A–Z within section**. Already-done items are shown as `✔ already installed`
   and not selectable. Missing items default to selected. Warnings inline (`⚠️ opens window`).
   - If `prompts` can't render headers/blank lines nicely in one multiselect (disabled
     choices as headers/spacers), fall back to **one multiselect per section** — builder's call.
4. **Dependency guard**: if a picked item `needs` something not installed and not picked,
   warn and offer to add it.
5. **Run** in dependency order, showing `[n/N] emoji Name`:
   - **Inline items** (non-interactive commands): run in the main terminal, output streamed
     to log, spinner + short tail shown.
   - **Window items** (`window: true`): pause with `⏸ Needs you: opens a new Terminal window.
     Continue? (Y/n/skip)` → spawn via `osascript` (Terminal.app `do script`) → the child
     writes its exit code to a status file (and tees output to the log) → conductor polls
     the status file with a spinner → after exit, re-run `check`.
   - **Link items**: second multiselect of the item's links (vertical, A–Z) → `open` each
     URL in the default browser → ask "Did you install them?" → recorded as
     `👤 user-confirmed`, not `✅ verified`.
   - **On failure**: `🔁 retry / ⏭️ skip / 🛑 stop`.
   - Pause before **every** window item, even if picked up front (choice "C").
6. **Report**: grouped, vertical, A–Z within status group:
   `✅ done (verified)` · `👤 done (you confirmed)` · `⏭️ already there` · `❌ failed` · `🙈 skipped`.
   Failed items show the log path / line. Report saved to `~/.config/kickstarter/runs/<timestamp>/` (see 5.10).
7. Remind to open a new terminal (or `exec zsh`) so `.zshrc` changes apply.

### 5.4 Environment between steps

The conductor process doesn't inherit changes from spawned windows. After Homebrew,
the conductor must add `/opt/homebrew/bin` to its own `PATH` (via `brew shellenv`)
so later `check`s/`brew install`s work in the same run. Same for NVM (source `nvm.sh`
inside the command that needs it, e.g. `@antfu/ni` install).

### 5.5 `.zshrc` managed block

Kickstarter owns only the text between markers, rewritten on each run; the rest of the file
is untouched. Backup `~/.zshrc.bak-<timestamp>` before first edit in a run. Block content:

```zsh
# >>> kickstarter >>>
autoload -Uz compinit && compinit
setopt SHARE_HISTORY HIST_IGNORE_ALL_DUPS

eval "$(starship init zsh)"
source $(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh

export NVM_DIR="$HOME/.nvm"
[ -s "$(brew --prefix)/opt/nvm/nvm.sh" ] && \. "$(brew --prefix)/opt/nvm/nvm.sh"
[ -s "$(brew --prefix)/opt/nvm/etc/bash_completion.d/nvm" ] && \. "$(brew --prefix)/opt/nvm/etc/bash_completion.d/nvm"
# <<< kickstarter <<<
```

Block is appended at the **bottom** of `.zshrc` (so it wins over earlier lines). *(Builder
call.)* If the file outside the block already loads Oh My Zsh, Spaceship, or its own NVM
lines, the tool **warns only** (prints the conflicting line numbers) and never edits outside
the markers — per the anti-goal. *(Builder call.)*

Homebrew's `brew shellenv` line goes in `~/.zprofile` (Homebrew's own convention), also as a
managed block.

### 5.6 Item inventory (initial `items.yaml`)

**🛠 Dev**
| Item | How | Notes |
|---|---|---|
| Homebrew | official install script | window; installs Xcode CLT; add shellenv to `.zprofile` |
| git | `brew install git` | |
| mas | `brew install mas` | needed for App Store items |
| Starship | `brew install starship` | replaces Oh My Zsh + Spaceship (both dropped) |
| zsh-autosuggestions | `brew install zsh-autosuggestions` | |
| NVM | `brew install nvm` | `mkdir -p ~/.nvm`; `nvm install --lts`; window |
| @antfu/ni | `npm i -g @antfu/ni` | needs NVM's node (source nvm.sh first); check `command -v ni` |
| .zshrc block | `scripts/zshrc.sh` | see 5.5 |
| Claude Code (CLI) | cask `claude-code` | |
| Codex (CLI) | cask `codex` | |

**📦 Apps** (all casks fetch from vendor servers with pinned checksums — verified 2026-11-18)
| Item | How |
|---|---|
| Alfred | cask `alfred` (note: Powerpack needed for workflows) |
| AltTab | cask `alt-tab` |
| Android Studio | cask `android-studio` |
| Bruno | cask `bruno` |
| Claude (desktop) | cask `claude` |
| CleanShot X | cask `cleanshot` |
| Codex (desktop) | cask `codex-app` |
| CotEditor | mas `1024640650` |
| DBeaver | cask `dbeaver-community` |
| Disk Space Analyzer | mas `446243721` |
| Docker Desktop | cask `docker-desktop` |
| Google Chrome | cask `google-chrome` (dl.google.com; checksum *not* pinned — Google serves latest) |
| LibreOffice | cask `libreoffice` |
| Mic Drop | mas `1489816366` |
| OneDrive | cask `onedrive` |
| Orca | tap `stablyai/orca` + cask `stablyai/orca/orca` (third-party tap) |
| Rectangle Pro | cask `rectangle-pro` |
| TeamViewer | cask `teamviewer` |
| TrackWeight | cask `krishkrosh/apps/trackweight` (third-party tap) |
| Warp | cask `warp` |
| Xcode | mas `497799835` (window; ~10 GB) |

Removed from the Notion list: Oh My Zsh, Spaceship, Bartender, VSCode, Slack, Figma, WebStorm, MacGPT.

**🔗 Links**
- *Alfred workflows* (11; "Open Chrome Profile" dropped — no link):
  | Name | URL |
  |---|---|
  | atop | https://alfred.app/workflows/chrisgrieser/atop/ |
  | Browser Tabs | https://alfred.app/workflows/epilande/browser-tabs/ |
  | Calculate Anything | https://alfred.app/workflows/biatidigital/calculate-anything/ |
  | Default App | https://alfred.app/workflows/acidham/default-app/ |
  | Download Media | https://alfred.app/workflows/vitor/download-media/ |
  | Google Translate | https://github.com/xfslove/alfred-google-translate |
  | JetBrains Open Project | https://github.com/bchatard/alfred-jetbrains |
  | Menu Bar Search | https://alfred.app/workflows/benziahamed/menu-bar-search/ |
  | NPM | https://github.com/willfarrell/alfred-pkgman-workflow |
  | Open Conference URL | https://alfred.app/workflows/caleb531/open-conference-url/ |
  | Say | https://github.com/BaksiLi/AlfredWorkflows/tree/master/Index/say-workflow |
- *Chrome extensions*:
  | Name | URL |
  |---|---|
  | GitHub Issue Reactions | https://chromewebstore.google.com/detail/github-issue-reactions/enekincdenmmbpgkbhflknhaphpajnfd |
  | Quick Jira | https://chromewebstore.google.com/detail/quick-jira/acdnmaeifljongleeegkkfnfcopblokj |
- *Office 365*: https://www.office.com (web, no install).

**⚙️ macOS settings**
| Item | Command | Check |
|---|---|---|
| Keyboard navigation | `defaults write NSGlobalDomain AppleKeyboardUIMode -int 2` | `defaults read … == 2` |
| Chrome swipe-back off | `defaults write com.google.Chrome AppleEnableSwipeNavigateWithScrolls -bool FALSE` + "restart Chrome" note; `needs: [google-chrome]` | `defaults read …` |

Chrome-extension links open **in Chrome** (`open -a "Google Chrome" <url>`), so link items
support an optional `browser:` field; default is the system browser. Chrome extensions
`needs: [google-chrome]`.

### 5.9 Admin password (sudo)

At the start of the run phase (only if any picked item may need it), the conductor runs
`sudo -v` once in the main terminal and keeps the timestamp alive in the background
(`sudo -n -v` every ~60 s) until the run ends. Inline installs (pkg-based casks such as
TeamViewer, OneDrive, Docker; `mas`) then don't hang behind the spinner. Spawned windows
are separate TTYs and may still ask for the password themselves — accepted.
The password is never read, stored, or logged by the tool — `sudo` handles it.

### 5.10 State, telemetry & logs

**Everything stays local. Nothing is sent anywhere.** (Public repo; telemetry exists so the
owner can inspect runs and paste them to Claude for debugging/improvement.)

Lives in `~/.config/kickstarter/` — outside `~/.kickstarter/`, so re-downloading the tool
never wipes it.

| File | Format | Who reads it | Contents |
|---|---|---|---|
| `state.json` | JSON | the tool | Durable per-item memory: last status, last run, `👤 user-confirmed` link picks (per link), installed version, measured size. Next run's picker shows user-confirmed links as done (unticked, re-tickable). |
| `runs/<timestamp>/events.jsonl` | one JSON object per line | Claude / scripts | Structured telemetry (below). |
| `runs/<timestamp>/output.log` | plain text | human | Raw stdout/stderr of every command, with `=== [n/N] item ===` separators. |
| `runs/<timestamp>/report.md` | Markdown | human + Claude | Final report as printed, plus a per-item table (status, duration, size, version, retries). The thing to paste into a chat. |

**Run-level fields** (first/last event): tool version (commit sha from tarball), Node runtime
version, Mac model (`sysctl hw.model`), chip, RAM, macOS version/build, free disk at start/end,
total duration, picked items, flags used.

**Per-item events**: `detect` (check result + duration), `start`, `prompt` (user answer:
continue/skip/retry/stop), `window_spawned`, `end` with:
- `status`, `exit_code`, `duration_ms`, `attempt` (retry count)
- `disk_free_before` / `disk_free_after` / `disk_delta` (from `df -k /`; approximate —
  APFS snapshots, purgeable space and background activity add noise; Xcode/App Store may
  keep downloading after `mas` returns)
- `bundle_size` when the item maps to a known path (cask `.app` artifact, `brew --prefix <formula>`)
  via `du -sk` — the more reliable size number
- `version_installed` (from `brew info --json` / `mas list` / `--version` where cheap)
- `check_after` (re-check result)
- `stderr_tail` (last ~20 lines) on failure
- for link items: which links were opened and which the user confirmed

`--report [last|<timestamp>]` flag prints a saved `report.md`. Old run folders are kept
(no auto-cleanup) — builder may add `--prune-runs`.

### 5.7 Output style

- Colors via a small lib (e.g. `picocolors`/`chalk`); emojis per item/section/status.
- Always **vertical** lists; **blank line between sections**; **A–Z** within sections.
- Spinner while waiting on windows/long commands.
- Command noise goes to the log, not the screen (show last few lines on failure).

### 5.8 Flags

- `--dry-run`: detect (checks are read-only) + pick + print the exact resolved commands in
  run order. Never installs, never edits `.zshrc`/`.zprofile`, never runs `sudo`, never spawns
  windows or opens links. Writes a run folder marked `"dry_run": true` but **never touches
  `state.json`**. Primary way to try the tool on the owner's already-configured MacBook.
- `--only <id,id>`: skip the picker, run these items.
- `--list`: print item inventory with status and exit.

## 6. Left to the builder

- Exact YAML field names and schema validation approach (validate on load, clear error messages).
- File layout of the JS code; choice of color/spinner libs; Node LTS version pinned in bootstrap.
- How the spawned window reports completion (status file + polling is the proposed mechanism).
- Whether checks run in parallel.
- Test strategy (unit tests for config parsing, dependency ordering, managed-block editing;
  `--dry-run` as smoke test).
- README with the one-liner and how to add an item.
