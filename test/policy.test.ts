import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChargerState } from "../src/charger/types.ts";
import type { PolicyConfig } from "../src/config.ts";
import { applyCarSocGate, decide, windowFor } from "../src/engine/policy.ts";
import type { EnergySnapshot } from "../src/providers/types.ts";

const config: PolicyConfig = {
	morningStartMin: 5 * 60,
	freeStartMin: 10 * 60,
	freeEndMin: 14 * 60,
	batteryStartPct: 40,
	batteryStopPct: 15,
	solarCoverRatio: 0.7,
	batteryBypassPct: 80,
	carPowerW: 2000,
	mainSwitchLimitW: 10000,
	carStartMaxSoc: 80,
	chargeIfCarUnknown: false,
};

const at = (h: number, m = 0): number => h * 60 + m;

function snap(over: Partial<EnergySnapshot> = {}): EnergySnapshot {
	return { at: new Date(), solarW: 0, loadW: 500, batterySoc: 50, batteryW: 0, gridW: 0, source: "web", ...over };
}
const OFF: ChargerState = { on: false, powerW: 0 };
const ON: ChargerState = { on: true, powerW: 2000 };

function act(minutesOfDay: number, snapshot: EnergySnapshot, charger: ChargerState): string {
	return decide({ minutesOfDay, snapshot, charger, config }).action;
}

describe("windowFor", () => {
	it("tiles the day into morning / free / solar", () => {
		assert.equal(windowFor(at(4, 59), config), "solar"); // before 05:00
		assert.equal(windowFor(at(5, 0), config), "morning");
		assert.equal(windowFor(at(9, 59), config), "morning");
		assert.equal(windowFor(at(10, 0), config), "free");
		assert.equal(windowFor(at(13, 59), config), "free");
		assert.equal(windowFor(at(14, 0), config), "solar"); // 2pm flips back to solar
		assert.equal(windowFor(at(23, 30), config), "solar");
		assert.equal(windowFor(at(0, 0), config), "solar"); // overnight
	});
});

describe("free-power window (10:00–14:00)", () => {
	it("always charges, even below the battery floor", () => {
		assert.equal(act(at(11), snap({ batterySoc: 10 }), OFF), "on");
		assert.equal(act(at(13, 59), snap({ batterySoc: 5 }), OFF), "on");
	});
});

describe("morning window (05:00–10:00)", () => {
	it("starts a session when the battery is above 40% at 5am", () => {
		assert.equal(act(at(5), snap({ batterySoc: 45 }), OFF), "on");
	});

	it("does not start when the battery is 40% or below at 5am", () => {
		assert.equal(act(at(5), snap({ batterySoc: 40 }), OFF), "off");
		assert.equal(act(at(5), snap({ batterySoc: 30 }), OFF), "off");
	});

	it("keeps a running session going as the battery falls below 40%", () => {
		// Started at 5am; by 7am it's at 33% but the plug is on -> keep charging.
		assert.equal(act(at(7), snap({ batterySoc: 33 }), ON), "on");
	});

	it("stops at the 15% floor", () => {
		assert.equal(act(at(9), snap({ batterySoc: 15 }), ON), "off");
		assert.equal(act(at(9), snap({ batterySoc: 14 }), ON), "off");
	});

	it("stays off after hitting the floor until the free window", () => {
		// 09:30, battery 15%, plug just turned off -> not >40, stays off.
		assert.equal(act(at(9, 30), snap({ batterySoc: 15 }), OFF), "off");
	});
});

describe("user scenarios", () => {
	it("S1: 45% @05:00 charges, 15% @09:00 stops", () => {
		assert.equal(act(at(5), snap({ batterySoc: 45 }), OFF), "on");
		assert.equal(act(at(9), snap({ batterySoc: 15 }), ON), "off");
	});

	it("S2: 45% @05:00 charges, 20% @10:00 keeps charging (free window)", () => {
		assert.equal(act(at(5), snap({ batterySoc: 45 }), OFF), "on");
		assert.equal(act(at(10), snap({ batterySoc: 20 }), ON), "on");
	});

	it("S3: stops at 15% @09:00, resumes at 10:00 free window", () => {
		assert.equal(act(at(9), snap({ batterySoc: 15 }), ON), "off");
		assert.equal(act(at(9, 30), snap({ batterySoc: 15 }), OFF), "off");
		assert.equal(act(at(10), snap({ batterySoc: 15 }), OFF), "on");
	});
});

describe("main-switch protection (overrides all windows)", () => {
	it("allows charging when grid import + car stays within the limit", () => {
		// 7kW import (car off) + 2kW car = 9kW ≤ 10kW → free window still charges.
		assert.equal(act(at(11), snap({ gridW: 7000 }), OFF), "on");
	});

	it("blocks charging when grid import + car would exceed the limit", () => {
		// 9kW import (car off) + 2kW car = 11kW > 10kW → off, even in the free window.
		assert.equal(act(at(11), snap({ gridW: 9000 }), OFF), "off");
	});

	it("turns the car off if total import climbs over the limit while charging", () => {
		// Car on, importing 11kW total (incl. the car) → strip car: 9kW + 2kW = 11kW → off.
		assert.equal(act(at(11), snap({ gridW: 11000 }), ON), "off");
	});

	it("keeps charging when total import (incl. the car) is within the limit", () => {
		// Car on, importing 9kW total → strip car: 7kW + 2kW = 9kW ≤ 10kW → stays on.
		assert.equal(act(at(11), snap({ gridW: 9000 }), ON), "on");
	});

	it("overrides the morning window too", () => {
		// Healthy battery would normally start a morning session, but the breaker wins.
		assert.equal(act(at(6), snap({ gridW: 9500, batterySoc: 90 }), OFF), "off");
	});
});

