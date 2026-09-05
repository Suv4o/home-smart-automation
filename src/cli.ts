import { parseArgs } from "node:util";
import { schedule, validate } from "node-cron";
import { TeslaCar } from "./car/tesla.ts";
import { DryRunCharger } from "./charger/dry-run.ts";
import { TapoCliCharger } from "./charger/tapo-cli.ts";
import type { ChargerController } from "./charger/types.ts";
import { loadConfig } from "./config.ts";
import { applyCarSocGate, type CarSoc, decide } from "./engine/policy.ts";
import { logger } from "./logger.ts";
import { seedRefreshToken, SolarmanWebProvider, tokenCachePath } from "./providers/solarman-web.ts";
import { melbourneClock } from "./time.ts";

const USAGE = `
home-smart-automation

  watch [--dry-run]              Long-running daemon: run a tick at :00 and :30 forever
  run [--dry-run]                One tick: read stats, decide, switch the plug
  seed <refresh-token>           Seed Solarman auth from a browser session's refresh token
  snapshot [--json] [--raw]      Print one reading of the system
  charger <status|on|off>        Read or switch the Tapo plug directly
  car soc                        Read the car battery % (wakes the car; uses cache)

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
			return watch(config, values["dry-run"]);

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
			const reading = await car.soc();
			if (!reading) {
				console.error("Could not read the car (asleep/out of range, and no cached value).");
				return 1;
			}
			console.log(`  car battery ${reading.soc}%${reading.stale ? " (cached)" : ""}`);
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

	const base = decide({ minutesOfDay: clock.minutesOfDay, snapshot, charger: chargerState, config: config.policy });

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
async function watch(config: ReturnType<typeof loadConfig>, dryRun: boolean): Promise<number> {
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

	await tick(); // run immediately so startup is observable

	// noOverlap guards against a slow tick still running when the next fires.
	const task = schedule(expression, tick, { name: "home-automation-tick", noOverlap: true });

	await new Promise<void>((resolve) => {
		const stop = (signal: string): void => {
			logger.info({ signal }, "stopping scheduler");
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
