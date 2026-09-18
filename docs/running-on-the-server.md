# Running on the home server (Ubuntu, systemd)

The automation lives on **home-server-dell**, a Dell OptiPlex 7040 Micro running
Ubuntu Server. This is the page to open when something looks wrong at 11pm — it
assumes you have forgotten everything, because eventually you will have.

The Mac equivalent of this page is
[docs/running-locally.md](running-locally.md). Only one machine should run the
daemon at a time; see *Never run both* at the bottom for why that matters more
than it sounds.

## Getting in

```sh
ssh home-server-dell
```

That alias is in `~/.ssh/config` on the Mac:

```
Host home-server-dell
    HostName home-server-dell.local
    User <user>
    IdentityFile ~/.ssh/home-server-dell
    AddKeysToAgent yes
    UseKeychain yes
    ServerAliveInterval 30
    ServerAliveCountMax 6
```

Password logins are disabled (`/etc/ssh/sshd_config.d/10-hardening.conf`), so
the key is the only way in. `ServerAliveInterval` is what stops an idle session
being dropped by the router's NAT table while you read something.

**If `ssh home-server-dell` hangs**, it is name resolution, not the host. Fall
back to the address and diagnose from there:

```sh
ssh <user>@192.168.1.23        # DHCP-reserved, so this is stable
```

See *avahi renames the machine* below.

## Two names, on purpose

| Name | Points at | Published by |
| --- | --- | --- |
| `home-server-dell.local` | the machine | avahi's own hostname |
| `home-automation.local` | the dashboard | `home-automation-name.service` |

The machine is a general-purpose home server; the charging automation is one
service on it. Keeping the names separate means the tablet's bookmark
(`http://home-automation.local:8080/`) survives the automation moving to
different hardware one day.

## Day to day

```sh
systemctl status home-automation --no-pager    # is it alive?
journalctl -u home-automation -f               # follow the log
journalctl -u home-automation -n 100           # last 100 lines
journalctl -u home-automation --since "1 hour ago"
sudo systemctl restart home-automation         # after changing .env
```

### Same thing, both machines

| On the Mac (launchd) | On the Dell (systemd) |
| --- | --- |
| `./deploy/install.sh` | `sudo systemctl enable --now home-automation` |
| `./deploy/install.sh uninstall` | `sudo systemctl disable --now home-automation` |
| `launchctl kickstart -k gui/$(id -u)/com.<user>.home-automation` | `sudo systemctl restart home-automation` |
| `tail -f ~/Library/Logs/home-automation.log` | `journalctl -u home-automation -f` |
| `launchctl list \| grep home-automation` | `systemctl is-enabled home-automation` |

`enable` means "start at boot"; `--now` also starts it immediately. `disable
--now` is the pair of that, and is what you want before doing surgery — a plain
`stop` lets it come back on the next reboot.

## tmux — for anything longer than a few seconds

The server is on Wi-Fi. If the link drops mid-`apt`, a plain SSH session takes
the command down with it and can leave the package database half-written. Run
long jobs inside tmux and they survive:

```sh
tmux new -s work        # start a named session
tmux attach -t work     # reconnect after a dropout
tmux ls                 # what sessions exist?
```

Inside a session, the prefix is **Ctrl-b**, then:

| Keys | Does |
| --- | --- |
| `Ctrl-b` then `d` | **detach** — leaves everything running |
| `Ctrl-b` then `c` | new window |
| `Ctrl-b` then `n` / `p` | next / previous window |
| `Ctrl-b` then `[` | scroll back (`q` to exit scroll mode) |

Detaching is the one that matters. Closing the terminal without detaching is
fine too — tmux keeps running and `tmux attach` picks it up.

## Where things live

