import type { Pt } from "./iso.ts";

/**
 * An orthogonal polyline with rounded corners - the circuit-trace routing the
 * reference illustration uses for its energy paths.
 *
 * Each corner is cut back by `radius` along both adjacent segments and bridged
 * with a quadratic curve through the original corner. The cut is clamped to
 * half the shorter segment so tight corners degrade gracefully instead of
 * overshooting and folding back on themselves.
 */
export function roundedPath(points: Pt[], radius = 18): string {
	if (points.length === 0) return "";
	if (points.length === 1) return `M${fmt(points[0]!)}`;
	if (points.length === 2) return `M${fmt(points[0]!)} L${fmt(points[1]!)}`;

	let d = `M${fmt(points[0]!)}`;

	for (let i = 1; i < points.length - 1; i++) {
		const prev = points[i - 1]!;
		const cur = points[i]!;
		const next = points[i + 1]!;

		const inLen = distance(prev, cur);
		const outLen = distance(cur, next);
		// Never eat more than half of either neighbouring segment.
		const r = Math.min(radius, inLen / 2, outLen / 2);

		const start = along(cur, prev, r);
		const end = along(cur, next, r);

		d += ` L${fmt(start)} Q${fmt(cur)} ${fmt(end)}`;
	}

	d += ` L${fmt(points[points.length - 1]!)}`;
	return d;
}

/** Total length of a polyline - used to pace the travelling dots. */
export function polylineLength(points: Pt[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
	return total;
}

/** Roughly one travelling dot per this much wire. */
const PX_PER_DOT = 45;
const MAX_DOTS = 3;

/**
 * How many dots to send along a wire, from its length.
 *
 * A fixed count crowded the short runs: the junction-to-battery wire is about a
 * third the length of the others, so three dots sat ~13px apart and read as
 * agitated rather than as flow. Spacing them by distance instead keeps every
 * wire looking equally busy, whatever its length.
 */
export function dotCount(pathLength: number): number {
	return Math.max(1, Math.min(MAX_DOTS, Math.round(pathLength / PX_PER_DOT)));
}

/** A point `dist` from `from`, heading towards `towards`. */
function along(from: Pt, towards: Pt, dist: number): Pt {
	const len = distance(from, towards) || 1;
	return {
		x: from.x + ((towards.x - from.x) / len) * dist,
		y: from.y + ((towards.y - from.y) / len) * dist,
	};
}

function distance(a: Pt, b: Pt): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

const fmt = (p: Pt): string => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;
