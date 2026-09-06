import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChargerState } from "../src/charger/types.ts";
import type { PolicyConfig } from "../src/config.ts";
import type { Override } from "../src/engine/override.ts";
import { isExpired } from "../src/engine/override.ts";
import { applyCarSocGate, decide } from "../src/engine/policy.ts";
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
	carMaxSoc: 80,
	chargeIfCarUnknown: false,
};

const OFF: ChargerState = { on: false, powerW: 0 };
const at = (h: number): number => h * 60;
const snap = (over: Partial<EnergySnapshot> = {}): EnergySnapshot => ({
	at: new Date(), solarW: 0, loadW: 500, batterySoc: 50, batteryW: 0, gridW: 0, source: "web", ...over,
});
const ov = (mode: Override["mode"]): Override => ({ mode, until: Date.now() + 3_600_000, setAt: Date.now() });

describe("manual override", () => {
	it("charges at 2am, which no window would allow", () => {
		const d = decide({ minutesOfDay: at(2), snapshot: snap(), charger: OFF, config, override: ov("force_on") });
		assert.equal(d.action, "on");
		assert.equal(d.source, "override");
	});

	it("stops charging during the free window", () => {
		const d = decide({ minutesOfDay: at(11), snapshot: snap(), charger: OFF, config, override: ov("force_off") });
		assert.equal(d.action, "off");
	});

	it("outranks the car SOC gate, so a full car can still be topped up", () => {
		const base = decide({ minutesOfDay: at(2), snapshot: snap(), charger: OFF, config, override: ov("force_on") });
		const final = applyCarSocGate(base, { soc: 95, stale: false }, OFF, config);
		assert.equal(final.action, "on", "override should beat the 80% car limit");
	});

	it("CANNOT defeat the main-switch guard", () => {
		// 9kW house import + 2kW car = 11kW, over the 10kW breaker limit.
		const d = decide({
			minutesOfDay: at(11),
			snapshot: snap({ gridW: 9000 }),
			charger: OFF,
			config,
			override: ov("force_on"),
		});
		assert.equal(d.action, "off", "a tablet tap must never be able to trip the breaker");
		assert.match(d.reason, /main-switch protection/);
		assert.notEqual(d.source, "override");
	});

	it("normal policy applies when there is no override", () => {
		const d = decide({ minutesOfDay: at(11), snapshot: snap(), charger: OFF, config, override: null });
		assert.equal(d.action, "on");
		assert.notEqual(d.source, "override");
	});
});

describe("override expiry", () => {
	it("is not expired before its deadline", () => {
		assert.equal(isExpired({ mode: "force_on", until: 1_000, setAt: 0 }, 999), false);
	});

	it("is expired at and after its deadline", () => {
		assert.equal(isExpired({ mode: "force_on", until: 1_000, setAt: 0 }, 1_000), true);
		assert.equal(isExpired({ mode: "force_on", until: 1_000, setAt: 0 }, 5_000), true);
	});
});
