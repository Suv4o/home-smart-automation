import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etaLabel } from "./format.ts";

const MIN = 60_000;

describe("etaLabel", () => {
	it("shows nothing when the car reports no figure", () => {
		assert.equal(etaLabel(null, 0), null);
	});

	it("counts down from when the reading was taken", () => {
		// The car said 90 minutes, 20 minutes ago: 70 left, not 90.
		assert.equal(etaLabel(90, 20 * MIN), "1h 10m left");
		assert.equal(etaLabel(90, 0), "1h 30m left");
	});

	it("drops the minutes when they land on the hour", () => {
		assert.equal(etaLabel(120, 0), "2h left");
	});

	it("stays in minutes under an hour", () => {
		assert.equal(etaLabel(45, 0), "45m left");
		// Counted down, but still inside the staleness window.
		assert.equal(etaLabel(70, 25 * MIN), "45m left");
	});

	it("says finishing rather than counting past zero", () => {
		assert.equal(etaLabel(10, 30 * MIN), "finishing");
		assert.equal(etaLabel(0, 0), "finishing");
	});

	it("gives up on a reading too old to extrapolate from", () => {
		// Counting down a stale figure invents precision the car never gave us.
		assert.equal(etaLabel(200, 31 * MIN), null);
		assert.notEqual(etaLabel(200, 29 * MIN), null);
	});

	it("ignores a nonsense age rather than inflating the estimate", () => {
		assert.equal(etaLabel(60, -5 * MIN), "1h left");
	});
});
