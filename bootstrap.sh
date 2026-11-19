#!/usr/bin/env bash
# 🚀 macOS Kickstarter — bootstrap
#
# Fresh Mac:   curl -fsSL https://raw.githubusercontent.com/IgorBuilds/dev-macOS-kickstarter/main/bootstrap.sh | bash
# With flags:  curl -fsSL --retry 3 --retry-connrefused …/bootstrap.sh | bash -s -- --dry-run
# Local clone: ./bootstrap.sh --dry-run
#
# Uses only what ships with macOS (bash, curl, tar, shasum). Downloads a private, checksum-verified
# Node runtime into ~/.kickstarter/.runtime — never touches your PATH or NVM.
set -euo pipefail

REPO="IgorBuilds/dev-macOS-kickstarter"
BRANCH="main"
NODE_MAJOR=24
KICKSTARTER_DIR="${KICKSTARTER_DIR:-$HOME/.kickstarter}"

if [ -t 1 ]; then B=$'\e[1m'; D=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; C=$'\e[36m'; X=$'\e[0m'; else B= D= R= G= C= X=; fi
say()  { printf '%s\n' "$*"; }
step() { say "${C}$*${X}"; }
ok()   { say "${G}✅ $*${X}"; }
die()  { say "${R}❌ $*${X}" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "macOS only."
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) die "Unsupported CPU: $(uname -m)" ;;
esac

say ""
say "${B}${C}🚀 macOS Kickstarter${X}  ${D}bootstrap${X}"
say "${D}────────────────────────────────────────────────────────────────${X}"
say "${D}🛍️  Tip: sign in to the App Store app first — Xcode & other App Store apps need it.${X}"

mkdir -p "$KICKSTARTER_DIR/.runtime"

# ── 1. App: local checkout or fresh tarball ──────────────────────────────────
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ] && [ -f "$(cd "$(dirname "$SCRIPT_PATH")" && pwd)/items.yaml" ]; then
  APP_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  KICKSTARTER_VERSION="local"
  ok "Using local checkout ${D}$APP_DIR${X}"
else
  step "📥 Downloading kickstarter…"
  SHA="$(curl -fsSL --retry 3 --retry-connrefused -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null || true)"
  REF="${SHA:-$BRANCH}"
  rm -rf "$KICKSTARTER_DIR/app.new"
  mkdir -p "$KICKSTARTER_DIR/app.new"
  curl -fsSL --retry 3 --retry-connrefused "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xzf - --strip-components 1 -C "$KICKSTARTER_DIR/app.new" \
    || die "Could not download $REPO (is the repo public?)"
  rm -rf "$KICKSTARTER_DIR/app"
  mv "$KICKSTARTER_DIR/app.new" "$KICKSTARTER_DIR/app"
  APP_DIR="$KICKSTARTER_DIR/app"
  KICKSTARTER_VERSION="${SHA:0:7}"
  KICKSTARTER_VERSION="${KICKSTARTER_VERSION:-$BRANCH}"
  ok "Kickstarter ${D}$KICKSTARTER_VERSION${X}"
fi

# ── 2. Private Node runtime (latest v$NODE_MAJOR LTS, checksum verified) ──────
RUNTIME="$KICKSTARTER_DIR/.runtime"
SUMS_URL="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt"
SUM_LINE="$(curl -fsSL --retry 3 --retry-connrefused "$SUMS_URL" 2>/dev/null | grep -E "  node-v[0-9.]+-darwin-${ARCH}\.tar\.gz$" || true)"

if [ -n "$SUM_LINE" ]; then
  TARBALL="${SUM_LINE##* }"                   # node-v24.x.y-darwin-arm64.tar.gz
  NODE_NAME="${TARBALL%.tar.gz}"
  NODE_DIR="$RUNTIME/$NODE_NAME"
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    step "📥 Downloading ${NODE_NAME}…"
    TMP="$(mktemp -d)"
    curl -fsSL --retry 3 --retry-connrefused "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$TARBALL" -o "$TMP/$TARBALL" || die "Node download failed."
    step "🔐 Verifying Node checksum…"
    ( cd "$TMP" && printf '%s\n' "$SUM_LINE" | shasum -a 256 -c - >/dev/null ) || die "Checksum mismatch for $TARBALL — aborting."
    tar -xzf "$TMP/$TARBALL" -C "$TMP"
    rm -rf "$NODE_DIR"
    mv "$TMP/$NODE_NAME" "$NODE_DIR"         # atomic-ish: an interrupted download never leaves a half runtime
    rm -rf "$TMP"
  fi
else
  # Offline / nodejs.org unreachable: reuse the newest runtime we already have.
  NODE_DIR="$(ls -d "$RUNTIME"/node-v*-darwin-"$ARCH" 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$NODE_DIR" ] && [ -x "$NODE_DIR/bin/node" ] || die "Can't reach nodejs.org and no cached Node runtime."
  say "${D}⚠️  nodejs.org unreachable — using cached $(basename "$NODE_DIR")${X}"
fi
ok "Node $("$NODE_DIR/bin/node" --version) ${D}(private runtime)${X}"

# ── 3. Dependencies ───────────────────────────────────────────────────────────
LOCK_HASH="$(shasum -a 256 "$APP_DIR/package-lock.json" | cut -d' ' -f1)"
STAMP="$APP_DIR/node_modules/.kickstarter-lock"
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$LOCK_HASH" ]; then
  step "📦 Installing dependencies…"
  ( cd "$APP_DIR" && PATH="$NODE_DIR/bin:$PATH" npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null ) \
    || die "npm ci failed."
  printf '%s' "$LOCK_HASH" > "$STAMP"
fi
ok "Ready"

# ── 4. Hand over to the conductor ─────────────────────────────────────────────
export KICKSTARTER_VERSION
# Under `curl | bash`, stdin is the script itself — reattach the keyboard so prompts work.
if { true </dev/tty; } 2>/dev/null; then
  exec "$NODE_DIR/bin/node" "$APP_DIR/src/cli.js" "$@" </dev/tty
else
  exec "$NODE_DIR/bin/node" "$APP_DIR/src/cli.js" "$@"
fi
