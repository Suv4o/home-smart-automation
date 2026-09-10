import { logger } from "../logger.ts";

/**
 * Weather from Open-Meteo, chosen because it needs no API key at all.
 *
 * This repository is public, so a feed that requires no credential adds nothing
 * to leak, rotate or forget. It is also the only free keyless source that
 * returns hourly `shortwave_radiation`, which is what lets the dashboard answer
 * the question the whole project is about: will there be enough sun tomorrow to
 * charge the car for free?
 *
 * Free tier is 10,000 requests/day for non-commercial use; one call every 15
 * minutes uses about 96.
 */
const BASE = "https://api.open-meteo.com/v1/forecast";

import { DEFAULT_FACTOR } from "./solar-calibration.ts";

export interface Condition {
	/** WMO weather code as returned by the API. */
	readonly code: number;
	readonly label: string;
	/** Icon name the UI maps to a glyph. */
	readonly icon: "sun" | "cloud-sun" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";
}

export interface HourlySun {
	/** Local wall-clock hour, "HH:MM". */
	readonly time: string;
	/** Downward shortwave radiation, W/m². */
	readonly radiationWm2: number;
	/** Estimated PV output in watts, or null when the array size is unknown. */
	readonly estimatedW: number | null;
}

export interface WeatherReading {
	readonly at: Date;
	readonly temperatureC: number;
	readonly feelsLikeC: number;
	readonly cloudCoverPct: number;
	readonly isDay: boolean;
	readonly condition: Condition;
	readonly todayMaxC: number | null;
	readonly todayMinC: number | null;
	/** Today and tomorrow, hour by hour, for the solar outlook. */
	readonly sun: readonly HourlySun[];
	/** IANA zone the times above are expressed in. */
	readonly timezone: string;
}

/**
 * WMO 4677 weather codes, grouped to the distinctions worth drawing.
 *
 * Deliberately coarse: on a display read from across a room, "light drizzle"
 * versus "moderate drizzle" is noise. Anything unrecognised falls back to cloud
 * rather than throwing - a new code must not break the dashboard.
 */
export function wmoCondition(code: number): Condition {
	const of = (label: string, icon: Condition["icon"]): Condition => ({ code, label, icon });
	if (code === 0) return of("Clear", "sun");
	if (code === 1) return of("Mostly clear", "sun");
	if (code === 2) return of("Partly cloudy", "cloud-sun");
	if (code === 3) return of("Overcast", "cloud");
	if (code === 45 || code === 48) return of("Fog", "fog");
	if (code >= 51 && code <= 57) return of("Drizzle", "drizzle");
	if (code >= 61 && code <= 67) return of("Rain", "rain");
	if (code >= 71 && code <= 77) return of("Snow", "snow");
	if (code >= 80 && code <= 82) return of("Showers", "rain");
	if (code === 85 || code === 86) return of("Snow showers", "snow");
	// Bounded: WMO tops out at 99, and an unrecognised code must not be
	// announced as a thunderstorm just for being a large number.
	if (code >= 95 && code <= 99) return of("Thunderstorm", "storm");
	return of("Cloudy", "cloud");
}

/**
 * PV output for a given irradiance.
 *
 * `factor` converts horizontal irradiance into this roof's actual output. It is
 * measured from real generation rather than modelled - see solar-calibration.ts
 * for why guessing at roof pitch and losses got this badly wrong.
 *
 * Returns null when the array size isn't known, so the UI shows irradiance alone
 * rather than a number it can't stand behind.
 */
export function estimatePv(radiationWm2: number, arrayKwp: number | null, factor = DEFAULT_FACTOR): number | null {
	if (arrayKwp === null || !(arrayKwp > 0)) return null;
	return Math.max(0, Math.round((radiationWm2 / 1000) * arrayKwp * factor * 1000));
}

