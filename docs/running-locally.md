# Running locally on the Mac (launchd, every 30 min)

The plug is controlled on the LAN, so this runs on a machine at home. On macOS,
`launchd` is more reliable than cron (it catches up missed runs after sleep).

## One-time setup

1. **Node deps**
   ```sh
   npm install
   ```

2. **uv** (for the plug CLI) — the script declares its own deps inline, so uv
   fetches python-kasa itself on first run (cached after). Just install uv:
   ```sh
   brew install uv
   ```

3. **Config**
   ```sh
   cp .env.example .env
   ```
   Fill in `TAPO_USERNAME` / `TAPO_PASSWORD` with the account the plug is
   registered to (copy from your `tapo-smart-plug` repo's `.env`), and confirm
   `TAPO_HOST` (e.g. `192.168.1.50`). `PLUG_CLI_CMD` already points at
   `uv run --script scripts/plug_local.py`.

4. **Seed Solarman auth** (see [authentication.md](authentication.md)):
   ```sh
   node --env-file=.env src/cli.ts seed <refresh-token>
   ```

5. **Smoke-test** before scheduling:
   ```sh
   node --env-file=.env src/cli.ts charger status     # reads the real plug
   node --env-file=.env src/cli.ts run --dry-run       # full decision, no switch
   ```

## Install the daemon

The tick runs inside a long-lived Node process (a `node-cron` scheduler). `launchd`
keeps that process alive — starting it at login and relaunching it if it crashes
or the Mac reboots.

```sh
./deploy/install.sh
```

It starts immediately, runs one tick right away, then ticks at :00 and :30.
Logs go to `~/Library/Logs/home-automation.log`:

```sh
tail -f ~/Library/Logs/home-automation.log
```

Check it's running / stop it:

```sh
launchctl list | grep home-automation    # shows PID if alive
./deploy/install.sh uninstall            # stop
```

Notes:
- **Interval**: set by `SCHEDULE_CRON` in `.env` (default `0,30 * * * *` = :00 and
  :30). Examples: `*/15 * * * *` (every 15 min), `0 * * * *` (hourly). After
  changing it, re-run `./deploy/install.sh`.
- `KeepAlive` relaunches the daemon on crash or reboot. `unload` stops it for good.
- If the Mac sleeps, the in-process timer pauses; on wake the daemon resumes and
  the next :00/:30 tick fires. The policy re-derives from the clock each time, so
  a skipped tick just means no change for that half hour.
- If you move the repo, just re-run `./deploy/install.sh` - it regenerates the
  plist with the new path.
- Run the daemon in the foreground to watch it directly: `npm run watch`.

## If the plug can't be reached (e.g. after a power cut)

Symptom in the log: `No route to host` / `Host is down` / `Timed out getting
discovery response`. Usually the router's DHCP gave the plug a new IP.

The daemon self-heals: when `TAPO_HOST` is unreachable it scans the LAN, finds
the plug by name, and keeps working (logging the IP it found). To make it fast
again — and avoid the ~6s scan each tick — either:

- set `TAPO_HOST` in `.env` to the IP it reported (then reload the daemon), or
- give the plug a **DHCP reservation** in your router so its IP never changes.

Find the current IP any time:

```sh
uv run --script scripts/plug_local.py discover
```
