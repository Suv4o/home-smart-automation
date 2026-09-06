/** 3256 -> "3.3 kW"; small values stay in watts so "0.0 kW" never appears. */
export function power(watts: number): string {
	const w = Math.abs(watts);
	if (w < 100) return `${Math.round(w)} W`;
	return `${(w / 1000).toFixed(1)} kW`;
}

/** How long ago, in words. Used for the car reading, which can be hours old. */
export function ago(ms: number): string {
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return "just now";
	if (mins === 1) return "1 min ago";
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.round(mins / 60);
	if (hours === 1) return "1 hour ago";
	if (hours < 24) return `${hours} hours ago`;
	const days = Math.round(hours / 24);
	return days === 1 ? "1 day ago" : `${days} days ago`;
}

export type Freshness = "fresh" | "ageing" | "stale" | "unknown";

/**
 * How much to trust the car reading. The display never wakes the car, so this
 * can legitimately be hours old - the UI must say so rather than presenting a
 * stale number as current. Always paired with the age written in words; the
 * dimming alone never carries the meaning.
 */
export function freshness(ageMs: number | null, ttlMs = 60 * 60_000): Freshness {
	if (ageMs === null) return "unknown";
	if (ageMs < ttlMs) return "fresh";
	if (ageMs < 6 * 60 * 60_000) return "ageing";
	return "stale";
}

/** Minutes-since-midnight -> "10:00". */
export function clockLabel(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function countdown(untilMs: number, now = Date.now()): string {
	const left = Math.max(0, untilMs - now);
	const mins = Math.ceil(left / 60_000);
	if (mins < 60) return `${mins} min left`;
	const h = Math.floor(mins / 60);
	return `${h}h ${mins % 60}m left`;
}
