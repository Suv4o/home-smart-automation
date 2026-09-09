import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { carIsFull, chargeState, overrideAction } from "../src/engine/charge-state.ts";

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

const LIVE = { on: true, powerW: 3 };
const DRAWING = { on: true, powerW: 2050 };

/**
 * A live plug with nothing drawing has two causes that look identical at the
 * socket: the cable was never plugged in, or the car finished and stopped. The
 * dashboard used to assert the first, so a car sitting there fully charged was
 * told to plug itself in.
 */
describe("full vs never-plugged-in", () => {
	it("believes the car when it says it has finished", () => {
		assert.equal(chargeState(LIVE, MIN, { soc: 99, chargeLimit: 100, chargingState: "Complete" }), "full");
	});

	it("believes the car when it says the cable is out", () => {
		// Even at a level that would otherwise read as full.
		assert.equal(chargeState(LIVE, MIN, { soc: 100, chargeLimit: 100, chargingState: "Disconnected" }), "waiting");
	});

	it("falls back to the level when the car gives no status", () => {
		// The reported bug: last seen at 99% against a 100% limit, because the
		// final poll landed before the car topped off.
		assert.equal(chargeState(LIVE, MIN, { soc: 99, chargeLimit: 100, chargingState: null }), "full");
		assert.equal(chargeState(LIVE, MIN, { soc: 78, chargeLimit: 80, chargingState: null }), "full");
	});

	it("still says waiting for a car nowhere near its limit", () => {
		assert.equal(chargeState(LIVE, MIN, { soc: 52, chargeLimit: 80, chargingState: null }), "waiting");
		assert.equal(chargeState(LIVE, MIN, { soc: 60, chargeLimit: 100, chargingState: null }), "waiting");
	});

	it("does not guess when it knows nothing about the car", () => {
		assert.equal(chargeState(LIVE, MIN, null), "waiting");
		assert.equal(chargeState(LIVE, MIN, { soc: 99, chargeLimit: null, chargingState: null }), "waiting");
	});

	it("never calls a drawing car full, whatever it last reported", () => {
		assert.equal(chargeState(DRAWING, MIN, { soc: 99, chargeLimit: 100, chargingState: "Complete" }), "charging");
	});

	it("never calls a switched-off plug full", () => {
		assert.equal(chargeState({ on: false, powerW: 0 }, MIN, { soc: 100, chargeLimit: 100, chargingState: "Complete" }), "off");
	});

	it("tolerates the gap between the last poll and the finish, but not more", () => {
		assert.equal(carIsFull({ soc: 97, chargeLimit: 100, chargingState: null }), true);
		assert.equal(carIsFull({ soc: 96, chargeLimit: 100, chargingState: null }), false);
	});
});

/** Ending an override early must still fire now that "finished" has its own state. */
describe("early release still triggers when the car fills up", () => {
	it("releases on the confirmed-full state, not just the ambiguous one", () => {
		const o = { mode: "force_on", releaseWhenDone: true, sawCharging: true } as const;
		assert.equal(overrideAction(o, "full"), "release");
		assert.equal(overrideAction(o, "waiting"), "release");
	});

	it("still ignores a car that never started", () => {
		assert.equal(overrideAction({ mode: "force_on", releaseWhenDone: true }, "full"), "keep");
	});
});