| What | Where |
| --- | --- |
| The repo | `~/home-smart-automation` |
| Service unit | `/etc/systemd/system/home-automation.service` |
| Launcher (loads nvm, then execs node) | `deploy/run-daemon-linux.sh` |
| Config and secrets | `~/home-smart-automation/.env` |
| Solarman refresh token | `~/.config/home-automation/solarman.token.json` |
| Learned PV calibration | `~/.config/home-automation/solar-calibration.json` |
| Tesla private key | `~/.tesla/private.pem` (mode 600 — this is a car key) |
| `tesla-control` source | `~/vehicle-command` |

Everything in the bottom half of that table is outside the repo and **not in
git**. It does not come back from a `git clone`; it has to be copied by hand.

## Testing pieces individually

```sh
cd ~/home-smart-automation

uv run --script scripts/plug_local.py state   # the plug
node --env-file=.env src/cli.ts snapshot      # Solarman
node --env-file=.env src/cli.ts car soc       # the car, over BLE
npm test
```

## Things that have actually gone wrong

### `node: command not found`, but only sometimes

nvm is a shell function loaded from `.bashrc`, and Ubuntu's `.bashrc` returns
early for non-interactive shells. So `node` works when you are logged in and
vanishes under `ssh host "command"`, cron, or systemd.

This is why the service runs `deploy/run-daemon-linux.sh` rather than calling
node directly — the script sources nvm and uses whatever `nvm alias default`
names. To change Node version:

```sh
nvm install 26 && nvm alias default 26
sudo systemctl restart home-automation     # the restart is what applies it
```

`nvm use` in your own shell does **not** change what the daemon runs.

### avahi renames the machine

avahi claims `home-server-dell.local` on the network, and if it thinks another
device holds that name it steps aside and appends a number. The machine keeps
working perfectly — it just stops answering to the name, so `ssh
home-server-dell` hangs on a lookup that will never succeed.

```sh
avahi-resolve -a 192.168.1.23     # a bare name is healthy; -2, -3 … is not
sudo systemctl restart avahi-daemon
```

`use-ipv6=no` in `/etc/avahi/avahi-daemon.conf` stops it recurring — IPv6
address churn on a consumer router is a reliable way to trigger it.

### The Wi-Fi interface has a strange name

USB adapters are named `wlx` + their MAC, so this machine's is
`wlxa047d75fa07d` rather than `wlan0`. It **changes if the dongle is replaced**,
so derive it rather than typing it:

```sh
WIFI="$(ls /sys/class/net | grep -m1 '^wl')"
iw dev "$WIFI" link          # signal strength; worse than -70 dBm is trouble
```

Below −70 dBm, fix the signal rather than debugging intermittent failures.

### Car reads fail under systemd but work by hand

`tesla-control` needs raw Bluetooth access. Capabilities live on the file, so a
rebuilt or updated binary starts without them:

```sh
sudo setcap 'cap_net_admin=eip' ~/go/bin/tesla-control
getcap ~/go/bin/tesla-control
```

Updating it: `cd ~/vehicle-command && git pull && go install ./...`, then the
`setcap` again. Note it must be built from a clone — `go install pkg@latest`
refuses the module because its `go.mod` has `replace` directives.

### The plug moved

`TAPO_HOST` is a fixed address, and `scripts/plug_local.py` silently falls back
to scanning the LAN when it stops answering — so a wrong address costs a subnet
sweep on every tick instead of failing loudly.

```sh
uv run --script scripts/plug_local.py discover
```

Both the server and the plug have DHCP reservations in the router, so this
should not drift again.

## Never run both

The Solarman refresh token **rotates**: refreshing swaps it for a fresh pair, so
whichever machine refreshes first silently invalidates the other's copy. The
fallback is email-and-password login, which Cloudflare Turnstile blocks — the
only recovery is re-seeding a token from a logged-in browser by hand.

Two daemons would also fight over the plug, one switching it on while the other
switches it off.

So if you ever move the automation back to the Mac, or onto something else:

1. Stop the daemon on the machine that currently has it.
2. Copy `~/.config/home-automation/solarman.token.json` across **after** that.
3. Start the daemon on the new machine.

Never the other order.
