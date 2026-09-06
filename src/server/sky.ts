import SunCalc from "suncalc3";

/**
 * Which part of the day the illustration should show.
 *
 * Chosen from the sun's height above the horizon - an angle in degrees, where 0
 * is the sun sitting exactly on the horizon and negative means it has dropped
 * below it. Never chosen from solar production: an overcast midday must still
 * render as day, not night.
 */
export type SkyPhase = "day" | "dawn" | "dusk" | "night";

export interface Sky {
	readonly phase: SkyPhase;
	/** Sun's height above the horizon, degrees. Negative = below it. */
	readonly sunElevation: number;
	/** 0 = new moon, 0.5 = full, 1 = new again. Only meaningful at night. */
	readonly moonPhase: number;
	/** Lit fraction of the moon's disc, 0-1. */
	readonly moonFraction: number;
	/** e.g. "waningCrescentMoon" - handy for a label / alt text. */
	readonly moonName: string;
	/** 0 at civil twilight, 1 once the sun is properly up. Drives brightness. */
	readonly daylight: number;
}

/** Above this the sun is properly up. */
export const DAY_ELEVATION = 6;
/** Below this it is properly dark - the standard "civil twilight" line. */
export const NIGHT_ELEVATION = -6;

export function skyFor(date: Date, latitude: number, longitude: number): Sky {
	const sunElevation = SunCalc.getPosition(date, latitude, longitude).altitudeDegrees;

	let phase: SkyPhase;
	if (sunElevation > DAY_ELEVATION) phase = "day";
	else if (sunElevation < NIGHT_ELEVATION) phase = "night";
	// Near the horizon: climbing means dawn, dropping means dusk.
	else phase = isRising(date, latitude, longitude) ? "dawn" : "dusk";

	const moon = SunCalc.getMoonIllumination(date);

	return {
		phase,
		sunElevation,
		moonPhase: moon.phaseValue,
		moonFraction: moon.fraction,
		moonName: moon.phase.id,
		daylight: clamp01((sunElevation - NIGHT_ELEVATION) / (DAY_ELEVATION - NIGHT_ELEVATION)),
	};
}

/** Is the sun climbing? Compare its height against ten minutes from now. */
function isRising(date: Date, latitude: number, longitude: number): boolean {
	const now = SunCalc.getPosition(date, latitude, longitude).altitudeDegrees;
	const later = SunCalc.getPosition(new Date(date.getTime() + 10 * 60_000), latitude, longitude).altitudeDegrees;
	return later > now;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
