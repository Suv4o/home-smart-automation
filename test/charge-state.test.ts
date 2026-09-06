import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chargeState } from "../src/engine/charge-state.ts";

const MIN = 500;

describe("chargeState", () => {
	it("is off when the plug is off, whatever it reports", () => {
		assert.equal(chargeState({ on: false, powerW: 0 }, MIN), "off");
		// A stale power figure on a switched-off plug must not read as charging.
		assert.equal(chargeState({ on: false, powerW: 2000 }, MIN), "off");
	});

	it("is off when the plug can't be read at all", () => {
		assert.equal(chargeState(null, MIN), "off");
	});

	it("is waiting when the socket is live but nothing is drawing", () => {
		// The case that prompted this: cable not in the car. The plug idles at a
		// few watts and the dashboard used to call that "charging".
		assert.equal(chargeState({ on: true, powerW: 0 }, MIN), "waiting");
		assert.equal(chargeState({ on: true, powerW: 4 }, MIN), "waiting");
		assert.equal(chargeState({ on: true, powerW: 499 }, MIN), "waiting");
	});

	it("is charging once the car is really pulling power", () => {
		assert.equal(chargeState({ on: true, powerW: 500 }, MIN), "charging");
		// What a mobile connector actually draws.
		assert.equal(chargeState({ on: true, powerW: 2050 }, MIN), "charging");
	});

	it("puts the threshold well below a real charge and well above an idle socket", () => {
		const idle = 5;
		const real = 2000;
		assert.ok(idle < MIN && MIN < real, "threshold separates the two cases with room to spare");
	});
});
