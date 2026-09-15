/**
 * Two hand-picked palettes - one for the cream daytime scene, one chosen for the
 * dark night surface (not an automatic flip of the day one) - and a lerp so
 * dusk and dawn glide between them instead of snapping.
 */
export interface Palette {
	page: string;
	ground: string;
	groundEdge: string;
	drive: string;
	driveEdge: string;

	wallTop: string;
	wallLeft: string;
	wallRight: string;

	roofTop: string;
	roofLeft: string;
	roofRight: string;
	soffit: string;

	panel: string;
	panelGrid: string;
	panelLit: string;

	windowFrame: string;
	windowGlass: string;
	windowLight: string;

	foliage: string;
	foliageDark: string;
	foliageLight: string;
	trunk: string;

	car: string;
	carDark: string;
	carGlass: string;

	device: string;
	deviceEdge: string;

	ink: string;
	inkDim: string;
	muted: string;
	shadow: string;

	/** Page chrome (banner, stat strip); interpolated with everything else. */
	surface: string;
	hairline: string;

	/** Flow tones, stepped for their own surface and contrast-checked on it. */
	flowGood: string;
	flowWarning: string;
	flowBattery: string;
	flowCritical: string;
}

/** Sampled from the reference illustration. */
export const DAY: Palette = {
	page: "#F2EDE3",
	ground: "#E4DCCE",
	groundEdge: "#2E7D74",
	drive: "#F7F3EA",
	driveEdge: "#CFC4B1",

	wallTop: "#FBF7F0",
	wallLeft: "#EFE8DC",
	wallRight: "#D9CFBE",

	roofTop: "#27374F",
	roofLeft: "#1E2C43",
	roofRight: "#16212F",
	soffit: "#F5F0E6",

	panel: "#1B2A40",
	panelGrid: "#93A3B8",
	panelLit: "#7FC9F0",

	windowFrame: "#1E2C43",
	windowGlass: "#B8CBD8",
	windowLight: "#F6E2B8",

	foliage: "#3E8C82",
	foliageDark: "#1F4048",
	foliageLight: "#5AA79C",
	trunk: "#1F3A43",

	car: "#E8543C",
	carDark: "#C03F2B",
	carGlass: "#22303F",

	device: "#FBF7F0",
	deviceEdge: "#C9BFB0",

	ink: "#1B2430",
	inkDim: "#4A5563",
	muted: "#7C8794",
	shadow: "rgba(31,58,67,0.16)",

	surface: "#E8E1D5",
	hairline: "#D8CFC0",

	// Validated against the cream surface: all four clear 3:1 and sit inside the
	// light lightness band.
	flowGood: "#0A7D28",
	flowWarning: "#A05C06",
	flowBattery: "#2364B0",
	flowCritical: "#B02D2C",
};

/** Chosen for the dark surface, then checked against it - not a flip of DAY. */
export const NIGHT: Palette = {
	page: "#0B1420",
	ground: "#16212F",
	groundEdge: "#1F544F",
	drive: "#212D3D",
	driveEdge: "#2A3746",

	wallTop: "#39485E",
	wallLeft: "#2C3849",
	wallRight: "#202B3A",

	roofTop: "#16202F",
	roofLeft: "#111925",
	roofRight: "#0C121C",
	soffit: "#3A4860",

	panel: "#0F1826",
	panelGrid: "#3A4A5F",
	panelLit: "#2A5F80",

	windowFrame: "#0C121C",
	windowGlass: "#1A2635",
	windowLight: "#FFCE7A",

	foliage: "#256058",
	foliageDark: "#173B41",
	foliageLight: "#2F7268",
	trunk: "#101F26",

	car: "#C4432F",
	carDark: "#8E2F20",
	carGlass: "#111A24",

	device: "#2A3547",
	deviceEdge: "#3B485C",

	ink: "#F2F4F7",
	inkDim: "#C2CAD5",
	muted: "#8A93A0",
	shadow: "rgba(0,0,0,0.35)",

	surface: "#16212F",
	hairline: "#232E3D",

	// Re-stepped for the dark surface rather than reusing the day values.
	flowGood: "#17994A",
	flowWarning: "#C07C10",
	flowBattery: "#4285D6",
	flowCritical: "#CE4A46",
};

/** Blend two palettes. `t` 0 = night, 1 = day. */
export function mixPalette(night: Palette, day: Palette, t: number): Palette {
	const k = clamp01(t);
	const out = {} as Palette;
	for (const key of Object.keys(day) as (keyof Palette)[]) {
		out[key] = mixColor(night[key], day[key], k);
	}
	return out;
}

/** Blends hex or rgba() colours. Anything unparseable falls back to `b`. */
export function mixColor(a: string, b: string, t: number): string {
	// Hand back the endpoints untouched: avoids re-formatting (#F2EDE3 vs
	// #f2ede3) and makes a fully-day or fully-night palette identical to source.
	if (t <= 0) return a;
	if (t >= 1) return b;
	const ca = parse(a);
	const cb = parse(b);
	if (!ca || !cb) return t > 0.5 ? b : a;
	const k = clamp01(t);
	const m = (i: number): number => Math.round(ca[i]! + (cb[i]! - ca[i]!) * k);
	const alpha = ca[3]! + (cb[3]! - ca[3]!) * k;
	return alpha >= 1
		? `#${[m(0), m(1), m(2)].map((n) => n.toString(16).padStart(2, "0")).join("")}`
		: `rgba(${m(0)},${m(1)},${m(2)},${Math.round(alpha * 100) / 100})`;
}

