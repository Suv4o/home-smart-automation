import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	estimatePv,
	forecastUrl,
	type HourlySun,
	parseForecast,
	roundCoord,
	sunnyWindow,
	wmoCondition,
} from "../src/providers/weather.ts";

const OPTS = { latitude: -37.872402, longitude: 145.28468, arrayKwp: 6.6, timezone: "Australia/Melbourne" };

/**
 * The home coordinates must never leave the process at full precision. Open-Meteo
 * snaps to its own model grid regardless, so rounding costs no accuracy - it
 * only avoids handing a third party the exact address.
 */
describe("coordinate privacy", () => {
	it("rounds to about a kilometre", () => {
		assert.equal(roundCoord(-37.872402), -37.87);
		assert.equal(roundCoord(145.28468), 145.28);
	});

	it("never puts the precise location in the request", () => {
		const url = forecastUrl(OPTS);
		assert.ok(!url.includes("37.872402"), "full-precision latitude must not be sent");
		assert.ok(!url.includes("145.28468"), "full-precision longitude must not be sent");
		assert.match(url, /latitude=-37\.87&/);
		assert.match(url, /longitude=145\.28&/);
	});

	it("asks for the fields the outlook needs, in our timezone", () => {
		const url = forecastUrl(OPTS);
		assert.match(url, /shortwave_radiation/);
		assert.match(url, /timezone=Australia%2FMelbourne/);
	});
});

describe("wmoCondition", () => {
	it("names the codes that matter for solar", () => {
		assert.equal(wmoCondition(0).icon, "sun");
		assert.equal(wmoCondition(2).icon, "cloud-sun");
		assert.equal(wmoCondition(3).icon, "cloud");
		assert.equal(wmoCondition(61).icon, "rain");
		assert.equal(wmoCondition(95).icon, "storm");
	});

	it("falls back rather than throwing on a code it doesn't know", () => {
		// A new or unexpected code must not take the dashboard down.
		const c = wmoCondition(999);
		assert.equal(c.icon, "cloud");
		assert.equal(c.code, 999);
	});
});

describe("estimatePv", () => {
	it("scales irradiance by array size and the measured factor", () => {
		assert.equal(estimatePv(550, 6.6, 0.8), 2904);
		assert.equal(estimatePv(0, 6.6, 0.8), 0);
	});

	it("reproduces the real house once its measured factor is used", () => {
		// 484 W/m² horizontal on a 4.23 kWp array produced 2700 W in reality. The
		// old fixed 0.8 said 1638 W - the error that prompted the calibration.
		assert.equal(estimatePv(484, 4.23, 1.32), 2702); // vs 2700 actually observed
		assert.equal(estimatePv(484, 4.23, 0.8), 1638);
	});

	it("declines to guess when the array size is unknown", () => {
		// Better to show irradiance alone than a number we can't stand behind.
		assert.equal(estimatePv(800, null), null);
		assert.equal(estimatePv(800, 0), null);
	});
});

const hour = (time: string, estimatedW: number | null): HourlySun => ({ time, radiationWm2: 0, estimatedW });

describe("sunnyWindow", () => {
	it("finds the run of hours that clears the policy's own bar", () => {
		const day = [
			hour("2026-09-10T08:00", 500),
			hour("2026-09-10T09:00", 2200),
			hour("2026-09-10T10:00", 2900),
			hour("2026-09-10T11:00", 3100),
			hour("2026-09-10T12:00", 900),
		];
		assert.deepEqual(sunnyWindow(day, 2100), { from: "2026-09-10T09:00", to: "2026-09-10T11:00", hours: 3 });
	});

	it("reports the longer run when cloud splits the day", () => {
		const day = [
			hour("09:00", 2500),
			hour("10:00", 400), // cloud
			hour("11:00", 2500),
			hour("12:00", 2600),
			hour("13:00", 2700),
		];
		assert.deepEqual(sunnyWindow(day, 2100), { from: "11:00", to: "13:00", hours: 3 });
	});

	it("returns nothing when no hour clears it", () => {
		assert.equal(sunnyWindow([hour("09:00", 500), hour("10:00", 900)], 2100), null);
		assert.equal(sunnyWindow([], 2100), null);
	});

	it("never claims a window when the array size is unknown", () => {
		assert.equal(sunnyWindow([hour("09:00", null), hour("10:00", null)], 2100), null);
	});
});

