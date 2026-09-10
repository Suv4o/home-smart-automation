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

# The dashboard's address. Worth printing because it is the one thing you cannot
# work out from this script's other output, and DHCP changes it without warning -
# a stale bookmark on the tablet is silent until someone notices the screen has
# stopped updating.
PORT="$(sed -n 's/^UI_PORT=\([0-9]*\).*/\1/p' "$REPO/.env" 2>/dev/null | tail -1)"
PORT="${PORT:-8080}"

# Written for macOS today and Linux next, since this moves to a small box later.
lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    for i in en0 en1 en2; do
      ip="$(ipconfig getifaddr "$i" 2>/dev/null)" && [ -n "$ip" ] && { echo "$ip"; return; }
    done
  fi
  if command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')" && [ -n "$ip" ] && { echo "$ip"; return; }
  fi
  if command -v ip >/dev/null 2>&1; then
    ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}'
  fi
}

IP="$(lan_ip)"
if command -v scutil >/dev/null 2>&1; then
  HOSTNAME_LOCAL="$(scutil --get LocalHostName 2>/dev/null).local"
else
  HOSTNAME_LOCAL="$(hostname -s 2>/dev/null).local"
fi

echo "Installed ${LABEL}"
echo "  repo: $REPO"
echo "  logs: $LOG"
echo

# Confirm it is actually answering rather than printing a URL we merely hope
# works - the daemon takes a moment to bind, and a failure here is the difference
# between "wrong address" and "did not start".
if [ -n "$IP" ]; then
  printf "  dashboard: http://%s:%s/" "$IP" "$PORT"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null -m 2 "http://127.0.0.1:${PORT}/api/state" 2>/dev/null; then
      printf "  (responding)\n"
      break
    fi
    sleep 1
  done
  case "$(curl -fsS -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:${PORT}/api/state" 2>/dev/null)" in
    2*|5*) : ;;                      # 503 just means "no reading yet", which is fine
    *) printf "  (NOT responding yet - check the log)\n" ;;
  esac
  echo "             http://${HOSTNAME_LOCAL}:${PORT}/   (follows the machine if DHCP moves it)"
else
  echo "  dashboard: http://<this machine>:${PORT}/   (could not detect the LAN address)"
fi

echo
echo "  Bookmark the address on the tablet. If it ever stops loading, the IP has"
echo "  most likely changed - re-run this script to print the current one, or give"
echo "  this machine a DHCP reservation in your router so it never moves."
echo
echo "  status:  launchctl list | grep ${LABEL##*.}"
echo "  follow:  tail -f $LOG"
echo "  stop:    ./deploy/install.sh uninstall"
