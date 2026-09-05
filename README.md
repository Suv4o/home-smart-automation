# home-smart-automation

Charges an EV (via a Tapo P110 smart plug) on a schedule that follows a
Melbourne household's solar, battery, and free-power windows. It runs as a
**Node daemon** (a `node-cron` scheduler) on an always-on Mac at home, kept alive
by `launchd` — every 30 minutes it reads the stats, decides, and switches the plug.

Node 24 + TypeScript (run natively, no build step) for the Solarman read and the
policy; a small Python CLI for local plug control.

## How it works

```
node src/cli.ts watch  (daemon, kept alive by launchd)
  └─ every :00 and :30
       ├─ Solarman snapshot   (TS, cloud)      battery %, solar W, house W
       ├─ plug state          (Python → LAN)   python-kasa to the P110
       ├─ decide(Melbourne time, …)            (TS, pure policy)
       ├─ car battery %       (tesla-control → BLE)   only if about to charge
       └─ plug on/off         (Python → LAN)
```

It runs at home because the **Tapo P110 can only be controlled on the local
network** — there's no working cloud path for it. Solarman is a cloud API, so
that half works from anywhere. Everything is stateless: the only "memory" is the
plug's own on/off state, which it keeps between runs.

### The policy (Melbourne local time)

The day is three windows:

| Window | When | Rule |
| --- | --- | --- |
| **Free power** | 10:00–14:00 | **Always charge** (grid is free; battery charges too, so no floor) |
| **Morning battery share** | 05:00–10:00 | Start if battery **> 40%**; keep going while the plug is on; **stop at ≤ 15%** |
| **Solar surplus** | after 14:00, overnight | Charge iff **solar ≥ 70% × (house + 2 kW car)** — *unless* the sun is up **and** the house battery is above `BATTERY_BYPASS_PCT` (80 %), in which case charge regardless |

**Safety override (all windows, incl. free power):** never charge if grid import
plus the car's draw would exceed `MAIN_SWITCH_LIMIT_W` (default 10 kW, protecting a
50 A / ~11.5 kW main breaker). If the car is already charging and total import
climbs over the limit, it's switched off. E.g. 7 kW import + 2 kW car = 9 kW →
allowed; 9 kW + 2 kW = 11 kW → blocked.

