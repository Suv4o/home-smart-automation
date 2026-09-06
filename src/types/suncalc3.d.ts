/**
 * Minimal hand-written types for `suncalc3`, which ships none. Only the two
 * functions this project calls are declared; shapes verified against the
 * library's actual runtime output.
 */
declare module "suncalc3" {
	export interface SunPosition {
		azimuth: number;
		altitude: number;
		/** Height above the horizon in degrees. Negative = below it. */
		altitudeDegrees: number;
		azimuthDegrees: number;
		zenithDegrees: number;
		declination: number;
	}

	export interface MoonPhase {
		from: number;
		to: number;
		/** e.g. "fullMoon", "waningCrescentMoon". */
		id: string;
		emoji: string;
		code: string;
		name: string;
		weight: number;
		css: string;
	}

	export interface MoonIllumination {
		/** Lit fraction of the disc, 0-1. */
		fraction: number;
		/** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
		phaseValue: number;
		phase: MoonPhase;
		angle: number;
	}

	// suncalc3 is CommonJS: consumers get module.exports as the default import.
	const SunCalc: {
		getPosition(date: Date, latitude: number, longitude: number): SunPosition;
		getMoonIllumination(date: Date): MoonIllumination;
	};
	export default SunCalc;
}
