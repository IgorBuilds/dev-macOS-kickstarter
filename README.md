# 🚀 macOS Kickstarter

A supervised, re-runnable setup tool for a new (or already-used) Mac.
It checks what's already installed, lets you pick what's missing, opens a separate Terminal window
for steps that need you (Homebrew, NVM, Xcode), and ends with a clear report of what worked.

## ▶️ Run it

On a fresh Mac, paste in Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/IgorBuilds/dev-macOS-kickstarter/main/bootstrap.sh | bash
```

With options:

```sh
curl -fsSL https://raw.githubusercontent.com/IgorBuilds/dev-macOS-kickstarter/main/bootstrap.sh | bash -s -- --dry-run
```

From a local clone:

```sh
./bootstrap.sh --dry-run
```

> 🛍️ Sign in to the **App Store** first — `mas` (Xcode, CotEditor, Mic Drop, Disk Space Analyzer) can't sign in for you.

## 🎛️ Options

| Flag | What it does |
|---|---|
| `--dry-run` | Checks + picker + prints the exact commands. Installs nothing, edits nothing, no password, no windows. Never touches `state.json`. |
| `--only a,b` | Skip the picker; set up just these item ids. |
| `--list` | Show every item and whether it's installed. |
| `--open` | Open apps the kickstarter installed (one by one or all at once) to set them up. |
| `--report [name]` | Reprint the last run's report (or a specific run folder). |
| `-h`, `--help` | Help. |

## 🧭 How a run goes

1. 🔍 Every item's check runs (read-only). Installed apps — even ones you installed by hand — show ✔.
2. ☑️ One checklist per section (A–Z). Missing items are pre-selected — except ones you unticked last
   time, which stay unticked (*skipped last time*). Tick one again and it's remembered as wanted.
3. 🛍️ Picked App Store apps? A friendly reminder to sign in first (or skip them this run).
4. ▶️ Items run in dependency order. Items marked ⚠️ *opens window* pause first, then run in their own
   Terminal window — the main window waits (press `a` to abandon a stuck window).
5. ❌ On failure: 🔁 Retry · ⏭️ Skip · 🛑 Stop.
6. 📋 Report: ✅ done · 👤 you confirmed · ⏭️ already there · ❌ failed · 🙈 skipped.
7. 🔔 A macOS notification + sound when it finishes (Hero = all good, Basso = something failed).
8. 🚀 Open your new apps to set them up — **one by one** (with a setup tip each, then Next) or **all at once**.
   Heavy apps (Xcode, Android Studio, Docker) start unticked. Later: `--open` brings this back.

Steps that may ask for your admin password (pkg installers like TeamViewer/OneDrive/Docker, App Store
installs) always **open a new Terminal window**, so the password prompt is visible.

## 📁 Where things live

| Path | What |
|---|---|
| `~/.kickstarter/` | The tool itself + its private Node runtime (safe to delete). |
| `~/.config/kickstarter/state.json` | What it remembers between runs (statuses, versions, sizes, confirmed links). |
| `~/.config/kickstarter/runs/<time>/report.md` | The final report — **paste this to Claude** to debug or improve. |
| `~/.config/kickstarter/runs/<time>/events.jsonl` | Structured telemetry (durations, disk before/after, sizes, answers). |
| `~/.config/kickstarter/runs/<time>/output.log` | Raw output of every command. |

Nothing is sent anywhere — telemetry is local only.

`.zshrc` / `.zprofile`: the tool only owns the lines between `# >>> kickstarter >>>` and
`# <<< kickstarter <<<` (contents in [`files/`](files/)). A backup is made before each change.
Conflicting lines elsewhere (Oh My Zsh, Spaceship, a second NVM loader) are **warned about, never edited**.

## ➕ Add an item

Edit [`items.yaml`](items.yaml). A brew cask app:

```yaml
  - id: raycast
    name: Raycast
    emoji: 🔍
    section: apps
    brew_cask: raycast
    app: Raycast.app        # also counts as installed if this exists in /Applications
```

Something custom:

```yaml
  - id: dock-autohide
    name: Auto-hide the Dock
    emoji: 🫥
    section: macos
    check: '[ "$(defaults read com.apple.dock autohide 2>/dev/null)" = 1 ]'
    install: defaults write com.apple.dock autohide -bool true && killall Dock
```

Shorthands: `brew`, `brew_cask`, `brew_tap`, `mas` (App Store id), `links`, `builtin` (`zshrc`/`zprofile`).
Raw: `check`, `install`, `after`. Extras: `app`, `needs`, `window`, `sudo`, `note`, `browser`, `version`.
The header of `items.yaml` documents each one.

## 🧪 Develop

```sh
npm install
npm test
node src/cli.js --list
```
