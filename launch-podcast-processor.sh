#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/narford/code/podcast/Made by Codex"
LOG_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/podcast-processor-codex"
LOG_FILE="$LOG_DIR/launcher.log"

mkdir -p "$LOG_DIR"
exec >>"$LOG_FILE" 2>&1

echo "[$(date -Is)] Launching Podcast Processor Codex"

export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export NVM_DIR="$HOME/.nvm"

if [ -s "$NVM_DIR/nvm.sh" ]; then
  # The desktop environment does not always load the user's shell profile.
  # Loading nvm here gives the launcher the same Node/npm as a terminal.
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use --silent default || nvm use --silent node || true
fi

if ! command -v npm >/dev/null 2>&1; then
  node_bin="$(
    find "$HOME/.nvm/versions/node" -maxdepth 2 -type f -name node -printf '%h\n' 2>/dev/null \
      | sort -V \
      | tail -n 1
  )"
  if [ -n "${node_bin:-}" ]; then
    export PATH="$node_bin:$PATH"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js/npm or open the app from a terminal with npm available."
  exit 1
fi

cd "$APP_DIR"

if [ ! -d node_modules ]; then
  npm install
fi

npm start
