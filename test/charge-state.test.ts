import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chargeState, overrideAction } from "../src/engine/charge-state.ts";

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

const CHARGE_5H = { mode: "force_on", releaseWhenDone: true } as const;

/**
 * "Charge for 5 hours, but stop early if the car finishes." The whole risk here
 * is misreading *why* the car isn't drawing, so each wrong reason gets a test.
 */
describe("overrideAction", () => {
	it("does nothing at all unless the option was asked for", () => {
		assert.equal(overrideAction({ mode: "force_on" }, "waiting"), "keep");
		assert.equal(overrideAction({ mode: "force_on", releaseWhenDone: false }, "waiting"), "keep");
		assert.equal(overrideAction(null, "waiting"), "keep");
	});

	it("is meaningless for a pause, and stays out of the way", () => {
		// Nothing "finishes" when the point is to keep the charger off.
		assert.equal(overrideAction({ mode: "force_off", releaseWhenDone: true }, "waiting"), "keep");
	});

	it("remembers the first time the car draws", () => {
		assert.equal(overrideAction(CHARGE_5H, "charging"), "mark-charging");
		assert.equal(overrideAction({ ...CHARGE_5H, sawCharging: true }, "charging"), "keep");
	});

	it("releases once a car that was charging stops", () => {
		assert.equal(overrideAction({ ...CHARGE_5H, sawCharging: true }, "waiting"), "release");
	});

	it("does not release an override set before the cable went in", () => {
		// The socket is live and nothing is drawing, but the car never started -
		// releasing here would cancel the override the moment it was created.
		assert.equal(overrideAction(CHARGE_5H, "waiting"), "keep");
	});

	it("never treats the breaker guard's pause as the car finishing", () => {
		// Plug switched off by Rule 0. The car has not finished; it was stopped.
		assert.equal(overrideAction({ ...CHARGE_5H, sawCharging: true }, "off"), "keep");
		assert.equal(overrideAction(CHARGE_5H, "off"), "keep");
	});

	it("survives the guard interrupting and the charge resuming", () => {
		// charging -> guard trips (off) -> guard clears (charging) -> car finishes
		let o = { ...CHARGE_5H } as { mode: string; releaseWhenDone?: boolean; sawCharging?: boolean };
		assert.equal(overrideAction(o, "charging"), "mark-charging");
		o = { ...o, sawCharging: true };
		assert.equal(overrideAction(o, "off"), "keep", "guard must not end the override");
		assert.equal(overrideAction(o, "charging"), "keep");
		assert.equal(overrideAction(o, "waiting"), "release");
	});
});
