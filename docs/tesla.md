# Car battery via Tesla `tesla-control` (Bluetooth)

The "don't charge above `CAR_MAX_SOC`" rule needs the car's battery %, which only
the car knows. We read it with Tesla's official
[`tesla-control`](https://github.com/teslamotors/vehicle-command) CLI over
Bluetooth — no cloud, no account. Setup (pairing the Mac as a key, generating the
keypair) is covered in the blog post; this doc is what the automation needs.

## How the automation uses it

- The car is read **only when every other rule already says "charge"** — there's
  no point waking the car to confirm a "no".
- Reading `state charge` **wakes the car**, so a reading is cached
  (`CAR_SOC_TTL_MINUTES`, default 60) and reused. With a 10-minute tick, the car
  is actually queried roughly once an hour, not every tick.
- If the car is asleep the read fails with "context deadline exceeded"; the
  reader then sends `wake` and retries (BLE is also retried, since range is
  marginal). See `src/car/tesla.ts`.

## Config (in `.env`)

| Var | Meaning |
| --- | --- |
| `CAR_MAX_SOC` | Don't charge at/above this % (default 80). |
| `CAR_SOC_TTL_MINUTES` | How long to trust one reading before waking the car again (default 60). |
| `TESLA_CONTROL_CMD` | Binary name or path. `deploy/run-daemon.sh` puts `~/go/bin` on PATH, so plain `tesla-control` works. |
| `TESLA_KEY_NAME`, `TESLA_VIN`, `TESLA_CACHE_FILE` | Read by `tesla-control` itself. **Must be in `.env`** — the launchd daemon does not load your shell profile. |
| `CHARGE_IF_CAR_UNKNOWN` | If the car can't be read, charge anyway (default false = hold). |

Get your VIN with `echo $TESLA_VIN` in your normal terminal (you set it during
setup), or from the Tesla app.

## Test it

```sh
node --env-file=.env src/cli.ts car soc     # → "car battery 74%"
```

The first read wakes the car and may take 10–20 s; the next is instant (cached).

## Gotchas

- **Bluetooth permission under launchd.** macOS grants Bluetooth per responsible
  app. `tesla-control` works from Terminal.app because Terminal has Bluetooth
  access; the **launchd daemon is a different process** and may not. If a
  charging-window tick logs `tesla-control crashed (Abort trap: 6)`, that's a
  missing Bluetooth permission for the daemon — grant it, or set
  `CHARGE_IF_CAR_UNKNOWN=true` as a fallback (the car's own charge limit then
  backstops the 80%). Test with `car soc` from Terminal.app first.
- **Range.** The Mac must be within BLE range of the car (~10–30 m, less through
  walls). If reads routinely fail, the blog's ESP32 option is the robust fix.
- **The car sleeps on its own** and nothing here forces it awake except a read.
  That's why reads are cached and infrequent.
- **`state charge` output includes GPS** (`homeLocation`/`workLocation`). We only
  parse the battery level and never log the rest, but keep that in mind if you
  ever run the raw command and share its output.
- **Least privilege**: for a charging automation, a `charging_manager` key can
  read status without being able to unlock or drive — safer than `driver` if the
  Mac is lost.
