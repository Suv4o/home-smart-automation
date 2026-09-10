import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../logger.ts";

/**
 * How much power this roof actually makes per unit of forecast irradiance.
 *
 * Open-Meteo's `shortwave_radiation` is energy landing on a **horizontal**
 * surface. Panels are tilted, so the honest conversion depends on roof pitch,
 * orientation, shading, panel age and inverter efficiency - none of which we
 * know, and all of which a homeowner would have to look up.
 *
 * So we don't model any of it. We measure it: the system reports what it is
 * generating, the forecast says what irradiance it had, and the ratio is the
 * answer. One learned number absorbs every term at once, and it stays right as
 * the seasons move the sun and the panels age.
 *
 * A first guess of 0.9 stands in until real samples arrive - roughly the annual
 * average for a tilted domestic array once losses are counted. The original
 * fixed 0.8 was badly wrong for this house: measured against real output on a
 * spring morning the true figure was 1.32.
 */
export const DEFAULT_FACTOR = 0.9;

/** Bounds. Outside these the inputs are not what we think they are. */
const MIN_FACTOR = 0.3;
const MAX_FACTOR = 2.5;

/** Below these a sample is noise: dawn, dusk, or a becalmed inverter. */
const MIN_GHI_WM2 = 200;
const MIN_SOLAR_W = 300;

/**
 * Weight of one new sample. Deliberately small: the irradiance figure is an
 * hourly average while the generation reading is instantaneous, so on a broken
 * cloudy day individual samples disagree wildly. Averaging many of them over
 * days is what makes the number trustworthy.
 */
const ALPHA = 0.08;

export interface Calibration {
	factor: number;
	/** How many readings have gone into it, so the UI can say how settled it is. */
	samples: number;
	/** Epoch ms of the last sample. */
	at: number;
}

const FILE = join(
	process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"),
	"home-automation",
	"solar-calibration.json",
);

/**
 * The factor implied by one observation, or null when conditions make the ratio
 * meaningless.
 *
 * Rejecting weak sun matters more than it looks: near dawn a small absolute
 * error in either figure becomes a huge ratio, and a handful of those would drag
 * the average somewhere silly.
 */
export function sampleFactor(observedW: number, ghiWm2: number, arrayKwp: number): number | null {
	if (!(arrayKwp > 0) || ghiWm2 < MIN_GHI_WM2 || observedW < MIN_SOLAR_W) return null;
	const idealW = (ghiWm2 / 1000) * arrayKwp * 1000;
	if (!(idealW > 0)) return null;
	const factor = observedW / idealW;
	// A ratio outside the plausible band means something else is going on -
	// export limiting, a curtailed inverter, a misread field. Don't learn from it.
	return factor >= MIN_FACTOR && factor <= MAX_FACTOR ? factor : null;
}

/** Fold a new sample into the running figure. */
export function nextFactor(current: Calibration | null, sample: number): Calibration {
	const factor = current ? current.factor * (1 - ALPHA) + sample * ALPHA : sample;
	return {
		factor: Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, Math.round(factor * 1000) / 1000)),
		samples: (current?.samples ?? 0) + 1,
		at: Date.now(),
	};
}

export async function loadCalibration(): Promise<Calibration | null> {
	try {
		const c = JSON.parse(await readFile(FILE, "utf8")) as Calibration;
		return typeof c.factor === "number" && c.factor >= MIN_FACTOR && c.factor <= MAX_FACTOR ? c : null;
	} catch {
		return null;
	}
}

export async function saveCalibration(c: Calibration): Promise<void> {
	try {
		await mkdir(dirname(FILE), { recursive: true, mode: 0o700 });
		await writeFile(FILE, JSON.stringify(c), { mode: 0o600 });
	} catch (err) {
		logger.warn({ err: String(err) }, "could not save solar calibration");
	}
}

export function calibrationFile(): string {
	return FILE;
}
