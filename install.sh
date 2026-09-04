#!/usr/bin/env bash
set -euo pipefail

REPO="${LOOKSEE_REPO:-https://github.com/rhighs-lab/looksee.git}"
APP_DIR="${LOOKSEE_APP_DIR:-$HOME/.looksee/app}"
BIN_DIR="${LOOKSEE_BIN_DIR:-$HOME/.local/bin}"

say() { printf '  %s\n' "$*"; }
die() { printf 'looksee install: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required"
command -v node >/dev/null || die "node >= 20 is required (https://nodejs.org)"
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 20 ] || die "node >= 20 is required, found $(node -v)"

if ! command -v pnpm >/dev/null; then
  if command -v corepack >/dev/null; then
    say "enabling pnpm through corepack"
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
  fi
fi
command -v pnpm >/dev/null || die "pnpm is required: npm install -g pnpm"

if [ -d "$APP_DIR/.git" ]; then
  say "updating $APP_DIR"
  git -C "$APP_DIR" pull -q --ff-only
else
  say "cloning into $APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone -q "$REPO" "$APP_DIR"
fi

say "installing and building"
(cd "$APP_DIR" && pnpm install --silent)

mkdir -p "$BIN_DIR"
ln -sf "$APP_DIR/dist/server/cli/main.js" "$BIN_DIR/looksee"
chmod +x "$APP_DIR/dist/server/cli/main.js"

say "installed looksee $("$BIN_DIR/looksee" --version) at $BIN_DIR/looksee"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "add to your shell profile: export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
say "run: looksee review ."
