import type { DashboardState } from "./types.ts";

export interface SunWindow {
	from: string;
	to: string;
	hours: number;
}

/**
 * A plausible background house load to forecast against.
 *
 * Not the spot reading. The question is "will tomorrow's sun cover the car?",
 * and answering it with whatever the house happens to draw this second gives a
 * wildly unstable answer - an oven mid-bake pushed the bar to 5.1 kW and the
 * forecast declared there would be no charging window all day. Clamping to a
 * band keeps it responsive to a genuinely frugal or hungry house without letting
 * one appliance rewrite tomorrow.
 */
const HOUSE_FLOOR_W = 300;
const HOUSE_CEILING_W = 1500;

export function typicalHouseW(state: DashboardState): number {
	const now = state.energy?.loadW ?? HOUSE_CEILING_W;
	return Math.min(HOUSE_CEILING_W, Math.max(HOUSE_FLOOR_W, now));
}

/**
 * How much PV the solar rule needs before it will run the car.
 *
 * Deliberately the policy's own arithmetic - `ratio × (house + car)` - rather
 * than a threshold invented for the forecast, so the outlook answers the question
 * the daemon will actually ask.
 */
export function chargingThresholdW(state: DashboardState): number {
	const { solarCoverRatio, carPowerW } = state.limits;
	// Rounded: this is compared against whole-watt estimates and shown to the
	// user, so sub-watt precision is noise that only makes it awkward to assert on.
	return Math.round(solarCoverRatio * (typicalHouseW(state) + carPowerW));
}

/** Hours belonging to one local date, "YYYY-MM-DD". */
export function hoursOn(state: DashboardState, day: string) {
	return (state.weather?.sun ?? []).filter((h) => h.time.slice(0, 10) === day);
}

/** The two dates the forecast covers, in order. */
export function forecastDays(state: DashboardState): string[] {
	const days = new Set((state.weather?.sun ?? []).map((h) => h.time.slice(0, 10)));
	return [...days].sort();
}

/**
 * The longest unbroken run of hours clearing `thresholdW`.
 *
 * Mirrors `sunnyWindow` on the server; kept here too so the dialog can compute a
 * window per day without the server having to pick one for it.
 */
export function sunWindow(
	hours: readonly { time: string; estimatedW: number | null }[],
	thresholdW: number,
): SunWindow | null {
	let best: SunWindow | null = null;
	let run: { time: string }[] = [];
	const close = (): void => {
		if (run.length && (!best || run.length > best.hours)) {
			best = { from: run[0]!.time, to: run[run.length - 1]!.time, hours: run.length };
		}
		run = [];
	};
	for (const h of hours) {
		if (h.estimatedW !== null && h.estimatedW >= thresholdW) run.push(h);
		else close();
	}
	close();
	return best;
}

/** Peak estimated output across the given hours, or null when we can't estimate. */
export function peakW(hours: readonly { estimatedW: number | null }[]): number | null {
	const known = hours.map((h) => h.estimatedW).filter((v): v is number => v !== null);
	return known.length ? Math.max(...known) : null;
}

/** "10:00" from an ISO local timestamp. */
export const hhmm = (iso: string): string => iso.slice(11, 16);
