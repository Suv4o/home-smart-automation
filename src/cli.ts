import { parseArgs } from "node:util";
import { schedule, validate } from "node-cron";
import { TeslaCar } from "./car/tesla.ts";
import { DryRunCharger } from "./charger/dry-run.ts";
import { TapoCliCharger } from "./charger/tapo-cli.ts";
import type { ChargerController } from "./charger/types.ts";
import { loadConfig } from "./config.ts";
import { chargeState, overrideAction } from "./engine/charge-state.ts";
import { clearOverride, loadOverride, markOverrideCharging } from "./engine/override.ts";
import { applyCarSocGate, type CarSoc, decide } from "./engine/policy.ts";
import { logger } from "./logger.ts";
import { seedRefreshToken, SolarmanWebProvider, tokenCachePath } from "./providers/solarman-web.ts";
import { startDemo } from "./server/demo.ts";
import { startServer } from "./server/index.ts";
import { StateStore } from "./server/state.ts";
import { World } from "./server/world.ts";
import { melbourneClock } from "./time.ts";

const USAGE = `
home-smart-automation

  watch [--dry-run] [--demo]     Long-running daemon; --demo cycles scripted display states
  run [--dry-run]                One tick: read stats, decide, switch the plug
  seed <refresh-token>           Seed Solarman auth from a browser session's refresh token
  snapshot [--json] [--raw]      Print one reading of the system
  charger <status|on|off>        Read or switch the Tapo plug directly
  car soc [--raw]                Read the car battery % (wakes the car; uses cache)
                                 --raw prints the car's whole charge state as JSON

In CI, secrets are set as env vars. Locally, prefix with: node --env-file=.env src/cli.ts <command>
`.trim();

const SEED_HINT =
	"Seed a Solarman refresh token from a logged-in browser (see docs/authentication.md):\n" +
	"  node --env-file=.env src/cli.ts seed <refresh-token>";

function makeProvider(config: ReturnType<typeof loadConfig>): SolarmanWebProvider {
	return new SolarmanWebProvider(config.solarman.email, config.solarman.password, config.solarman.stationId);
}

async function main(): Promise<number> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			json: { type: "boolean", default: false },
			raw: { type: "boolean", default: false },
			"dry-run": { type: "boolean", default: false },
			demo: { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
	});

	const command = positionals[0];
	if (values.help || command === undefined) {
		console.log(USAGE);
		return command === undefined && !values.help ? 1 : 0;
	}

	const config = loadConfig();

	switch (command) {
		case "run":
			return runOnce(config, values["dry-run"]);

		case "watch":
			return watch(config, values["dry-run"], values.demo);

		case "seed": {
			const token = positionals[1];
			if (!token) {
				console.error(`Usage: seed <refresh-token>\n\n${SEED_HINT}`);
				return 1;
			}
			await seedRefreshToken(token);
			logger.info({ cache: tokenCachePath() }, "refresh token seeded - verifying");
			await makeProvider(config).snapshot();
			logger.info("verified: fetched a live snapshot with the seeded token");
			return 0;
		}

		case "snapshot": {
			const provider = makeProvider(config);
			const snapshot = await provider.snapshot();
			if (values.raw) console.log(JSON.stringify(provider.lastRaw(), null, 2));
			else if (values.json) console.log(JSON.stringify(snapshot, null, 2));
			else {
				const sign = (w: number): string => `${w >= 0 ? "+" : ""}${Math.round(w)}W`;
				console.log(
					[
						`  time     ${snapshot.at.toLocaleString()}`,
						`  solar    ${Math.round(snapshot.solarW)}W`,
						`  load     ${Math.round(snapshot.loadW)}W`,
						`  battery  ${snapshot.batterySoc}%  ${sign(snapshot.batteryW)} (+charging)`,
						`  grid     ${sign(snapshot.gridW)} (+importing)`,
					].join("\n"),
				);
			}
			await provider.close();
			return 0;
		}

		case "charger": {
			const charger = new TapoCliCharger(config.tapo.cliCmd);
			const sub = positionals[1] ?? "status";
			if (sub === "status") {
				const s = await charger.state();
				console.log(`  ${s.on ? "ON" : "OFF"}  drawing ${Math.round(s.powerW)}W`);
				return 0;
			}
			if (sub === "on") return charger.on().then(() => 0);
			if (sub === "off") return charger.off().then(() => 0);
			console.error(`Unknown charger subcommand: ${sub}`);
			return 1;
		}

		case "car": {
			if ((positionals[1] ?? "soc") !== "soc") {
				console.error(`Unknown car subcommand: ${positionals[1]}`);
				return 1;
			}
			const car = new TeslaCar(config.car.controlCmd, config.car.socTtlMs);

			// --raw dumps what the car actually sent, which is the way to check
			// whether this firmware reports a remaining-charge time at all.
			if (values.raw) {
				console.log((await car.rawChargeState()).trim());
				return 0;
			}

			const reading = await car.soc();
			if (!reading) {
				console.error("Could not read the car (asleep/out of range, and no cached value).");
				return 1;
			}
			console.log(`  car battery ${reading.soc}%${reading.stale ? " (cached)" : ""}`);

			const cached = await car.cachedSoc();
			if (cached?.chargeLimit != null) console.log(`  charge limit ${cached.chargeLimit}%`);
			if (cached?.minutesToFull != null) {
				const h = Math.floor(cached.minutesToFull / 60);
				const m = cached.minutesToFull % 60;
				console.log(`  time to full ${h ? h + "h " : ""}${m}m (as the car reported it)`);
			} else {
				console.log("  time to full  not reported (expected unless the car is charging)");
			}
			return 0;
		}

		default:
			console.error(`Unknown command: ${command}\n\n${USAGE}`);
			return 1;
	}
}

