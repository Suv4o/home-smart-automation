import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCharge, parseLocked, parseSoc, redactLocation } from "../src/car/tesla.ts";
import type { ChargerState } from "../src/charger/types.ts";
import type { PolicyConfig } from "../src/config.ts";
import { applyCarSocGate, type CarSoc, type Decision } from "../src/engine/policy.ts";

const config = { carStartMaxSoc: 80, chargeIfCarUnknown: false } as PolicyConfig;
const OFF: ChargerState = { on: false, powerW: 0 };
const ON: ChargerState = { on: true, powerW: 2000 };
const onBase: Decision = { action: "on", window: "free", reason: "free-power window" };
const offBase: Decision = { action: "off", window: "solar", reason: "no sun" };

/**
 * The car gate decides whether to **start**, never when to stop.
 *
 * It used to be a ceiling: at 80% it switched the plug off, so a charge begun at
 * 70% ended at 80% and the car never reached its own limit. The rule is now the
 * one that was actually wanted - hold off while the car is already well charged,
 * but once a session is running let it finish at whatever the car is set to.
 */
describe("applyCarSocGate", () => {
	it("passes an 'off' base through untouched (never reads the car)", () => {
		assert.equal(applyCarSocGate(offBase, null, OFF, config).action, "off");
	});

	it("starts when the car is at or below the start limit", () => {
		const d = applyCarSocGate(onBase, { soc: 55, stale: false }, OFF, config);
		assert.equal(d.action, "on");
		assert.match(d.reason, /car 55%/);
		// The boundary is inclusive: 80% still starts.
		assert.equal(applyCarSocGate(onBase, { soc: 80, stale: false }, OFF, config).action, "on");
	});

	it("does not start when the car is already above it", () => {
		const d = applyCarSocGate(onBase, { soc: 81, stale: false }, OFF, config);
		assert.equal(d.action, "off");
		assert.match(d.reason, /above the 80% start limit/);
		assert.equal(applyCarSocGate(onBase, { soc: 92, stale: false }, OFF, config).action, "off");
	});

	it("never cuts short a charge already running, whatever the level", () => {
		// This is the whole point: passing 80% mid-session must not stop the plug,
		// so the car can go on to its own limit.
		for (const soc of [79, 80, 81, 95, 99]) {
			const d = applyCarSocGate(onBase, { soc, stale: false }, ON, config);
			assert.equal(d.action, "on", `should keep charging at ${soc}%`);
		}
	});

	it("lets a manual override start a charge at any level", () => {
		const override: Decision = { ...onBase, source: "override" };
		assert.equal(applyCarSocGate(override, { soc: 95, stale: false }, OFF, config).action, "on");
		assert.equal(applyCarSocGate(override, { soc: 99, stale: false }, ON, config).action, "on");
	});

	it("notes when the reading came from a stale cache", () => {
		const d = applyCarSocGate(onBase, { soc: 60, stale: true }, OFF, config);
		assert.match(d.reason, /car 60% \(cached\)/);
	});

	it("holds current plug state when the car is unreachable", () => {
		assert.equal(applyCarSocGate(onBase, null, OFF, config).action, "off"); // off stays off
		assert.equal(applyCarSocGate(onBase, null, ON, config).action, "on"); // don't interrupt
	});

	it("charges when unreachable if CHARGE_IF_CAR_UNKNOWN is set", () => {
		const permissive = { carStartMaxSoc: 80, chargeIfCarUnknown: true } as PolicyConfig;
		assert.equal(applyCarSocGate(onBase, null, OFF, permissive).action, "on");
	});
});

describe("parseSoc", () => {
	it("prefers usableBatteryLevel", () => {
		const out = '{"chargeState":{"batteryLevel":86,"usableBatteryLevel":84}}';
		assert.equal(parseSoc(out), 84);
	});

	it("falls back to batteryLevel", () => {
		assert.equal(parseSoc('{"chargeState":{"batteryLevel":73}}'), 73);
	});

	it("tolerates surrounding log text", () => {
		const out = 'connecting…\n{"chargeState":{"usableBatteryLevel":42}}\ndone\n';
		assert.equal(parseSoc(out), 42);
	});

	it("throws a helpful error when the field is missing", () => {
		assert.throws(() => parseSoc('{"chargeState":{"chargingState":{"Disconnected":{}}}}'), /no batteryLevel/);
	});
});

/**
 * The remaining-charge time is deliberately optional. The car only reports it
 * while charging, the field name has moved between versions of tesla-control,
 * and no firmware is guaranteed to send it - so a missing value must degrade the
 * display rather than break the read the policy depends on.
 */
