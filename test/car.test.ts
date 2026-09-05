import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSoc } from "../src/car/tesla.ts";
import type { ChargerState } from "../src/charger/types.ts";
import type { PolicyConfig } from "../src/config.ts";
import { applyCarSocGate, type CarSoc, type Decision } from "../src/engine/policy.ts";

const config = { carMaxSoc: 80, chargeIfCarUnknown: false } as PolicyConfig;
const OFF: ChargerState = { on: false, powerW: 0 };
const ON: ChargerState = { on: true, powerW: 2000 };
const onBase: Decision = { action: "on", window: "free", reason: "free-power window" };
const offBase: Decision = { action: "off", window: "solar", reason: "no sun" };

describe("applyCarSocGate", () => {
	it("passes an 'off' base through untouched (never reads the car)", () => {
		assert.equal(applyCarSocGate(offBase, null, OFF, config).action, "off");
	});

	it("charges when the car is below the max", () => {
		const d = applyCarSocGate(onBase, { soc: 55, stale: false }, OFF, config);
		assert.equal(d.action, "on");
		assert.match(d.reason, /car 55%/);
	});

	it("blocks when the car is at/above the max", () => {
		assert.equal(applyCarSocGate(onBase, { soc: 80, stale: false }, OFF, config).action, "off");
		assert.equal(applyCarSocGate(onBase, { soc: 92, stale: false }, ON, config).action, "off");
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
		const permissive = { carMaxSoc: 80, chargeIfCarUnknown: true } as PolicyConfig;
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
