/**
 * Melbourne wall-clock helpers. The whole policy is expressed in Australia/
 * Melbourne local time, which observes DST, so we never do our own offset
 * arithmetic - `Intl` resolves the correct offset (incl. the DST switch) for
 * any given instant.
 */

/** The zone the whole policy is expressed in. Exported so the dashboard clock
 * shows the same wall time the schedule is judged against, rather than whatever
 * the tablet happens to be set to. */
export const MELBOURNE_TZ = "Australia/Melbourne";
const MELBOURNE = MELBOURNE_TZ;

export interface MelbourneClock {
	readonly hour: number;
	readonly minute: number;
	/** Minutes since local midnight, 0..1439. */
	readonly minutesOfDay: number;
	/** e.g. "Mon" - handy for logs. */
	readonly weekday: string;
}

export function melbourneClock(date: Date = new Date()): MelbourneClock {
	const parts = new Intl.DateTimeFormat("en-AU", {
		timeZone: MELBOURNE,
		hourCycle: "h23", // 00..23, so midnight is 0 not 24
		hour: "2-digit",
		minute: "2-digit",
		weekday: "short",
	}).formatToParts(date);

	const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
	const hour = Number(get("hour"));
	const minute = Number(get("minute"));
	return { hour, minute, minutesOfDay: hour * 60 + minute, weekday: get("weekday") };
}

/** Minutes since local Melbourne midnight for `date`. */
export function melbourneMinutesOfDay(date: Date = new Date()): number {
	return melbourneClock(date).minutesOfDay;
}

/**
 * When "HH:MM" next comes round, as epoch milliseconds.
 *
 * Resolved as a *duration from now* rather than by constructing a local date:
 * the user picking 22:00 means "in about three hours", and measuring forward
 * from the current Melbourne wall time gets that right across a DST boundary
 * without any offset arithmetic of our own. A time that has already passed today
 * means tomorrow.
 *
 * Returns null for anything that isn't a real time of day, so a malformed value
 * is rejected rather than silently scheduling something for the epoch.
 */
export function nextOccurrenceMs(hhmm: string, now: Date = new Date()): number | null {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
	if (!m) return null;

	const target = Number(m[1]) * 60 + Number(m[2]);
	const current = melbourneClock(now).minutesOfDay;
	// Same minute counts as "now", not "in 24 hours".
	const deltaMin = target >= current ? target - current : target - current + 24 * 60;
	return now.getTime() + deltaMin * 60_000;
}
