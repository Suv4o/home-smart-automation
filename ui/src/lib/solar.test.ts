import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chargingThresholdW, peakW, sunWindow, typicalHouseW } from "./solar.ts";
import type { DashboardState } from "./types.ts";

const state = (loadW: number | null): DashboardState =>
	({
		energy: loadW === null ? null : { loadW },
		limits: { solarCoverRatio: 0.7, carPowerW: 2000 },
	}) as DashboardState;

/**
 * The forecast is about tomorrow, so it must not be rewritten by whatever the
 * house is drawing this second. An oven mid-bake once pushed the bar to 5.1 kW
 * and the outlook declared there would be no sun window all day.
 */
describe("typicalHouseW", () => {
	it("ignores a momentary spike", () => {
		assert.equal(typicalHouseW(state(5300)), 1500);
	});

	it("ignores an implausibly low instant too", () => {
		assert.equal(typicalHouseW(state(0)), 300);
	});

	it("follows the house inside the plausible band", () => {
		assert.equal(typicalHouseW(state(800)), 800);
	});

	it("assumes a normal house when there is no reading", () => {
		assert.equal(typicalHouseW(state(null)), 1500);
	});
});

describe("chargingThresholdW", () => {
	it("uses the policy's own arithmetic", () => {
		// 0.7 x (800 house + 2000 car)
		assert.equal(chargingThresholdW(state(800)), 1960);
	});

	it("stays stable when the house spikes", () => {
		// The bar barely moves, where the raw reading would have tripled it.
		assert.equal(chargingThresholdW(state(5300)), 2450);
	});
});

const h = (time: string, estimatedW: number | null) => ({ time, estimatedW });

describe("sunWindow", () => {
	it("finds the longest unbroken run above the bar", () => {
		assert.deepEqual(sunWindow([h("09:00", 2500), h("10:00", 400), h("11:00", 2500), h("12:00", 2600)], 2000), {
			from: "11:00",
			to: "12:00",
			hours: 2,
		});
	});

	it("reports nothing rather than a window it cannot justify", () => {
		assert.equal(sunWindow([h("09:00", null), h("10:00", null)], 2000), null);
		assert.equal(sunWindow([], 2000), null);
	});
});

describe("peakW", () => {
	it("ignores hours it cannot estimate", () => {
		assert.equal(peakW([h("09:00", null), h("10:00", 2400), h("11:00", 900)]), 2400);
		assert.equal(peakW([h("09:00", null)]), null);
	});
});