describe("parseCharge", () => {
	it("reads the remaining time alongside the battery level", () => {
		const out = '{"chargeState":{"usableBatteryLevel":54,"minutesToFullCharge":96,"chargeLimitSoc":80}}';
		assert.deepEqual(parseCharge(out), { soc: 54, minutesToFull: 96, chargeLimit: 80, chargingState: null });
	});

	it("accepts the snake_case spelling too", () => {
		const out = '{"chargeState":{"batteryLevel":54,"minutes_to_full_charge":45,"charge_limit_soc":90}}';
		assert.deepEqual(parseCharge(out), { soc: 54, minutesToFull: 45, chargeLimit: 90, chargingState: null });
	});

	it("converts the hours-based field when that is all the car sends", () => {
		const out = '{"chargeState":{"batteryLevel":54,"timeToFullCharge":1.5}}';
		assert.equal(parseCharge(out).minutesToFull, 90);
	});

	it("prefers the minutes field over the hours one", () => {
		const out = '{"chargeState":{"batteryLevel":54,"minutesToFullCharge":20,"timeToFullCharge":9}}';
		assert.equal(parseCharge(out).minutesToFull, 20);
	});

	it("unwraps the charging status from its one-key object", () => {
		assert.equal(parseCharge('{"chargeState":{"batteryLevel":90,"chargingState":{"Complete":{}}}}').chargingState, "Complete");
		assert.equal(parseCharge('{"chargeState":{"batteryLevel":40,"chargingState":{"Disconnected":{}}}}').chargingState, "Disconnected");
		// A plain string, should any firmware send one that way.
		assert.equal(parseCharge('{"chargeState":{"batteryLevel":40,"chargingState":"Stopped"}}').chargingState, "Stopped");
	});

	it("still reads a car that reports no remaining time at all", () => {
		const r = parseCharge('{"chargeState":{"usableBatteryLevel":73}}');
		assert.equal(r.soc, 73);
		assert.equal(r.minutesToFull, null);
		assert.equal(r.chargeLimit, null);
	});

	it("keeps zero, which means about to finish, but discards nonsense", () => {
		assert.equal(parseCharge('{"chargeState":{"batteryLevel":80,"minutesToFullCharge":0}}').minutesToFull, 0);
		assert.equal(parseCharge('{"chargeState":{"batteryLevel":80,"minutesToFullCharge":-1}}').minutesToFull, null);
	});

	it("still fails loudly when the battery level is missing", () => {
		assert.throws(() => parseCharge('{"chargeState":{"minutesToFullCharge":30}}'), /no batteryLevel/);
	});
});

/**
 * A real response from the car, captured while it was charging on the mobile
 * connector. Trimmed to the fields that matter and with the location stripped -
 * the car reports `homeLocation` and `workLocation` as exact coordinates, and
 * this repository is public.
 */
const REAL_CHARGING = JSON.stringify({
	chargeState: {
		chargingState: { Charging: {} },
		chargeLimitSoc: 100,
		chargeLimitSocStd: 80,
		batteryLevel: 93,
		usableBatteryLevel: 93,
		chargerVoltage: 231,
		chargerActualCurrent: 10,
		chargerPower: 2,
		minutesToFullCharge: 155,
		minutesToChargeLimit: 155,
		chargeRateMph: 9,
		chargePortLatch: { Engaged: {} },
		chargingAmps: 10,
	},
});

describe("parseCharge against a real car response", () => {
	it("reads the whole reading from what the car actually sends", () => {
		assert.deepEqual(parseCharge(REAL_CHARGING), {
			soc: 93,
			minutesToFull: 155,
			chargeLimit: 100,
			// Unwrapped from the protobuf one-key object the car really sends.
			chargingState: "Charging",
		});
	});

	it("prefers time-to-limit over time-to-full", () => {
		// These agree only at a 100% limit. At 80% the car will stop long before
		// "full", so counting to full would overstate the wait.
		const at80 = REAL_CHARGING.replace('"minutesToChargeLimit":155', '"minutesToChargeLimit":40').replace(
			'"chargeLimitSoc":100',
			'"chargeLimitSoc":80',
		);
		const r = parseCharge(at80);
		assert.equal(r.minutesToFull, 40, "should follow the limit, not the 155 to full");
		assert.equal(r.chargeLimit, 80);
	});
});

describe("redactLocation", () => {
	it("removes the coordinates the car volunteers", () => {
		const withLocation = JSON.stringify({
			chargeState: {
				batteryLevel: 93,
				homeLocation: { latitude: -37.1234, longitude: 145.5678 },
				workLocation: { latitude: -37.9999, longitude: 145.1111 },
			},
		});
		const out = redactLocation(withLocation);
		assert.doesNotMatch(out, /-37\.|145\./, "no coordinate may survive");
		assert.match(out, /\[redacted\]/);
		// The reading itself must still be there - it is the point of the command.
		assert.match(out, /"batteryLevel": 93/);
	});

	it("hands back anything it cannot parse rather than swallowing it", () => {
		assert.equal(redactLocation("tesla-control: connection failed"), "tesla-control: connection failed");
	});
});

/**
 * Lock state is read from `state closures`, alongside the battery in the same
 * wake. It is never guessed: the dashboard shows "unknown" rather than putting a
 * reassuring padlock on screen with nothing behind it.
 */
describe("parseLocked", () => {
	it("reads the flag the car sends", () => {
		assert.equal(parseLocked('{"closuresState":{"locked":true}}'), true);
		assert.equal(parseLocked('{"closuresState":{"locked":false}}'), false);
	});

	it("tolerates the state arriving under another key", () => {
		assert.equal(parseLocked('{"vehicleState":{"locked":true}}'), true);
		assert.equal(parseLocked('{"locked":false}'), false);
	});

	it("understands an enum instead of a flag", () => {
		assert.equal(parseLocked('{"closuresState":{"vehicleLockState":"Unlocked"}}'), false);
		assert.equal(parseLocked('{"closuresState":{"vehicleLockState":"Locked"}}'), true);
	});

	it("says unknown rather than guessing, and never throws", () => {
		// Every one of these is a real possibility: an older firmware, a failed
		// command, a car that answered with something else entirely.
		assert.equal(parseLocked('{"closuresState":{"doorOpen":false}}'), null);
		assert.equal(parseLocked("tesla-control: context deadline exceeded"), null);
		assert.equal(parseLocked(""), null);
		assert.equal(parseLocked("{not json"), null);
		assert.equal(parseLocked('{"closuresState":{"locked":"yes"}}'), null);
	});

	it("ignores log noise around the JSON", () => {
		assert.equal(parseLocked('connecting…\n{"closuresState":{"locked":true}}\ndone'), true);
	});
});
