import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../logger.ts";

/**
 * A manual instruction from the dashboard that beats the time windows.
 *
 * Overrides ALWAYS expire. A forgotten tap must not strand the system in a
 * state it can't leave, so every override carries an expiry and the UI shows a
 * countdown.
 */
export type OverrideMode = "force_on" | "force_off";

export interface Override {
	readonly mode: OverrideMode;
	/** Epoch ms after which this override stops applying. */
	readonly until: number;
	readonly setAt: number;
	/**
	 * Hand back to the schedule the moment the car stops taking power, instead of
	 * holding the plug on for the rest of the term. Opt-in, and only meaningful
	 * for `force_on` - there is nothing to finish when pausing.
	 */
	readonly releaseWhenDone?: boolean;
	/**
	 * Set once the car has actually drawn power under this override. Without it we
	 * could not tell "finished" from "never started", and an override set before
	 * plugging in would release itself immediately.
	 */
	readonly sawCharging?: boolean;
}

const FILE = join(
	process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"),
	"home-automation",
	"override.json",
);

export function overrideFilePath(): string {
	return FILE;
}

/** True once `until` has passed. */
export function isExpired(o: Override, now = Date.now()): boolean {
	return now >= o.until;
}

/** Reads the stored override, treating an expired or malformed one as absent. */
export async function loadOverride(now = Date.now()): Promise<Override | null> {
	let raw: string;
	try {
		raw = await readFile(FILE, "utf8");
	} catch {
		return null;
	}
	try {
		const o = JSON.parse(raw) as Override;
		const valid =
			(o.mode === "force_on" || o.mode === "force_off") && typeof o.until === "number" && typeof o.setAt === "number";
		if (!valid) return null;
		if (isExpired(o, now)) {
			await clearOverride();
			logger.info("override expired - back to automatic");
			return null;
		}
		return o;
	} catch {
		return null;
	}
}

export async function saveOverride(mode: OverrideMode, until: number, releaseWhenDone = false): Promise<Override> {
	// Only force_on can "finish", so the flag is dropped rather than stored
	// misleadingly on a pause.
	const o: Override = { mode, until, setAt: Date.now(), releaseWhenDone: releaseWhenDone && mode === "force_on" };
	await write(o);
	logger.info({ mode, until: new Date(until).toISOString(), releaseWhenDone: o.releaseWhenDone }, "override set");
	return o;
}

/** Records that the car has started drawing under this override. */
export async function markOverrideCharging(o: Override): Promise<Override> {
	const next: Override = { ...o, sawCharging: true };
	await write(next);
	return next;
}

async function write(o: Override): Promise<void> {
	await mkdir(dirname(FILE), { recursive: true, mode: 0o700 });
	await writeFile(FILE, JSON.stringify(o), { mode: 0o600 });
}

export async function clearOverride(): Promise<void> {
	try {
		await unlink(FILE);
	} catch {
		// already absent
	}
}
