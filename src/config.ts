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

const Base = z.object({
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
		// A START gate, not a ceiling: automatic charging only begins when the car
		// is at or below this. Once a session is under way it runs to the car's own
		// charge limit, and a manual override ignores this entirely.
		CAR_START_MAX_SOC: z.coerce.number().min(0).max(100).default(80),
		// How long to trust one car reading before waking the car again. This is
		// the idle figure: reading an asleep car wakes it, so it is deliberately
		// slow.
		CAR_SOC_TTL_MINUTES: z.coerce.number().positive().default(60),
		// The same, but while the car is actually drawing power. A charging car is
		// already awake, so reading it costs no wake - the figure can be far
		// fresher. Lower it if you want the percentage to climb more visibly; each
		// read is a BLE round-trip that takes a few seconds and can fail.
		CAR_SOC_TTL_CHARGING_MINUTES: z.coerce.number().positive().default(5),
		// Below this draw the plug is live but nothing is charging (no cable in the
		// car). The mobile connector pulls ~2kW, an idle socket a few watts.
		CAR_DRAW_MIN_W: z.coerce.number().positive().default(500),
		// The tesla-control binary (on PATH, or an absolute path).
		TESLA_CONTROL_CMD: z.string().default("tesla-control"),
		// If the car can't be read, charge anyway (relies on the car's own charge
		// limit) instead of holding. Turn on only if BLE is unreliable for you.
		CHARGE_IF_CAR_UNKNOWN: z
			.string()
			.default("false")
			.transform((v) => /^(true|1|yes)$/i.test(v.trim())),

		// --- Dashboard server ---
		UI_PORT: z.coerce.number().int().positive().default(8080),
		UI_HOST: z.string().default("0.0.0.0"),
		// How often the display refreshes (never wakes the car).
		UI_REFRESH_S: z.coerce.number().positive().default(15),
		// Don't re-poll Solarman more often than this; upstream lags ~5 min anyway.
		SOLARMAN_MIN_INTERVAL_S: z.coerce.number().positive().default(60),
		// Required for write endpoints (overrides, car refresh). Blank disables them.
		DASHBOARD_TOKEN: z.string().optional(),
		// Home coordinates, for sunrise/sunset only. Defaults to Melbourne CBD.
		LATITUDE: z.coerce.number().min(-90).max(90).default(-37.81),
		LONGITUDE: z.coerce.number().min(-180).max(180).default(144.96),

		// --- Scheduling (the `watch` daemon) ---
		// Cron expression for how often to tick. Default: :00 and :30 each hour.
		SCHEDULE_CRON: z.string().min(1).default("0,30 * * * *"),

		LOG_LEVEL: z.string().default("info"),
});

/**
 * Every variable `loadConfig` reads. `.env.example` is checked against this list
 * by a test, so a new setting cannot be added without documenting it.
 *
 * Variables consumed by child processes rather than by us - the TAPO_* pair that
 * scripts/plug_local.py reads, and the TESLA_* ones tesla-control reads - are not
 * here; the same test covers those from its own list.
 */
export const ENV_KEYS: readonly string[] = Object.keys(Base.shape).sort();

const Schema = Base
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
	/**
	 * Automatic charging starts only when the car is at or below this percent.
	 * It never stops a session already running - the car's own charge limit does
	 * that - and a manual override ignores it entirely.
	 */
	readonly carStartMaxSoc: number;
	/** When the car can't be read, charge anyway instead of holding. */
	readonly chargeIfCarUnknown: boolean;
}

export interface AppConfig {
	readonly solarman: { stationId: string | undefined; email: string | undefined; password: string | undefined };
	readonly tapo: { cliCmd: string };
	/** Tesla car reader (tesla-control CLI + SOC cache TTL). */
	readonly car: { controlCmd: string; socTtlMs: number; socTtlChargingMs: number; drawMinW: number };
	readonly policy: PolicyConfig;
	/** Dashboard HTTP server + display polling. */
	readonly ui: {
		port: number;
		host: string;
		refreshMs: number;
		solarmanMinIntervalMs: number;
		token: string | undefined;
	};
	/** Home coordinates, used only for sun/moon position. */
	readonly location: { latitude: number; longitude: number };
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
		car: {
			controlCmd: e.TESLA_CONTROL_CMD,
			socTtlMs: e.CAR_SOC_TTL_MINUTES * 60_000,
			socTtlChargingMs: e.CAR_SOC_TTL_CHARGING_MINUTES * 60_000,
			drawMinW: e.CAR_DRAW_MIN_W,
		},
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
			carStartMaxSoc: e.CAR_START_MAX_SOC,
			chargeIfCarUnknown: e.CHARGE_IF_CAR_UNKNOWN,
		},
		ui: {
			port: e.UI_PORT,
			host: e.UI_HOST,
			refreshMs: e.UI_REFRESH_S * 1000,
			solarmanMinIntervalMs: e.SOLARMAN_MIN_INTERVAL_S * 1000,
			token: e.DASHBOARD_TOKEN,
		},
		location: { latitude: e.LATITUDE, longitude: e.LONGITUDE },
		scheduleCron: e.SCHEDULE_CRON,
	};
}