function parse(c: string): [number, number, number, number] | null {
	const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
	if (hex) {
		const n = Number.parseInt(hex[1]!, 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
	}
	const rgba = /^rgba?\(([^)]+)\)$/i.exec(c.trim());
	if (rgba) {
		const parts = rgba[1]!.split(",").map((s) => Number.parseFloat(s.trim()));
		if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
			return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
		}
	}
	return null;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Twilight, chosen rather than averaged.
 *
 * Blending the cream day surface straight into the navy night one runs the whole
 * scene through grey - around 50% daylight every colour lands on a desaturated
 * mud that reads as "faded out" rather than as evening. Routing the blend through
 * a real twilight keeps dusk and dawn saturated: indigo sky, warm light in the
 * windows, foliage still green.
 */
export const DUSK: Palette = {
	page: "#2B2440",
	ground: "#352C4C",
	groundEdge: "#4A7A72",
	drive: "#3D3357",
	driveEdge: "#4A3F63",

	wallTop: "#7A6B8C",
	wallLeft: "#5E5273",
	wallRight: "#453B5A",

	roofTop: "#2E2745",
	roofLeft: "#241E38",
	roofRight: "#1B1729",
	soffit: "#4A3F63",

	panel: "#201B33",
	panelGrid: "#3A3152",
	panelLit: "#6E5FA0",

	windowFrame: "#2A2340",
	windowGlass: "#4A4066",
	windowLight: "#F5C97A",

	foliage: "#2F6560",
	foliageDark: "#1E4448",
	foliageLight: "#3A7A70",
	trunk: "#3A3050",

	car: "#D8503C",
	carDark: "#8E3226",
	carGlass: "#4E4470",

	device: "#3D3357",
	deviceEdge: "#574A73",

	ink: "#F5F0EA",
	inkDim: "#D2CADD",
	muted: "#9C93AE",
	shadow: "rgba(10,6,20,0.35)",

	surface: "#362D4E",
	hairline: "#473C5E",

	// The night steps clear 3:1 and sit in band on this surface too.
	flowGood: "#17994A",
	flowWarning: "#C07C10",
	flowBattery: "#4285D6",
	flowCritical: "#CE4A46",
};

/**
 * The palette for a given daylight fraction (0 dark, 1 full day), by way of
 * twilight. Two half-blends rather than one long one, so nothing ever sits on
 * the day/night average.
 */
export function skyPalette(daylight: number): Palette {
	const t = Math.min(1, Math.max(0, daylight));
	return t >= 0.5 ? mixPalette(DUSK, DAY, (t - 0.5) * 2) : mixPalette(NIGHT, DUSK, t * 2);
}

/**
 * A grey day, chosen rather than filtered.
 *
 * Desaturating the day palette programmatically gives a washed-out version of a
 * sunny scene; a real overcast is cooler and flatter, with the contrast between
 * lit and shaded faces largely gone because there is no direct sun to cast it.
 * Same reasoning as DUSK: averaging toward grey produced mud, so the grey is
 * picked by hand.
 */
export const OVERCAST: Palette = {
	page: "#DEDFDD",
	ground: "#CFD2CE",
	groundEdge: "#6E8A85",
	drive: "#DCDDD9",
	driveEdge: "#BFC1BC",

	// Barely separated: flat light means the three faces stop reading as three.
	wallTop: "#DFDFDC",
	wallLeft: "#D2D3CF",
	wallRight: "#BFC1BD",

	roofTop: "#3A4452",
	roofLeft: "#333C49",
	roofRight: "#2B333E",
	soffit: "#B8BAB6",

	panel: "#2E3742",
	panelGrid: "#454F5C",
	panelLit: "#5C6675",

	windowFrame: "#3A4452",
	windowGlass: "#C3CBD2",
	windowLight: "#E8DFC4",

	foliage: "#5E7F79",
	foliageDark: "#3D5A58",
	foliageLight: "#6F918A",
	trunk: "#6A6A64",

	car: "#C25742",
	carDark: "#8E3B2C",
	carGlass: "#9AA6AE",

	device: "#D5D6D2",
	deviceEdge: "#B4B6B1",

	ink: "#242A31",
	inkDim: "#4C545D",
	muted: "#7A8087",
	shadow: "rgba(40,46,54,0.14)",

	surface: "#D5D7D3",
	hairline: "#C2C4BF",

	// Unchanged from DAY: these are validated against a light surface and the
	// overcast page is light too, so they keep their contrast.
	flowGood: "#0A7D28",
	flowWarning: "#A05C06",
	flowBattery: "#2364B0",
	flowCritical: "#B02D2C",
};

/** Heaviest overcast still leaves a quarter of the scene's own colour. */
const MAX_OVERCAST = 0.75;

/**
 * The palette for the current sky, cloud included.
 *
 * Cloud is scaled by daylight so night is untouched - a cloudy night already
 * looks like night, and greying it further would say nothing. The cap stops even
 * total cover from replacing the scene's identity: it should still look like
 * this house, on a grey day.
 */
export function weatherPalette(daylight: number, cloudCoverPct: number | null): Palette {
	const base = skyPalette(daylight);
	if (cloudCoverPct === null) return base;
	const cover = Math.min(100, Math.max(0, cloudCoverPct)) / 100;
	const t = cover * Math.min(1, Math.max(0, daylight)) * MAX_OVERCAST;
	return t <= 0 ? base : mixPalette(base, OVERCAST, t);
}
