import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { CarSoc } from "../engine/policy.ts";
import { logger } from "../logger.ts";

const run = promisify(execFile);

/** BLE commands are slow, and a wake takes a few seconds. */
const COMMAND_TIMEOUT_MS = 30_000;
const WAKE_SETTLE_MS = 4_000;
const MAX_ATTEMPTS = 3;

const CACHE_FILE = join(
	process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"),
	"home-automation",
	"tesla-soc.json",
);

interface CacheEntry {
	soc: number;
	/** Epoch ms of the reading. */
	at: number;
	/** Minutes the car said it still needed, at `at`. Absent in older caches. */
	minutesToFull?: number | null;
	/** The car's own charge limit, e.g. 80. */
	chargeLimit?: number | null;
	/** Last known lock state. Absent in caches written before this existed. */
	locked?: boolean | null;
	/** The car's own charging status at `at`. Absent in older caches. */
	chargingState?: string | null;
}

/** What `state charge` alone gives us. */
export interface ChargeReading {
	soc: number;
	/**
	 * Minutes until the car reaches its own charge limit, as the car reports it -
	 * the same figure the Tesla app shows. Null when the car doesn't report one,
	 * which is normal when it isn't charging.
	 */
	minutesToFull: number | null;
	chargeLimit: number | null;
	/**
	 * The car's own word for what it is doing: "Charging", "Complete",
	 * "Disconnected", "Stopped", "NoPower". Null when it doesn't say.
	 */
	chargingState: string | null;
}

/** One complete visit to the car: charge, plus the lock state read in the same wake. */
export interface CarReading extends ChargeReading {
	/** null when the car couldn't be asked - never assumed either way. */
	locked: boolean | null;
}

export class TeslaReadError extends Error {}

/**
 * Reads the Tesla's battery level over Bluetooth via Tesla's official
 * `tesla-control` CLI (https://github.com/teslamotors/vehicle-command).
 *
 * Two things from that tool shape this code:
 *   - Reading `state charge` **wakes the car**, so `soc()` serves a cached value
 *     within a TTL and only does a real read when the cache is stale. The caller
 *     should only call it when a charge is otherwise warranted.
 *   - When the car is asleep the read fails with "context deadline exceeded";
 *     we then issue `wake` and retry. BLE is also marginal, so reads are retried.
 *
 * TESLA_VIN / TESLA_KEY_NAME / TESLA_CACHE_FILE are read by tesla-control itself
 * from the environment (inherited from .env), so they are not handled here.
 */
export class TeslaCar {
	readonly #cmd: string;
	readonly #args: string[];
	readonly #ttlMs: number;

	constructor(controlCmd: string, ttlMs: number) {
		const parts = controlCmd.trim().split(/\s+/);
		this.#cmd = parts[0] ?? "tesla-control";
		this.#args = parts.slice(1);
		this.#ttlMs = ttlMs;
	}

	/**
	 * Battery percentage, from cache when fresh. On a stale cache it reads the
	 * car (waking it); if that read fails it falls back to the last cached value
	 * marked `stale`, or returns null when there is nothing to fall back to.
	 */
	async soc(): Promise<CarSoc | null> {
		const cached = await this.#readCache();
		if (cached && Date.now() - cached.at < this.#ttlMs) {
			return { soc: cached.soc, stale: false };
		}
		try {
			const reading = await this.#readFresh();
			await this.#writeCache(reading);
			return { soc: reading.soc, stale: false };
		} catch (err) {
			logger.warn({ err: String(err) }, "car read failed");
			if (cached) {
				logger.warn({ ageMin: Math.round((Date.now() - cached.at) / 60_000) }, "using last cached car SOC");
				return { soc: cached.soc, stale: true };
			}
			return null;
		}
	}

	/**
	 * The cached reading and its age, WITHOUT ever contacting the car.
	 *
	 * This is what the dashboard uses. Reading `state charge` wakes the vehicle,
	 * so the display path must never call `soc()` - only the decision tick and
	 * the explicit "check now" button are allowed to do that.
	 */
	async cachedSoc(): Promise<{
		soc: number;
		at: number;
		minutesToFull: number | null;
		chargeLimit: number | null;
		locked: boolean | null;
		chargingState: string | null;
	} | null> {
		const c = await this.#readCache();
		return c
			? {
					soc: c.soc,
					at: c.at,
					minutesToFull: c.minutesToFull ?? null,
					chargeLimit: c.chargeLimit ?? null,
					locked: c.locked ?? null,
					chargingState: c.chargingState ?? null,
				}
			: null;
	}

	/**
	 * Lock or unlock, then read back what the car actually did.
	 *
	 * Takes the state you want, not "toggle". Someone may have used the phone app
	 * since the dashboard last looked, so a toggle computed from a stale reading
	 * could do the opposite of what the button offered. Asking for an end state is
	 * idempotent: locking an already-locked car is a no-op, and either way the
	 * read-back corrects the display rather than leaving it wrong.
	 */
	async setLocked(locked: boolean): Promise<boolean | null> {
		await this.#invoke(["-ble", locked ? "lock" : "unlock"]);
		const actual = await this.#tryReadLocked();
		await this.#patchCache({ locked: actual });
		if (actual !== null && actual !== locked) {
			logger.warn({ wanted: locked, actual }, "car did not end up in the requested lock state");
		}
		return actual;
	}

