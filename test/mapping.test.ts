import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSnapshot, SolarmanShapeError } from "../src/providers/solarman-web.ts";

/**
 * Captured from a live session against an example station at night: no PV, house
 * drawing 1876W, battery discharging 1780W, essentially no grid flow.
 */
const CAPTURED_FAST = {
	systemId: 12345678,
	generationPower: 0,
	usePower: 1876,
	wirePower: -3,
	gridPower: 0,
	buyPower: -3,
	batteryPower: 1780,
	chargePower: 0,
	dischargePower: 1780,
	wireStatus: "PURCHASE",
	batteryStatus: "DISCHARGE",
};

const CAPTURED_OPERATING = { batterySoc: 60, batteryStatus: "DISCHARGE", batteryPower: 1780 };

describe("mapSnapshot", () => {
	it("maps the captured night-time reading", () => {
		const s = mapSnapshot(CAPTURED_FAST, CAPTURED_OPERATING);
		assert.equal(s.solarW, 0);
		assert.equal(s.loadW, 1876);
		assert.equal(s.batterySoc, 60);
		assert.equal(s.source, "web");
	});

	it("signs battery power negative while discharging", () => {
		// `batteryPower` in the payload is an unsigned 1780; the sign has to
		// come from chargePower/dischargePower.
		assert.equal(mapSnapshot(CAPTURED_FAST, CAPTURED_OPERATING).batteryW, -1780);
	});

	it("derives grid import consistent with wireStatus PURCHASE", () => {
		// 1876 load - 0 PV + (0 charge - 1780 discharge) = 96W imported.
		assert.equal(mapSnapshot(CAPTURED_FAST, CAPTURED_OPERATING).gridW, 96);
	});

	it("derives grid export on a sunny surplus", () => {
		// Sunny, battery soaking up 700W. Note charging is reported NEGATIVE.
		const sunny = {
			...CAPTURED_FAST,
			generationPower: 5000,
			usePower: 800,
			chargePower: -700,
			dischargePower: 0,
			batteryPower: -700,
			batteryStatus: "CHARGE",
		};
		const s = mapSnapshot(sunny, { batterySoc: 88 });
		// 800 load - 5000 solar + 700 into the battery = -3500, i.e. exporting 3.5kW.
		assert.equal(s.batteryW, 700);
		assert.equal(s.gridW, -3500);
	});

	it("fails loudly, and usefully, when a field disappears", () => {
		assert.throws(
			() => mapSnapshot(CAPTURED_FAST, { somethingElse: 1 }),
			(err: unknown) => {
				assert.ok(err instanceof SolarmanShapeError);
				assert.match(err.message, /batterySoc/);
				assert.match(err.message, /Keys present: somethingElse/);
				return true;
			},
		);
	});
});

/**
 * Captured mid-morning while the battery was charging hard from the grid.
 * The critical detail: `chargePower` / `batteryPower` are NEGATIVE while
 * charging, and `batteryStatus` is the only field that states the direction.
 * Reading the sign literally reported "exporting 7.2kW" during a 5.4kW import,
 * which silently disabled the main-switch guard.
 */
const CAPTURED_CHARGING_FAST = {
	generationPower: 3256,
	usePower: 2357,
	chargePower: -6300,
	dischargePower: 0,
	batteryPower: -6300,
	gridPower: 0,
	buyPower: -5722,
	wirePower: -5722,
	batteryStatus: "CHARGE",
	wireStatus: "PURCHASE",
};

describe("mapSnapshot - battery charging (sign regression)", () => {
	it("reports a charging battery as positive", () => {
		const s = mapSnapshot(CAPTURED_CHARGING_FAST, { batterySoc: 82 });
		assert.equal(s.batteryW, 6300);
	});

	it("reports IMPORT, not export, while charging from the grid", () => {
		// 2357 load - 3256 solar + 6300 charging = 5401W imported.
		const s = mapSnapshot(CAPTURED_CHARGING_FAST, { batterySoc: 82 });
		assert.equal(s.gridW, 5401);
		assert.ok(s.gridW > 0, "must be positive - wireStatus says PURCHASE");
	});

	it("agrees with the meter's own reported import to within 10%", () => {
		const s = mapSnapshot(CAPTURED_CHARGING_FAST, { batterySoc: 82 });
		const reported = Math.abs(CAPTURED_CHARGING_FAST.buyPower);
		assert.ok(Math.abs(s.gridW - reported) / reported < 0.1, `derived ${s.gridW} vs reported ${reported}`);
	});

	it("refuses to guess when batteryStatus is unrecognised", () => {
		assert.throws(
			() => mapSnapshot({ ...CAPTURED_CHARGING_FAST, batteryStatus: "WOBBLE" }, { batterySoc: 82 }),
			/Refusing to guess the battery direction/,
		);
	});
});
