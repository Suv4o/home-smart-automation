/**
 * Where the weather goes in the sky, and how much of it there is.
 *
 * Pure and deterministic on purpose. The scene re-renders every fifteen seconds
 * as new readings arrive, so anything positioned with `Math.random()` at render
 * time would teleport four times a minute - a twitching sky is far worse than no
 * weather at all.
 *
 * Instead one fixed pool of layouts is generated once, here, and the scene draws
 * the first N of it. Cloud three is always in the same place, so cover rising
 * from 40% to 70% *adds* clouds rather than rearranging the ones already there.
 */

/** Screen-space band the sky occupies, from the scene's viewBox. */
const SKY = { left: -260, right: 250, top: -310, bottom: -120 } as const;

/**
 * mulberry32. Small, fast, and - the only property that matters here - gives the
 * same sequence every time, so the sky is identical on every render and across
 * every device looking at the same dashboard.
 */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Puff {
	dx: number;
	dy: number;
	r: number;
}

export interface CloudLayout {
	/** Where the cluster sits before it starts drifting. */
	x: number;
	y: number;
	/** Overall size multiplier. */
	scale: number;
	/** Seconds for one pass across the sky - varied, so they parallax. */
	driftS: number;
	/** Negative delay, so every cloud is already mid-journey on first paint. */
	delayS: number;
	opacity: number;
	puffs: Puff[];
}

/** The most clouds a fully overcast sky gets. Capped for the tablet's sake. */
export const MAX_CLOUDS = 6;

/**
 * Built once at module load. Ordered largest-and-highest first so that a
 * partly-cloudy sky gets the shapes that read best on their own, and heavier
 * cover fills in around them.
 */
export const CLOUDS: CloudLayout[] = (() => {
	const rand = seeded(0x5eed_c10d);
	const pool = Array.from({ length: MAX_CLOUDS }, () => {
		const scale = 0.75 + rand() * 0.7;
		const puffCount = 3 + Math.floor(rand() * 3);
		return {
			x: SKY.left + rand() * (SKY.right - SKY.left),
			y: SKY.top + rand() * (SKY.bottom - SKY.top),
			scale,
			driftS: 90 + rand() * 60,
			delayS: -rand() * 150,
			opacity: 0.72 + rand() * 0.24,
			puffs: Array.from({ length: puffCount }, (_, j) => ({
				dx: (j - (puffCount - 1) / 2) * (16 + rand() * 8),
				dy: (rand() - 0.5) * 9,
				// Middle puffs are the tall ones, which is what makes a flat cluster
				// of circles read as a cloud rather than a caterpillar.
				r: (12 + rand() * 7) * (1 - Math.abs(j - (puffCount - 1) / 2) / puffCount),
			})),
		};
	});
	// Biggest first, so a barely-cloudy sky gets the shapes that read best alone
	// and heavier cover fills in around them.
	return pool.sort((a, b) => b.scale - a.scale);
})();

export interface StarLayout {
	x: number;
	y: number;
	r: number;
	breatheS: number;
	delayS: number;
}

export const STARS: StarLayout[] = (() => {
	const rand = seeded(0x57a2_5eed);
	return Array.from({ length: 16 }, () => ({
		x: SKY.left + rand() * (SKY.right - SKY.left),
		y: SKY.top + rand() * (SKY.bottom - SKY.top + 40),
		r: 1.2 + rand() * 1.6,
		breatheS: 4 + rand() * 3,
		delayS: -rand() * 7,
	}));
})();

export interface DropLayout {
	x: number;
	/** Vertical head start, so drops aren't all released together. */
	y: number;
	len: number;
	fallS: number;
	delayS: number;
	opacity: number;
}

/** The heaviest rain we draw. Beyond this it stops reading as individual drops. */
export const MAX_DROPS = 34;

export const DROPS: DropLayout[] = (() => {
	const rand = seeded(0x2a1_2a1);
	return Array.from({ length: MAX_DROPS }, () => ({
		x: -280 + rand() * 560,
		y: -300 + rand() * 560,
		len: 7 + rand() * 9,
		fallS: 0.7 + rand() * 0.5,
		delayS: -rand() * 1.2,
		opacity: 0.25 + rand() * 0.3,
	}));
})();

/**
 * How many clouds a given cover fraction earns.
 *
 * Banded rather than linear: a clear sky must be genuinely empty (2% cover is
 * clear, not "a bit of one cloud"), and the top of the range should read as a
 * bank rather than a tidy row.
 */
export function cloudCount(coverPct: number): number {
	const c = Math.min(100, Math.max(0, coverPct));
	if (c < 10) return 0;
	if (c < 30) return 1;
	if (c < 50) return 2;
	if (c < 70) return 4;
	if (c < 88) return 5;
	return MAX_CLOUDS;
}

/** Stars are only worth drawing when the sky is actually clear enough to see them. */
export function starCount(coverPct: number, isDay: boolean): number {
	if (isDay || coverPct >= 55) return 0;
	// Fade the field out as cloud builds rather than snapping to none.
	return Math.round(STARS.length * (1 - coverPct / 55));
}

/** How hard it is raining, from the reported condition. */
export function rainCount(icon: string, precipitationMm = 0): number {
	if (icon === "drizzle") return 14;
	if (icon === "rain") return precipitationMm >= 2 ? MAX_DROPS : 26;
	if (icon === "storm") return MAX_DROPS;
	return 0;
}

/**
 * Rain lean, in degrees, from the direction the wind is blowing *from*.
 *
 * Clamped hard: a real gale would lay the rain almost flat, which stops reading
 * as rain and starts reading as a glitch. Wind from the west leans it right.
 */
export function rainAngle(windFromDeg: number | null): number {
	if (windFromDeg === null || !Number.isFinite(windFromDeg)) return 8;
	const rad = ((windFromDeg + 180) * Math.PI) / 180;
	return Math.max(-22, Math.min(22, Math.sin(rad) * 22));
}

export { SKY };
