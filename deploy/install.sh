#!/bin/bash
# Generates the launchd plist for THIS checkout and installs it.
#
# launchd needs absolute paths, so the plist can't be committed with usable
# values - it's generated here from deploy/launchd.plist.template instead. Run
# this again after moving the repo, or after changing SCHEDULE_CRON in .env.
#
#   ./deploy/install.sh            install and start
#   ./deploy/install.sh uninstall  stop and remove
set -euo pipefail

LABEL="${LAUNCHD_LABEL:-com.$(id -un | tr "[:upper:]" "[:lower:]").home-automation}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/Library/Logs/home-automation.log"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Uninstalled ${LABEL}."
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
sed -e "s|__LABEL__|${LABEL}|g" \
    -e "s|__REPO__|${REPO}|g" \
    -e "s|__LOG__|${LOG}|g" \
    "$REPO/deploy/launchd.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed ${LABEL}"
echo "  repo: $REPO"
echo "  logs: $LOG"
echo
echo "  status:  launchctl list | grep ${LABEL##*.}"
echo "  follow:  tail -f $LOG"
echo "  stop:    ./deploy/install.sh uninstall"