/** A trimmed copy of a real Open-Meteo response, captured while planning. */
const REAL = {
	timezone: "Australia/Melbourne",
	current: { temperature_2m: 8.9, apparent_temperature: 6.0, weather_code: 1, cloud_cover: 45, is_day: 0 },
	daily: { temperature_2m_max: [11.5, 14.2], temperature_2m_min: [7.4, 7.2] },
	hourly: { time: ["2026-09-10T09:00", "2026-09-10T10:00"], shortwave_radiation: [314.0, 443.0] },
};

describe("parseForecast", () => {
	it("maps a real response", () => {
		const w = parseForecast(REAL, 6.6);
		assert.equal(w.temperatureC, 8.9);
		assert.equal(w.feelsLikeC, 6.0);
		assert.equal(w.cloudCoverPct, 45);
		assert.equal(w.isDay, false);
		assert.equal(w.condition.label, "Mostly clear");
		assert.equal(w.todayMaxC, 11.5);
		assert.equal(w.timezone, "Australia/Melbourne");
		assert.equal(w.sun.length, 2);
		assert.equal(w.sun[0]?.estimatedW, parseForecast(REAL, 6.6).sun[0]?.estimatedW);
	});

	it("still parses when the array size is unknown", () => {
		const w = parseForecast(REAL, null);
		assert.equal(w.temperatureC, 8.9);
		assert.equal(w.sun[0]?.estimatedW, null);
	});

	it("throws on a response with no reading, rather than inventing one", () => {
		assert.throws(() => parseForecast({ current: {} }, 6.6), /no current temperature/);
		assert.throws(() => parseForecast({}, 6.6), /no current temperature/);
	});

	it("survives missing optional sections", () => {
		const w = parseForecast({ current: { temperature_2m: 12, weather_code: 3 } }, 6.6);
		assert.equal(w.todayMaxC, null);
		assert.deepEqual(w.sun, []);
	});
});

/**
 * The array size is recovered from figures Solarman already publishes, so the
 * forecast can estimate output without the owner hunting through installation
 * paperwork for their system size.
 */
describe("deriveArrayKwp", () => {
	it("recovers the size from real figures", async () => {
		const { deriveArrayKwp } = await import("../src/providers/solarman-web.ts");
		// Captured from the live system: both today's and lifetime ratios agree.
		assert.equal(deriveArrayKwp({ generationUploadTotal: 1161, fullPowerHoursTotal: 274.4681 }), 4.23);
	});

	it("says nothing for a system too new to have a meaningful ratio", async () => {
		const { deriveArrayKwp } = await import("../src/providers/solarman-web.ts");
		assert.equal(deriveArrayKwp({ generationUploadTotal: 0, fullPowerHoursTotal: 0 }), null);
		assert.equal(deriveArrayKwp({ generationUploadTotal: 5, fullPowerHoursTotal: 0.4 }), null);
	});

	it("rejects a ratio outside any plausible domestic array", async () => {
		const { deriveArrayKwp } = await import("../src/providers/solarman-web.ts");
		// If the fields ever stop meaning what we think, say nothing rather than
		// feeding a nonsense number into the output estimate.
		assert.equal(deriveArrayKwp({ generationUploadTotal: 100000, fullPowerHoursTotal: 2 }), null);
		assert.equal(deriveArrayKwp({ generationUploadTotal: 2, fullPowerHoursTotal: 100 }), null);
	});

	it("survives missing or malformed fields", async () => {
		const { deriveArrayKwp } = await import("../src/providers/solarman-web.ts");
		assert.equal(deriveArrayKwp({}), null);
		assert.equal(deriveArrayKwp(null), null);
		assert.equal(deriveArrayKwp({ generationUploadTotal: "1161", fullPowerHoursTotal: 274 }), null);
	});
});
