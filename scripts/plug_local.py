#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-kasa>=0.10,<0.11"]
# ///
"""Control a Tapo P110 on the LOCAL network via python-kasa (KLAP).

Run with `uv run --script scripts/plug_local.py <state|on|off|discover>` — uv
reads the inline dependency block above and fetches python-kasa itself (cached
after the first run), so there's no venv or pip step to manage.

The automation runs from a machine on the same network as the plug, so it talks
to the plug directly by IP — no cloud, which the Tapo P110 doesn't support for
third-party control anyway.

Reaching the plug:
  1. Fast path — connect to TAPO_HOST directly.
  2. If that IP is unreachable (e.g. DHCP moved it after a power cut), fall back
     to scanning the LAN and matching the plug by name (TAPO_ALIAS). It logs the
     IP it found so you can update TAPO_HOST / add a DHCP reservation.

Usage:
    plug_local.py state      # -> {"on": bool, "powerW": number} on stdout
    plug_local.py on
    plug_local.py off
    plug_local.py discover   # list Tapo/Kasa devices + IPs on the LAN

Environment (same names as the tapo-smart-plug repo, so creds can be copied over):
    TAPO_HOST       the plug's LAN IP (e.g. 192.168.1.50); optional if discoverable
    TAPO_USERNAME   TP-Link account email the plug is registered to
    TAPO_PASSWORD   that account's password
    TAPO_ALIAS      plug name to match during LAN fallback (optional; needed only
                    if you have more than one Tapo/Kasa device)

Only `state` prints machine-readable JSON to stdout; everything else -> stderr.
"""

import asyncio
import json
import os
import sys


def eprint(*a: object) -> None:
    print(*a, file=sys.stderr)


def _load_env_file() -> None:
    """Fill missing env vars from the repo's .env, so the script also works when
    run by hand (`uv run --script …`). Values already in the environment win, so
    this never overrides what the daemon passes via `node --env-file`."""
    from pathlib import Path

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


async def _safe_disconnect(dev) -> None:
    try:
        await dev.disconnect()
    except Exception:  # noqa: BLE001 - best-effort cleanup
        pass


async def resolve_device(creds, host: str, alias: str):
    """Return a connected device, trying TAPO_HOST first then a LAN scan."""
    from kasa import Discover
    from kasa.exceptions import AuthenticationError, KasaException

    if host:
        try:
            return await Discover.discover_single(host, credentials=creds), host
        except AuthenticationError:
            raise  # a creds problem won't be fixed by scanning
        except (KasaException, OSError) as exc:
            eprint(f"note: plug not reachable at {host} ({type(exc).__name__}); scanning the LAN…")

    found = await Discover.discover(credentials=creds, timeout=6)
    if not found:
        raise SystemExit("No Tapo/Kasa device found on the LAN. Is the plug powered on and joined to Wi-Fi?")

    # Populate alias/state so we can match and report.
    for dev in found.values():
        try:
            await dev.update()
        except Exception:  # noqa: BLE001 - a device we won't pick may fail; ignore
            pass

    items = list(found.items())  # [(ip, device), ...]
    if alias:
        matches = [(ip, d) for ip, d in items if (d.alias or "") == alias]
        if not matches:
            names = ", ".join(f"{d.alias!r}@{ip}" for ip, d in items)
            for _ip, d in items:
                await _safe_disconnect(d)
            raise SystemExit(f"No device named {alias!r} on the LAN. Found: {names}. Fix TAPO_ALIAS.")
        chosen = matches[0]
    elif len(items) == 1:
        chosen = items[0]
    else:
        names = ", ".join(f"{d.alias!r}@{ip}" for ip, d in items)
        for _ip, d in items:
            await _safe_disconnect(d)
        raise SystemExit(f"Multiple devices found ({names}); set TAPO_ALIAS to pick one.")

    chosen_ip, chosen_dev = chosen
    for ip, d in items:
        if d is not chosen_dev:
            await _safe_disconnect(d)
    eprint(f"found plug at {chosen_ip}. Set TAPO_HOST={chosen_ip} (or add a DHCP reservation) to skip scanning.")
    return chosen_dev, chosen_ip


async def do_discover(creds) -> int:
    from kasa import Discover

    found = await Discover.discover(credentials=creds, timeout=6)
    if not found:
        print("No Tapo/Kasa devices found on the LAN.")
        return 0
    for ip, dev in found.items():
        try:
            await dev.update()
            print(f"{ip}  alias={dev.alias!r}  model={getattr(dev, 'model', '?')}  on={dev.is_on}")
        except Exception as exc:  # noqa: BLE001
            print(f"{ip}  (found, but update failed: {type(exc).__name__})")
        finally:
            await _safe_disconnect(dev)
    return 0


async def run(command: str) -> int:
    _load_env_file()
    username = os.environ.get("TAPO_USERNAME", "").strip()
    password = os.environ.get("TAPO_PASSWORD", "").strip()
    host = os.environ.get("TAPO_HOST", "").strip()
    alias = os.environ.get("TAPO_ALIAS", "").strip()
    missing = [n for n, v in (("TAPO_USERNAME", username), ("TAPO_PASSWORD", password)) if not v]
    if missing:
        raise SystemExit(f"Missing required env var(s): {', '.join(missing)}.")

    from kasa import Credentials
    from kasa.exceptions import AuthenticationError, KasaException

    creds = Credentials(username, password)

    if command == "discover":
        return await do_discover(creds)

    dev = None
    try:
        dev, ip = await resolve_device(creds, host, alias)
        if command == "on":
            await dev.turn_on()
            eprint(f"{ip}: switched ON")
        elif command == "off":
            await dev.turn_off()
            eprint(f"{ip}: switched OFF")
        else:  # state
            await dev.update()
            energy = dev.modules.get("Energy")
            power = getattr(energy, "current_consumption", None) if energy else None
            print(json.dumps({"on": bool(dev.is_on), "powerW": float(power) if power is not None else 0.0}))
        return 0
    except AuthenticationError as exc:
        raise SystemExit(
            f"Auth rejected by the plug: {exc} TAPO_USERNAME/PASSWORD must be the TP-Link account the "
            f"plug is registered to (case-sensitive) — copy them from your tapo-smart-plug repo's .env."
        )
    except KasaException as exc:
        raise SystemExit(f"Could not reach the plug: {exc} Check the network, or run `discover` to find its IP.")
    finally:
        if dev is not None:
            await _safe_disconnect(dev)


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in ("state", "on", "off", "discover"):
        eprint(__doc__)
        return 2
    return asyncio.run(run(argv[0]))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
