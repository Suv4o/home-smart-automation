#!/bin/bash
# Keeps the USB Wi-Fi adapter alive. Runs once a minute as root, from
# wifi-watchdog.timer.
#
# Why this exists: on 2026-10-25 the server dropped off the network for three
# hours while looking perfectly healthy to itself. The Realtek USB adapter
# (rtw88_8821cu) stopped transmitting but stayed associated and kept receiving,
# so the kernel, wpa_supplicant and systemd-networkd all logged nothing - there
# was no disconnect for any of them to react to. Unplugging and re-plugging the
# adapter fixed it instantly. This does the same thing in software, but only
# once the link has been verifiably dead for a few minutes.
#
# Settings, for testing by hand - all optional:
#   WIFI_WATCHDOG_DRY_RUN=1   say what it would do, change nothing (no root needed)
#   WIFI_WATCHDOG_STATE=path  where the failure count lives
#   WIFI_WATCHDOG_TARGET=ip   what to ping instead of the default gateway
set -u

DRY_RUN=${WIFI_WATCHDOG_DRY_RUN:-0}
STATE=${WIFI_WATCHDOG_STATE:-/run/wifi-watchdog.failures}
# Consecutive failed checks, one a minute, before resetting. Three minutes is
# long enough to sit out a router reboot, and short enough that an outage like
# the one above costs minutes rather than hours.
THRESHOLD=3

act() {
	if [ "$DRY_RUN" = 1 ]; then echo "[dry run] would: $*"; else eval "$@"; fi
}

WIFI=$(ls /sys/class/net | grep -m1 '^wl') || { echo "no wireless interface present"; exit 0; }

# 1. Power save off. A re-plugged or reset adapter comes back with the driver's
#    default, which is on - so a setting applied once at boot quietly lapses
#    after the very recovery this script exists to perform. Re-asserted on every
#    run; only logged when it actually changes something.
if iw dev "$WIFI" get power_save 2>/dev/null | grep -q ': on'; then
	act "iw dev '$WIFI' set power_save off"
	[ "$DRY_RUN" = 1 ] || echo "power save was on for $WIFI - turned it off"
fi

# 2. Can we reach the router? The router, not the internet: an ISP outage is not
#    the adapter's fault, and resetting it would not help.
TARGET=${WIFI_WATCHDOG_TARGET:-$(ip -4 route show default dev "$WIFI" 2>/dev/null | awk '{print $3; exit}')}
if [ -n "$TARGET" ] && ping -c 3 -W 2 -I "$WIFI" "$TARGET" >/dev/null 2>&1; then
	[ -f "$STATE" ] && echo "link to $TARGET is back"
	rm -f "$STATE"
	exit 0
fi

n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$STATE"
echo "cannot reach ${TARGET:-the router (no default route)} via $WIFI - check $n of $THRESHOLD"
[ "$n" -lt "$THRESHOLD" ] && exit 0

# 3. Reset the adapter. De-authorising its USB device and authorising it again
#    makes the kernel drop the device and probe it from scratch: the driver
#    powers the chip back up and reloads its firmware, as on a physical re-plug.
DEV=$(basename "$(dirname "$(readlink -f "/sys/class/net/$WIFI/device")")")
AUTH="/sys/bus/usb/devices/$DEV/authorized"
if [ ! -e "$AUTH" ]; then
	echo "no USB device behind $WIFI (resolved '$DEV') - not resetting"
	exit 1
fi
echo "resetting USB device $DEV behind $WIFI"
act "echo 0 > '$AUTH'"
act "sleep 3"
act "echo 1 > '$AUTH'"
rm -f "$STATE"