	/** Re-read just the lock state, without disturbing the cached battery reading. */
	async refreshLocked(): Promise<boolean | null> {
		const locked = await this.#tryReadLocked();
		await this.#patchCache({ locked });
		return locked;
	}

	/**
	 * The raw `state charge` JSON, for diagnosing what this car actually reports.
	 * Wakes the car, so it is only reachable from the CLI.
	 *
	 * Location is stripped. The car returns `homeLocation` and `workLocation` as
	 * precise coordinates, and the whole point of this command is to paste its
	 * output somewhere - a bug report, a chat, an article. Nothing here needs the
	 * coordinates, so they never reach the terminal in the first place.
	 */
	async rawChargeState(): Promise<string> {
		return redactLocation(await this.#invoke(["-ble", "state", "charge"]));
	}

	/** Forces a fresh read (wakes the car). Used by the explicit refresh action. */
	async refresh(): Promise<CarSoc | null> {
		try {
			const reading = await this.#readFresh();
			await this.#writeCache(reading);
			return { soc: reading.soc, stale: false };
		} catch (err) {
			logger.warn({ err: String(err) }, "manual car refresh failed");
			return null;
		}
	}

	async #invoke(sub: string[]): Promise<string> {
		try {
			const { stdout } = await run(this.#cmd, [...this.#args, ...sub], { timeout: COMMAND_TIMEOUT_MS });
			return stdout;
		} catch (err) {
			const e = err as { stderr?: string; message?: string; signal?: string };
			if (e.signal === "SIGABRT") {
				throw new TeslaReadError(
					`tesla-control crashed (Abort trap: 6). The process running it lacks macOS Bluetooth ` +
						`permission — see docs/tesla.md.`,
				);
			}
			throw new TeslaReadError(`${this.#cmd} ${sub.join(" ")} failed: ${(e.stderr || e.message || "").trim()}`);
		}
	}

	/**
	 * One visit to the car. The battery is what we came for; the lock state is
	 * read in the same wake because the car is already awake and asking again
	 * later would cost another one - which is the whole reason the lock state on
	 * the dashboard can be trusted at all.
	 */
	async #readFresh(): Promise<CarReading> {
		const charge = await this.#readCharge();
		return { ...charge, locked: await this.#tryReadLocked() };
	}

	/** Best-effort: a car that won't report its locks must not fail the reading. */
	async #tryReadLocked(): Promise<boolean | null> {
		try {
			return parseLocked(await this.#invoke(["-ble", "state", "closures"]));
		} catch (err) {
			logger.warn({ err: String(err) }, "could not read lock state");
			return null;
		}
	}

	async #readCharge(): Promise<ChargeReading> {
		let lastErr: unknown;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				return parseCharge(await this.#invoke(["-ble", "state", "charge"]));
			} catch (err) {
				lastErr = err;
				const msg = String(err);
				if (/deadline exceeded|asleep|not awake/i.test(msg) && attempt < MAX_ATTEMPTS) {
					logger.info("car appears asleep — sending wake");
					await this.#invoke(["-ble", "wake"]).catch(() => {});
					await sleep(WAKE_SETTLE_MS);
					continue;
				}
				if (attempt < MAX_ATTEMPTS) {
					await sleep(2_000); // BLE is flaky; a retry often succeeds
					continue;
				}
			}
		}
		throw lastErr instanceof Error ? lastErr : new TeslaReadError(String(lastErr));
	}

	async #readCache(): Promise<CacheEntry | null> {
		try {
			const c = JSON.parse(await readFile(CACHE_FILE, "utf8")) as CacheEntry;
			return typeof c.soc === "number" && typeof c.at === "number" ? c : null;
		} catch {
			return null;
		}
	}

	/** Update part of the cache, leaving the reading's timestamp and the rest alone. */
	async #patchCache(patch: Partial<CacheEntry>): Promise<void> {
		const current = await this.#readCache();
		if (!current) return; // nothing to attach it to; the next full read will carry it
		await mkdir(dirname(CACHE_FILE), { recursive: true, mode: 0o700 });
		await writeFile(CACHE_FILE, JSON.stringify({ ...current, ...patch }), { mode: 0o600 });
	}

	async #writeCache(reading: CarReading): Promise<void> {
		await mkdir(dirname(CACHE_FILE), { recursive: true, mode: 0o700 });
		const entry: CacheEntry = { ...reading, at: Date.now() };
		await writeFile(CACHE_FILE, JSON.stringify(entry), { mode: 0o600 });
	}
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Read one number out of a `chargeState` object, trying each spelling in turn.
 *
 * `tesla-control` emits protobuf JSON, which is camelCase, but the field names
 * have moved between versions of the tool and Tesla's own API uses snake_case in
 * places - so each value is looked up under every name it plausibly carries
 * rather than assuming one.
 */