/**
 * The run of hours where the sun alone would clear the policy's own bar.
 *
 * `thresholdW` is meant to be the same figure the solar rule uses -
 * `solarCoverRatio × (house + car)` - so the forecast answers the question the
 * policy will actually ask rather than an invented one.
 *
 * Returns the first contiguous run, which for a single day is the useful one; a
 * cloudy interruption splits it and we report the longer half.
 */
export function sunnyWindow(
	hours: readonly HourlySun[],
	thresholdW: number,
): { from: string; to: string; hours: number } | null {
	let best: { from: string; to: string; hours: number } | null = null;
	let run: HourlySun[] = [];

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

interface Options {
	readonly latitude: number;
	readonly longitude: number;
	readonly arrayKwp: number | null;
	/** Measured output per unit of horizontal irradiance for this roof. */
	readonly factor?: number;
	readonly timezone: string;
	/** Overridable so a test can point at a dead host. */
	readonly baseUrl?: string;
	readonly timeoutMs?: number;
}

/**
 * Coordinates are rounded before they leave the process.
 *
 * Open-Meteo snaps to its own model grid anyway - a request for -37.87/145.28
 * comes back as -37.85589/145.25468 - so the exact address buys no accuracy and
 * would only hand our home location to a third party.
 */
export function roundCoord(value: number): number {
	return Math.round(value * 100) / 100;
}

export function forecastUrl(o: Options): string {
	const url = new URL(o.baseUrl ?? BASE);
	url.searchParams.set("latitude", String(roundCoord(o.latitude)));
	url.searchParams.set("longitude", String(roundCoord(o.longitude)));
	url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,cloud_cover,is_day");
	url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
	url.searchParams.set("hourly", "shortwave_radiation");
	url.searchParams.set("timezone", o.timezone);
	url.searchParams.set("forecast_days", "2");
	return url.toString();
}

/** Map the API's shape into ours. Exported so tests can feed it a real payload. */
export function parseForecast(json: unknown, arrayKwp: number | null, factor = DEFAULT_FACTOR): WeatherReading {
	const d = json as {
		timezone?: string;
		current?: Record<string, number | string>;
		daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
		hourly?: { time?: string[]; shortwave_radiation?: number[] };
	};
	const cur = d.current;
	if (!cur || typeof cur["temperature_2m"] !== "number") {
		throw new Error("weather response has no current temperature");
	}

	const times = d.hourly?.time ?? [];
	const rad = d.hourly?.shortwave_radiation ?? [];
	const sun: HourlySun[] = times.map((t, i) => {
		const radiationWm2 = rad[i] ?? 0;
		return { time: t, radiationWm2, estimatedW: estimatePv(radiationWm2, arrayKwp, factor) };
	});

	return {
		at: new Date(),
		temperatureC: cur["temperature_2m"] as number,
		feelsLikeC: (cur["apparent_temperature"] as number) ?? (cur["temperature_2m"] as number),
		cloudCoverPct: (cur["cloud_cover"] as number) ?? 0,
		isDay: Number(cur["is_day"] ?? 0) === 1,
		condition: wmoCondition(Number(cur["weather_code"] ?? -1)),
		todayMaxC: d.daily?.temperature_2m_max?.[0] ?? null,
		todayMinC: d.daily?.temperature_2m_min?.[0] ?? null,
		sun,
		timezone: d.timezone ?? "UTC",
	};
}

/** Fetches one reading. Throws on any failure; the caller decides what that means. */
export async function fetchWeather(o: Options): Promise<WeatherReading> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 10_000);
	try {
		const res = await fetch(forecastUrl(o), { signal: controller.signal });
		if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
		return parseForecast(await res.json(), o.arrayKwp, o.factor ?? DEFAULT_FACTOR);
	} finally {
		clearTimeout(timer);
	}
}

export function logWeather(w: WeatherReading): void {
	logger.debug({ tempC: w.temperatureC, cloud: w.cloudCoverPct, code: w.condition.code }, "weather");
}
