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

export async function saveOverride(mode: OverrideMode, until: number): Promise<Override> {
	const o: Override = { mode, until, setAt: Date.now() };
	await mkdir(dirname(FILE), { recursive: true, mode: 0o700 });
	await writeFile(FILE, JSON.stringify(o), { mode: 0o600 });
	logger.info({ mode, until: new Date(until).toISOString() }, "override set");
	return o;
}

export async function clearOverride(): Promise<void> {
	try {
		await unlink(FILE);
	} catch {
		// already absent
	}
}
