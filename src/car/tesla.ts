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
			const soc = await this.#readFresh();
			await this.#writeCache(soc);
			return { soc, stale: false };
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
	async cachedSoc(): Promise<{ soc: number; at: number } | null> {
		const c = await this.#readCache();
		return c ? { soc: c.soc, at: c.at } : null;
	}

	/** Forces a fresh read (wakes the car). Used by the explicit refresh action. */
	async refresh(): Promise<CarSoc | null> {
		try {
			const soc = await this.#readFresh();
			await this.#writeCache(soc);
			return { soc, stale: false };
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

	async #readFresh(): Promise<number> {
		let lastErr: unknown;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				return parseSoc(await this.#invoke(["-ble", "state", "charge"]));
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

	async #writeCache(soc: number): Promise<void> {
		await mkdir(dirname(CACHE_FILE), { recursive: true, mode: 0o700 });
		await writeFile(CACHE_FILE, JSON.stringify({ soc, at: Date.now() } satisfies CacheEntry), { mode: 0o600 });
	}
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Pull the battery percentage out of `tesla-control state charge` output. The
 * tool prints a JSON object; we prefer `usableBatteryLevel` (what's actually
 * available) and fall back to `batteryLevel`.
 */
export function parseSoc(stdout: string): number {
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start === -1 || end <= start) throw new TeslaReadError(`no JSON in car response: ${stdout.slice(0, 200)}`);
	let json: unknown;
	try {
		json = JSON.parse(stdout.slice(start, end + 1));
	} catch {
		throw new TeslaReadError(`could not parse car response as JSON: ${stdout.slice(0, 200)}`);
	}
	const charge = (json as { chargeState?: Record<string, unknown> }).chargeState ?? {};
	for (const key of ["usableBatteryLevel", "batteryLevel"]) {
		const v = charge[key];
		if (typeof v === "number" && Number.isFinite(v)) return v;
	}
	throw new TeslaReadError(`no batteryLevel in car response. chargeState keys: ${Object.keys(charge).join(", ")}`);
}
