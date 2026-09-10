import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Calibration, DEFAULT_FACTOR, nextFactor, sampleFactor } from "../src/providers/solar-calibration.ts";

/**
 * The forecast's conversion from irradiance to watts is measured, not modelled.
 * Guessing at roof pitch and system losses put this house's estimate out by
 * 1.65x - it said 1.6 kW while the roof was making 2.7 kW.
 */
describe("sampleFactor", () => {
	it("recovers the real ratio from a real observation", () => {
		// 2700 W produced under 484 W/m² horizontal, on a 4.23 kWp array.
		const f = sampleFactor(2700, 484, 4.23);
		assert.ok(f !== null);
		assert.equal(Math.round(f * 100) / 100, 1.32);
	});

	it("ignores weak sun, where the ratio is mostly noise", () => {
		// Near dawn a small error in either figure becomes a wild ratio.
		assert.equal(sampleFactor(400, 150, 4.23), null);
		assert.equal(sampleFactor(100, 500, 4.23), null);
	});

	it("ignores ratios no roof could produce", () => {
		// Export limiting, a curtailed inverter, or a field that stopped meaning
		// what we think - none of them should teach us anything.
		assert.equal(sampleFactor(20000, 300, 4.23), null);
		assert.equal(sampleFactor(310, 900, 4.23), null);
	});

	it("needs to know the array size", () => {
		assert.equal(sampleFactor(2700, 484, 0), null);
	});
});

describe("nextFactor", () => {
	it("takes the first sample as-is", () => {
		assert.equal(nextFactor(null, 1.32).factor, 1.32);
		assert.equal(nextFactor(null, 1.32).samples, 1);
	});

	it("moves slowly, so one odd hour cannot swing it", () => {
		const settled: Calibration = { factor: 1.3, samples: 200, at: Date.now() };
		// An instantaneous reading against an hourly average disagrees often on a
		// broken cloudy day; a single one must barely register.
		const after = nextFactor(settled, 0.4);
		assert.ok(after.factor > 1.22, `moved too far: ${after.factor}`);
		assert.ok(after.factor < 1.3, "but it should move");
	});

	it("converges on the truth given enough samples", () => {
		let c: Calibration | null = null;
		for (let i = 0; i < 200; i++) c = nextFactor(c, 1.32);
		assert.equal(Math.round(c!.factor * 100) / 100, 1.32);
		assert.equal(c!.samples, 200);
	});

	it("stays inside the plausible band whatever it is fed", () => {
		let c: Calibration | null = null;
		for (let i = 0; i < 500; i++) c = nextFactor(c, 99);
		assert.ok(c!.factor <= 2.5, `escaped the ceiling: ${c!.factor}`);
	});

	it("starts from a defensible guess before any samples exist", () => {
		assert.ok(DEFAULT_FACTOR > 0.3 && DEFAULT_FACTOR < 2.5);
	});
});
