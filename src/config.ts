import { z } from "zod";

/** "HH:MM" -> minutes since midnight. */
function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(":").map(Number) as [number, number];
	return h * 60 + m;
}

/** An "HH:MM" env var with a default, parsed to minutes since midnight. */
const hhmm = (def: string) =>
	z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM")
		.default(def)
		.transform(toMinutes);

const Schema = z
	.object({
		// --- Solarman ---
		SOLARMAN_STATION_ID: z.string().optional(),
		// Only used by the (Turnstile-blocked) password login path.
		SOLARMAN_EMAIL: z.string().optional(),
		SOLARMAN_PASSWORD: z.string().optional(),

		// --- Tapo plug (local control) ---
		// Command that runs the Python local plug CLI. It reads TAPO_HOST /
		// TAPO_USERNAME / TAPO_PASSWORD from the environment itself (they are
		// inherited by the child process from .env), so they are not parsed here.
		PLUG_CLI_CMD: z.string().default("uv run --script scripts/plug_local.py"),

		// --- Policy (Melbourne local time) ---
		MORNING_START: hhmm("05:00"),
		FREE_START: hhmm("10:00"),
		FREE_END: hhmm("14:00"),
		BATTERY_START_PCT: z.coerce.number().min(0).max(100).default(40),
		BATTERY_STOP_PCT: z.coerce.number().min(0).max(100).default(15),
		SOLAR_COVER_RATIO: z.coerce.number().gt(0).lte(1).default(0.7),
		// In the solar window: if the house battery is above this, charge the car
		// regardless of the solar-coverage test (the battery is full, so the
		// surplus may as well go to the car).
		BATTERY_BYPASS_PCT: z.coerce.number().min(0).max(100).default(80),
		CAR_POWER_W: z.coerce.number().positive().default(2000),
		// Main-switch protection: never let grid import + the car exceed this.
		// The main breaker is 50A (~11.5kW); 10kW leaves a safety margin.
		MAIN_SWITCH_LIMIT_W: z.coerce.number().positive().default(10000),

		// --- Car battery (Tesla, read over Bluetooth via tesla-control) ---
		// Don't charge if the car is already at/above this.
		CAR_MAX_SOC: z.coerce.number().min(0).max(100).default(80),
		// How long to trust one car reading before waking the car again.
		CAR_SOC_TTL_MINUTES: z.coerce.number().positive().default(60),
		// The tesla-control binary (on PATH, or an absolute path).
		TESLA_CONTROL_CMD: z.string().default("tesla-control"),
		// If the car can't be read, charge anyway (relies on the car's own charge
		// limit) instead of holding. Turn on only if BLE is unreliable for you.
		CHARGE_IF_CAR_UNKNOWN: z
			.string()
			.default("false")
			.transform((v) => /^(true|1|yes)$/i.test(v.trim())),

		// --- Scheduling (the `watch` daemon) ---
		// Cron expression for how often to tick. Default: :00 and :30 each hour.
		SCHEDULE_CRON: z.string().min(1).default("0,30 * * * *"),

		LOG_LEVEL: z.string().default("info"),
	})
	.refine((c) => c.MORNING_START < c.FREE_START && c.FREE_START < c.FREE_END, {
		path: ["FREE_START"],
		error: "expected MORNING_START < FREE_START < FREE_END",
	})
	.refine((c) => c.BATTERY_STOP_PCT < c.BATTERY_START_PCT, {
		path: ["BATTERY_STOP_PCT"],
		error: "BATTERY_STOP_PCT must be below BATTERY_START_PCT",
	});

export interface PolicyConfig {
	readonly morningStartMin: number;
	readonly freeStartMin: number;
	readonly freeEndMin: number;
	readonly batteryStartPct: number;
	readonly batteryStopPct: number;
	readonly solarCoverRatio: number;
	/** House battery % above which the solar-coverage test is skipped. */
	readonly batteryBypassPct: number;
	readonly carPowerW: number;
	readonly mainSwitchLimitW: number;
	/** Don't charge if the car battery is at/above this percent. */
	readonly carMaxSoc: number;
	/** When the car can't be read, charge anyway instead of holding. */
	readonly chargeIfCarUnknown: boolean;
}

export interface AppConfig {
	readonly solarman: { stationId: string | undefined; email: string | undefined; password: string | undefined };
	readonly tapo: { cliCmd: string };
	/** Tesla car reader (tesla-control CLI + SOC cache TTL). */
	readonly car: { controlCmd: string; socTtlMs: number };
	readonly policy: PolicyConfig;
	/** Cron expression for the `watch` daemon's tick. */
	readonly scheduleCron: string;
}

/** Empty strings (common in a copied .env or an unset CI secret) are treated as absent. */
function definedEnv(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
	}
	return out;
}

export function loadConfig(): AppConfig {
	const parsed = Schema.safeParse(definedEnv());
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
		throw new Error(`Invalid configuration - check your environment against .env.example:\n${issues}`);
	}
	const e = parsed.data;
	return {
		solarman: { stationId: e.SOLARMAN_STATION_ID, email: e.SOLARMAN_EMAIL, password: e.SOLARMAN_PASSWORD },
		tapo: { cliCmd: e.PLUG_CLI_CMD },
		car: { controlCmd: e.TESLA_CONTROL_CMD, socTtlMs: e.CAR_SOC_TTL_MINUTES * 60_000 },
		policy: {
			morningStartMin: e.MORNING_START,
			freeStartMin: e.FREE_START,
			freeEndMin: e.FREE_END,
			batteryStartPct: e.BATTERY_START_PCT,
			batteryStopPct: e.BATTERY_STOP_PCT,
			solarCoverRatio: e.SOLAR_COVER_RATIO,
			batteryBypassPct: e.BATTERY_BYPASS_PCT,
			carPowerW: e.CAR_POWER_W,
			mainSwitchLimitW: e.MAIN_SWITCH_LIMIT_W,
			carMaxSoc: e.CAR_MAX_SOC,
			chargeIfCarUnknown: e.CHARGE_IF_CAR_UNKNOWN,
		},
		scheduleCron: e.SCHEDULE_CRON,
	};
}