/**
 * The heart of the cron job: read the world, decide, and set the plug to the
 * decided state (only switching if it differs). Any read failure leaves the
 * plug untouched - not knowing the state of the world is a reason to hold, never
 * to guess.
 */
async function runOnce(config: ReturnType<typeof loadConfig>, dryRun: boolean): Promise<number> {
	const provider = makeProvider(config);
	const charger = new TapoCliCharger(config.tapo.cliCmd);

	const clock = melbourneClock();
	const [snapshot, chargerState] = await Promise.all([provider.snapshot(), charger.state()]);

	// An override that asked to stop when the car finishes is settled here, before
	// the decision - so the same tick that notices it is done also hands the plug
	// back to the schedule.
	let override = await loadOverride();
	const charge = chargeState(chargerState, config.car.drawMinW);
	switch (overrideAction(override, charge)) {
		case "release":
			await clearOverride();
			logger.info("car stopped drawing — override released, back to automatic");
			override = null;
			break;
		case "mark-charging":
			if (override) override = await markOverrideCharging(override);
			break;
		default:
			break;
	}

	const base = decide({
		minutesOfDay: clock.minutesOfDay,
		snapshot,
		charger: chargerState,
		config: config.policy,
		override,
	});

	// Only wake the car once everything else already says "charge" - reading the
	// car's battery wakes it, and it's cached (TTL) so consecutive ticks don't.
	let decision = base;
	let carSoc: CarSoc | null = null;
	if (base.action === "on") {
		carSoc = await new TeslaCar(config.car.controlCmd, config.car.socTtlMs).soc();
		decision = applyCarSocGate(base, carSoc, chargerState, config.policy);
	}

	logger.info(
		{
			melbourne: `${clock.weekday} ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
			window: decision.window,
			soc: snapshot.batterySoc,
			solarW: Math.round(snapshot.solarW),
			loadW: Math.round(snapshot.loadW),
			// Grid drives the main-switch guard, so it must be visible in the log.
			gridW: Math.round(snapshot.gridW),
			batteryW: Math.round(snapshot.batteryW),
			plugOn: chargerState.on,
			plugW: Math.round(chargerState.powerW),
			carSoc: carSoc ? carSoc.soc : undefined,
			override: override ? override.mode : undefined,
			decision: decision.action,
		},
		decision.reason,
	);

	if (chargerState.on === (decision.action === "on")) {
		logger.info(`plug already ${decision.action.toUpperCase()} — no change`);
		return 0;
	}

	const target: ChargerController = dryRun ? new DryRunCharger(charger) : charger;
	if (dryRun) logger.warn("dry-run — not switching the plug");
	if (decision.action === "on") await target.on();
	else await target.off();
	return 0;
}

/**
 * Long-running scheduler: fires a tick on the wall clock at :00 and :30, plus
 * once at startup. A failing tick is logged and swallowed so the daemon keeps
 * running - the next tick re-reads the world from scratch. Kept alive across
 * reboots/crashes by the launchd job in deploy/ (KeepAlive).
 */
async function watch(config: ReturnType<typeof loadConfig>, dryRun: boolean, demo = false): Promise<number> {
	const expression = config.scheduleCron;
	if (!validate(expression)) {
		throw new Error(`SCHEDULE_CRON is not a valid cron expression: ${JSON.stringify(expression)}`);
	}
	logger.info({ dryRun, schedule: expression }, "starting scheduler daemon");

	const tick = async (): Promise<void> => {
		try {
			await runOnce(config, dryRun);
		} catch (err) {
			logger.error({ err: err instanceof Error ? err.message : String(err) }, "tick failed — holding, will retry next tick");
		}
	};

	// The dashboard shares one World with the scheduler, so the screen and the
	// decisions always agree. The display loop refreshes far more often than the
	// decision tick, but only ever reads - it never wakes the car or switches.
	const controller = new AbortController();
	const store = new StateStore();
	const car = new TeslaCar(config.car.controlCmd, config.car.socTtlMs);
	const world = new World(
		makeProvider(config),
		new TapoCliCharger(config.tapo.cliCmd),
		car,
		config,
		store,
	);
	startServer({ config, store, world, car, runTick: demo ? async () => undefined : tick }, controller.signal);
	if (demo) {
		logger.warn("demo mode — cycling scripted states; nothing is read or switched");
		startDemo(config, store, controller.signal);
	} else {
		world.start(controller.signal);
	}

	if (!demo) await tick(); // run immediately so startup is observable

	// noOverlap guards against a slow tick still running when the next fires.
	const task = schedule(expression, demo ? async () => undefined : tick, {
		name: "home-automation-tick",
		noOverlap: true,
	});

	await new Promise<void>((resolve) => {
		const stop = (signal: string): void => {
			logger.info({ signal }, "stopping scheduler");
			controller.abort();
			void task.stop();
			resolve();
		};
		process.on("SIGINT", () => stop("SIGINT"));
		process.on("SIGTERM", () => stop("SIGTERM"));
	});
	return 0;
}

try {
	process.exitCode = await main();
} catch (err) {
	logger.error(err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
}
