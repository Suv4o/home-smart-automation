#!/bin/bash
# Runs the long-lived scheduler daemon (node-cron, ticks at :00 and :30).
# launchd keeps this alive (KeepAlive), restarting it on crash or reboot.
set -euo pipefail

# launchd has a minimal PATH; make node, uv (plug) and tesla-control (car,
# installed to ~/go/bin) resolvable.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:/usr/bin:/bin:$PATH"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  NODE="$(ls -1 "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "$NODE" ] || { echo "node not found"; exit 1; }

cd "$(dirname "$0")/.."
exec "$NODE" --env-file=.env src/cli.ts watch