**Car battery gate:** once every *other* rule says "charge", it checks the car's
own battery and skips charging if it's already at/above `CAR_MAX_SOC` (default
80 %). Reading the car (over Bluetooth via Tesla's `tesla-control`) wakes it, so
the reading is cached for `CAR_SOC_TTL_MINUTES` (default 60) and the car is only
read when a charge is otherwise warranted — never on blocked/overnight ticks. See
[docs/tesla.md](docs/tesla.md).

The morning rule reproduces "if the battery is above 40% at 5am, charge until it
drops to 15%" without storing anything: `> 40%` only *starts* a session, and the
plug being on carries it forward as the battery falls, until the 15% floor. See
`src/engine/policy.ts` and the scenario tests.

**Full-battery bypass:** in the solar window, while the sun is producing
(`solar > 0`) and the house battery is above `BATTERY_BYPASS_PCT`, there's nothing
left to soak up the surplus — so the car charges without the coverage test. The
`solar > 0` condition keeps this to daylight: at night a full house battery is
never drained into the car.

## Setup & running

See **[docs/running-locally.md](docs/running-locally.md)** for the full walk-through:
Node + Python deps, `.env`, seeding Solarman auth, a smoke test, and installing
the `launchd` schedule. In short:

```sh
npm install
brew install uv                 # plug CLI deps are fetched by uv (inline, cached)
cp .env.example .env            # fill in TAPO_USERNAME/PASSWORD (+ TAPO_HOST)
node --env-file=.env src/cli.ts seed <refresh-token>   # Solarman auth, once
node --env-file=.env src/cli.ts run --dry-run          # decide + log, no switch
```

Commands:

```sh
node --env-file=.env src/cli.ts run [--dry-run]   # one tick (what launchd runs)
node --env-file=.env src/cli.ts snapshot          # one Solarman reading
node --env-file=.env src/cli.ts charger status|on|off
node --env-file=.env src/cli.ts car soc            # read the car battery % (wakes it)
node --env-file=.env src/cli.ts seed <token>
npm run typecheck && npm test
```

## Trying it out

Work up from reading the plug to running it live, in order.

**1. Read the plug.** Confirms the LAN + credentials work.

```sh
node --env-file=.env src/cli.ts charger status
# → e.g.  OFF  drawing 0W
```

**2. Prove switching works.** The plug should audibly click.

```sh
node --env-file=.env src/cli.ts charger on
node --env-file=.env src/cli.ts charger off
```

**3. See the decision without acting.** Reads everything, logs the Melbourne
time, window (`morning`/`free`/`solar`), battery %, solar/load, and the `on`/`off`
decision with its reason — but switches nothing.

```sh
node --env-file=.env src/cli.ts run --dry-run
```

**4. One real tick by hand.** Same as above, but this one **will** switch the plug
per the policy. Watch it do the right thing for the current window.

```sh
node --env-file=.env src/cli.ts run
```

**5. Run it on a schedule.** Install the daemon (a `node-cron` scheduler kept
alive by `launchd`); it ticks at :00 and :30, plus once immediately.

```sh
./deploy/install.sh                          # generates the plist and starts it
tail -f ~/Library/Logs/home-automation.log   # watch the ticks
launchctl list | grep home-automation        # confirm it's alive (shows a PID)
```

The interval is the `SCHEDULE_CRON` env var (default `0,30 * * * *` = :00 and :30).
Change it in `.env` — e.g. `*/15 * * * *` for every 15 minutes — then restart the
daemon with `./deploy/install.sh` to pick it up.

To stop it:

```sh
./deploy/install.sh uninstall
```

Before trusting it live, two checks:
- **`CAR_POWER_W`** in `.env` is `2000`; set it to `2400` if your charger draws
  10 A at 240 V, so the after-2pm surplus maths is right.
- **Sanity-check the numbers** from a midday `run --dry-run` (when you're
  exporting) against the dashboard — especially the derived grid figure. Leaving
  it on `--dry-run` for the first sunny day is a safe way to watch its decisions.

Full walk-through (deps, auth seeding, daemon details) is in
[docs/running-locally.md](docs/running-locally.md).

## Authentication

Solarman login is behind Cloudflare Turnstile, so you seed a **refresh token**
from a logged-in browser once and the client renews itself (~24 h access token,
~6-month refresh token). Full steps + the console snippet in
**[docs/authentication.md](docs/authentication.md)**.

## Data source

`SOLARMAN_STATION_ID` drives two calls per snapshot (captured from the web app):
`GET /maintain-s/fast/system/{id}` (generation, load, charge/discharge) and
`GET /maintain-s/operating/system/{id}` (`batterySoc`). Grid power is **derived**
from the energy balance rather than read, because the sign of the reported grid
fields couldn't be confirmed.

## Plug control

`scripts/plug_local.py` controls the P110 on the LAN via `python-kasa` (KLAP),
using the TP-Link account the plug is registered to. It connects to `TAPO_HOST`
directly, and if that IP is unreachable (e.g. DHCP moved the plug after a power
cut) it scans the LAN and finds the plug by name — so an IP change self-heals.
A DHCP reservation in your router avoids the scan; find the current IP with
`uv run --script scripts/plug_local.py discover`. Cloud control was
investigated and doesn't work: `tplink-cloud-api` only sees TP-Link's *Kasa*
cloud, and the P110 lives in the *Tapo* cloud — it authenticates the account but
can't see the plug. Local control is the reliable path (it's what the
[tapo-smart-plug](https://github.com/Suv4o/tapo-smart-plug) repo does too).