describe("solar-surplus window (after 14:00)", () => {
	// Plug OFF, so loadW is the house alone.
	it("charges when solar covers ≥70% of (house + 2kW)", () => {
		assert.equal(act(at(15), snap({ solarW: 2500, loadW: 500 }), OFF), "on"); // need 1750
		assert.equal(act(at(15), snap({ solarW: 2100, loadW: 700 }), OFF), "on"); // need 1890
	});

	it("skips when it does not", () => {
		assert.equal(act(at(15), snap({ solarW: 2000, loadW: 1500 }), OFF), "off"); // need 2450
		assert.equal(act(at(15), snap({ solarW: 1000, loadW: 200 }), OFF), "off"); // need 1540
	});

	it("is off overnight when there is no sun", () => {
		assert.equal(act(at(2), snap({ solarW: 0, loadW: 300 }), OFF), "off");
		assert.equal(act(at(22), snap({ solarW: 0, loadW: 400 }), OFF), "off");
	});

	it("strips the car's own draw so an on-plug doesn't hide the surplus", () => {
		// House truly 500W, car pulling 2000W -> reported load 2500W, plug on.
		// baseHouse = 2500 - 2000 = 500; need 0.7*2500 = 1750; solar 2500 -> on.
		assert.equal(act(at(15), snap({ solarW: 2500, loadW: 2500 }), ON), "on");
		// If we didn't strip it, threshold would be 0.7*4500=3150 and it'd wrongly turn off.
	});

	it("charges regardless of coverage once the house battery is above the bypass", () => {
		// Battery 85% > 80% with the sun up: coverage would normally refuse this.
		assert.equal(act(at(16), snap({ solarW: 1000, loadW: 3000, batterySoc: 85 }), OFF), "on");
	});

	it("does NOT bypass at night, even with a full battery", () => {
		// Solar 0 = no sun: never drain the house battery into the car.
		assert.equal(act(at(22), snap({ solarW: 0, loadW: 1500, batterySoc: 95 }), OFF), "off");
		assert.equal(act(at(3), snap({ solarW: 0, loadW: 800, batterySoc: 100 }), OFF), "off");
	});

	it("does not keep a night-time charge running on a full battery", () => {
		assert.equal(act(at(23), snap({ solarW: 0, loadW: 2500, batterySoc: 95 }), ON), "off");
	});

	it("applies the normal solar test at or below the bypass threshold", () => {
		// Exactly 80% is not "above" 80, so the coverage test still governs.
		assert.equal(act(at(15), snap({ solarW: 500, loadW: 1500, batterySoc: 80 }), OFF), "off");
		assert.equal(act(at(15), snap({ solarW: 500, loadW: 1500, batterySoc: 79 }), OFF), "off");
	});

	it("still respects main-switch protection when bypassing", () => {
		// Full battery would bypass, but the breaker guard runs first.
		assert.equal(act(at(15), snap({ gridW: 9000, solarW: 1000, batterySoc: 95 }), OFF), "off");
	});

	it("uses the nominal car power when the plug reports no draw", () => {
		const onNoDraw: ChargerState = { on: true, powerW: 0 };
		// baseHouse = 2500 - 2000(nominal) = 500; need 1750; solar 2500 -> on.
		assert.equal(act(at(15), snap({ solarW: 2500, loadW: 2500 }), onNoDraw), "on");
	});
});

/**
 * The dashboard must show the decision the tick will actually make.
 *
 * It briefly did not: the display ran only the window rules and skipped the car
 * battery gate, so with the car at 81% against an 80% start limit the screen
 * announced "STARTING TO CHARGE" while the daemon, having applied the gate, left
 * the plug alone. Both steps, or the screen is fiction.
 */
describe("displayed decision matches the tick", () => {
	const bypassing = {
		minutesOfDay: 17 * 60 + 20,
		snapshot: { solarW: 408, loadW: 174, gridW: -234, batteryW: 0, batterySoc: 99, at: new Date(), source: "web" },
		charger: { on: false, powerW: 0 },
		config,
		override: null,
	} as const;

	it("the window rules alone would start a charge here", () => {
		// House battery full and the sun still up: the bypass says charge.
		assert.equal(decide(bypassing).action, "on");
	});

	it("but the car gate stops it, and that is what must be shown", () => {
		const base = decide(bypassing);
		const shown = applyCarSocGate(base, { soc: 81, stale: false }, bypassing.charger, config);
		assert.equal(shown.action, "off");
		assert.match(shown.reason, /above the 80% start limit/);
	});

	it("and it does start once the car is back under the gate", () => {
		const base = decide(bypassing);
		assert.equal(applyCarSocGate(base, { soc: 79, stale: false }, bypassing.charger, config).action, "on");
	});
});