function pick(charge: Record<string, unknown>, keys: string[]): number | null {
	for (const key of keys) {
		const v = charge[key];
		if (typeof v === "number" && Number.isFinite(v)) return v;
	}
	return null;
}

function chargeObject(stdout: string): Record<string, unknown> {
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start === -1 || end <= start) throw new TeslaReadError(`no JSON in car response: ${stdout.slice(0, 200)}`);
	let json: unknown;
	try {
		json = JSON.parse(stdout.slice(start, end + 1));
	} catch {
		throw new TeslaReadError(`could not parse car response as JSON: ${stdout.slice(0, 200)}`);
	}
	return (json as { chargeState?: Record<string, unknown> }).chargeState ?? {};
}

/**
 * Everything we want from `tesla-control state charge`.
 *
 * The battery percentage is required - without it there is no reading. The
 * remaining-time figure is optional by design: the car only reports it while it
 * is charging, and not every firmware exposes it, so its absence degrades the
 * display rather than failing the read.
 */
export function parseCharge(stdout: string): ChargeReading {
	const charge = chargeObject(stdout);

	const soc = pick(charge, ["usableBatteryLevel", "batteryLevel"]);
	if (soc === null) {
		throw new TeslaReadError(`no batteryLevel in car response. chargeState keys: ${Object.keys(charge).join(", ")}`);
	}

	// `minutesToChargeLimit` comes first deliberately. The car reports both, and
	// they only agree when the charge limit is 100% - otherwise "to full" counts
	// past the point the car will actually stop. The limit is what the Tesla app
	// shows, and the level the car will actually stop at.
	let minutesToFull = pick(charge, [
		"minutesToChargeLimit",
		"minutes_to_charge_limit",
		"minutesToFullCharge",
		"minutes_to_full_charge",
	]);
	if (minutesToFull === null) {
		const hours = pick(charge, ["timeToFullCharge", "time_to_full_charge"]);
		if (hours !== null) minutesToFull = Math.round(hours * 60);
	}
	// A negative figure is meaningless; zero is not - it means "about to finish".
	if (minutesToFull !== null && minutesToFull < 0) minutesToFull = null;

	return {
		soc,
		minutesToFull,
		chargeLimit: pick(charge, ["chargeLimitSoc", "charge_limit_soc"]),
		chargingState: pickChargingState(charge),
	};
}

/** Keys the car returns that pinpoint where you live. Never printed. */
const LOCATION_KEYS = ["homeLocation", "workLocation", "latitude", "longitude", "gpsAsOf", "nativeLocationSupported"];

/** Replace any location the car reports with a placeholder, keeping the shape. */
export function redactLocation(stdout: string): string {
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start === -1 || end <= start) return stdout;
	let json: unknown;
	try {
		json = JSON.parse(stdout.slice(start, end + 1));
	} catch {
		return stdout;
	}
	const scrub = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(scrub);
		if (v && typeof v === "object") {
			return Object.fromEntries(
				Object.entries(v as Record<string, unknown>).map(([k, val]) =>
					LOCATION_KEYS.includes(k) ? [k, "[redacted]"] : [k, scrub(val)],
				),
			);
		}
		return v;
	};
	return JSON.stringify(scrub(json), null, 2);
}

/**
 * The car's charging status, which protobuf JSON wraps as a one-key object -
 * `{"Charging": {}}` - rather than a plain string. The key is the value.
 */
function pickChargingState(charge: Record<string, unknown>): string | null {
	const v = charge["chargingState"] ?? charge["charging_state"];
	if (typeof v === "string") return v;
	if (v && typeof v === "object" && !Array.isArray(v)) {
		const key = Object.keys(v as Record<string, unknown>)[0];
		return key ?? null;
	}
	return null;
}

/**
 * Whether the car is locked, from `state closures`.
 *
 * Returns null rather than guessing when the car doesn't say. Assuming "locked"
 * would put a reassuring padlock on the screen with nothing behind it; assuming
 * "unlocked" would nag about a car that is probably fine. Unknown is a state the
 * UI is built to show.
 */
export function parseLocked(stdout: string): boolean | null {
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	let json: unknown;
	try {
		json = JSON.parse(stdout.slice(start, end + 1));
	} catch {
		return null;
	}
	const root = json as Record<string, unknown>;
	const state = (root["closuresState"] ?? root["vehicleState"] ?? root) as Record<string, unknown>;

	if (typeof state["locked"] === "boolean") return state["locked"];
	// Some firmware reports an enum instead of a flag.
	const enumish = state["vehicleLockState"];
	if (typeof enumish === "string") {
		if (/unlocked/i.test(enumish)) return false;
		if (/locked/i.test(enumish)) return true;
	}
	return null;
}

/** The battery percentage alone. */
export function parseSoc(stdout: string): number {
	return parseCharge(stdout).soc;
}
