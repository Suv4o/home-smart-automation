import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type Calibration,
	DEFAULT_FACTOR,
	isSamplingMinute,
	nextFactor,
	sampleFactor,
} from "../src/providers/solar-calibration.ts";

/**
 * The forecast's conversion from irradiance to watts is measured, not modelled.
 * Guessing at roof pitch and system losses put this house's estimate out by
 * 1.65x - it said 1.6 kW while the roof was making 2.7 kW.
 */
describe("sampleFactor", () => {
	it("recovers the real ratio from a real observation", () => {
		// 2700 W produced under 484 W/m² horizontal, on a 4.23 kWp array.
		const f = sampleFactor({ observedW: 2700, ghiWm2: 484, arrayKwp: 4.23, batterySoc: 60 });
		assert.ok(f !== null);
		assert.equal(Math.round(f * 100) / 100, 1.32);
	});

	it("ignores weak sun, where the ratio is mostly noise", () => {
		// Near dawn a small error in either figure becomes a wild ratio.
		assert.equal(sampleFactor({ observedW: 400, ghiWm2: 150, arrayKwp: 4.23, batterySoc: 60 }), null);
		assert.equal(sampleFactor({ observedW: 100, ghiWm2: 500, arrayKwp: 4.23, batterySoc: 60 }), null);
	});

	it("ignores ratios no roof could produce", () => {
		// Export limiting, a curtailed inverter, or a field that stopped meaning
		// what we think - none of them should teach us anything.
		assert.equal(sampleFactor({ observedW: 20000, ghiWm2: 300, arrayKwp: 4.23, batterySoc: 60 }), null);
		assert.equal(sampleFactor({ observedW: 310, ghiWm2: 900, arrayKwp: 4.23, batterySoc: 60 }), null);
	});

	it("needs to know the array size", () => {
		assert.equal(sampleFactor({ observedW: 2700, ghiWm2: 484, arrayKwp: 0, batterySoc: 60 }), null);
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

/**
 * The two failures that destroyed the first calibration, both locked down.
 *
 * A full house battery leaves the panels nowhere to send power, so the inverter
 * throttles them: the reading then measures demand, not sun. On one clear day
 * that produced 1.51 at midday and 0.34 in the afternoon, and averaging the two
 * left 0.37 - which forecast 1.0 kW for a day the roof made 3.5 kW.
 */
describe("curtailed output is not a calibration sample", () => {
	const good = { observedW: 2700, ghiWm2: 484, arrayKwp: 4.23 };

	it("learns nothing while the battery is full", () => {
		assert.equal(sampleFactor({ ...good, batterySoc: 100 }), null);
		assert.equal(sampleFactor({ ...good, batterySoc: 95 }), null);
	});

	it("still learns while the battery has room to absorb the surplus", () => {
		assert.ok(sampleFactor({ ...good, batterySoc: 94 }) !== null);
		assert.ok(sampleFactor({ ...good, batterySoc: 30 }) !== null);
	});

	it("rejects the afternoon reading that poisoned the average", () => {
		// 370 W against 255 W/m² with the battery at 99%: throttled, not dim.
		assert.equal(sampleFactor({ observedW: 370, ghiWm2: 255, arrayKwp: 4.23, batterySoc: 99 }), null);
	});
});

describe("sampling cadence", () => {
	it("only takes readings near the middle of the hour", () => {
		// The irradiance figure is an hourly average, so the midpoint reading is
		// the fairest match for it.
		assert.equal(isSamplingMinute(30), true);
		assert.equal(isSamplingMinute(20), true);
		assert.equal(isSamplingMinute(40), true);
	});

	it("ignores the edges of the hour, where sun and average diverge most", () => {
		assert.equal(isSamplingMinute(0), false);
		assert.equal(isSamplingMinute(19), false);
		assert.equal(isSamplingMinute(41), false);
		assert.equal(isSamplingMinute(59), false);
	});
});
