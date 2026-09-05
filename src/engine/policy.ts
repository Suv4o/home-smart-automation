import type { ChargerState } from "../charger/types.ts";
import type { PolicyConfig } from "../config.ts";
import type { EnergySnapshot } from "../providers/types.ts";

export type Action = "on" | "off";
export type Window = "free" | "morning" | "solar";

export interface Decision {
	readonly action: Action;
	readonly window: Window;
	readonly reason: string;
}

export interface DecideInput {
	/** Minutes since Melbourne local midnight (0..1439). */
	readonly minutesOfDay: number;
	readonly snapshot: EnergySnapshot;
	readonly charger: ChargerState;
	readonly config: PolicyConfig;
}

/**
 * Which time window `minutesOfDay` falls in. The three windows tile the day:
 *   [morningStart, freeStart) morning · [freeStart, freeEnd) free · rest solar
 */
export function windowFor(minutesOfDay: number, config: PolicyConfig): Window {
	const { morningStartMin, freeStartMin, freeEndMin } = config;
	if (minutesOfDay >= freeStartMin && minutesOfDay < freeEndMin) return "free";
	if (minutesOfDay >= morningStartMin && minutesOfDay < freeStartMin) return "morning";
	return "solar";
}

/**
 * The whole charging policy as one pure function. Returns the state the plug
 * should be in *right now* — the caller only switches if it differs from the
 * plug's current state.
 *
 * It is deliberately stateless: the "did we start a morning session?" memory
 * lives in the plug's own on/off state (`charger.on`), which a cloud plug keeps
 * between runs. That lets a 30-minute cron reconstruct the right decision every
 * tick without any external store.
 */
export function decide({ minutesOfDay, snapshot, charger, config }: DecideInput): Decision {
	const window = windowFor(minutesOfDay, config);

	// 0. Main-switch protection (overrides every window, including free power).
	//    Never let (grid import + the car's draw) exceed the breaker limit.
	const guard = mainSwitchGuard(snapshot, charger, config);
	if (!guard.safe) {
		return { action: "off", window, reason: guard.reason };
	}

	// 1. Free-power window: always charge. The house battery is also charging
	//    from free grid now, so the SOC floor is intentionally not applied here.
	if (window === "free") {
		return { action: "on", window, reason: "free-power window (10:00–14:00) — always charge" };
	}

	// 2. Morning battery-share window. Start a session only while the battery is
	//    healthy (>40%); once running, keep going (plug is on) until the floor.
	if (window === "morning") {
		if (snapshot.batterySoc <= config.batteryStopPct) {
			return {
				action: "off",
				window,
				reason: `battery ${snapshot.batterySoc}% at/below the ${config.batteryStopPct}% floor`,
			};
		}
		if (charger.on) {
			return { action: "on", window, reason: `charging on (battery ${snapshot.batterySoc}%, above floor)` };
		}
		if (snapshot.batterySoc > config.batteryStartPct) {
			return {
				action: "on",
				window,
				reason: `battery ${snapshot.batterySoc}% > ${config.batteryStartPct}% — start morning session`,
			};
		}
		return {
			action: "off",
			window,
			reason: `battery ${snapshot.batterySoc}% not above ${config.batteryStartPct}% — no morning session`,
		};
	}

	// 3. Solar-surplus window (after 14:00 through the night to 05:00). Charge
	//    only when solar covers ~most of the load the car would add. Naturally
	//    off overnight, when solar is ~0.

	//    Exception: while the sun is up, once the house battery is full there's
	//    nothing left to soak up the surplus, so send it to the car and skip the
	//    coverage test. Requiring solar > 0 keeps this to daylight - at night a
	//    full battery must not be drained into the car.
	if (snapshot.solarW > 0 && snapshot.batterySoc > config.batteryBypassPct) {
		return {
			action: "on",
			window,
			reason:
				`house battery ${snapshot.batterySoc}% > ${config.batteryBypassPct}% and solar is producing ` +
				`(${Math.round(snapshot.solarW)}W) — charging regardless of coverage`,
		};
	}

	const surplus = solarCoverage(snapshot, charger, config);
	if (surplus.covered) {
		return {
			action: "on",
			window,
			reason:
				`solar ${Math.round(snapshot.solarW)}W ≥ ${Math.round(surplus.threshold)}W ` +
				`(${Math.round(config.solarCoverRatio * 100)}% of ${Math.round(surplus.baseHouseW)}W house + ` +
				`${config.carPowerW}W car)`,
		};
	}
	return {
		action: "off",
		window,
		reason:
			`solar ${Math.round(snapshot.solarW)}W < ${Math.round(surplus.threshold)}W needed ` +
			`(house ${Math.round(surplus.baseHouseW)}W + ${config.carPowerW}W car)`,
	};
}

interface Coverage {
	readonly covered: boolean;
	readonly baseHouseW: number;
	readonly threshold: number;
}

/**
 * Charge iff `solar ≥ ratio × (houseWithoutCar + carPowerW)`.
 *
 * `houseWithoutCar` strips the car's own draw when the plug is already on,
 * otherwise the load the car creates would count against the very surplus we're
 * testing and the decision would oscillate. The car's draw is the plug's
 * measured power, falling back to the nominal `carPowerW` when the plug can't
 * report it.
 */
/** A car battery reading; `stale` means it came from an expired cache (a fresh read failed). */
export interface CarSoc {
	readonly soc: number;
	readonly stale: boolean;
}

/**
 * Final gate applied *after* the window/safety decision, using the car's own
 * battery level. Reading the car wakes it, so the caller only fetches this when
 * the base decision is already "on" — there's no point waking the car to confirm
 * a "no" we've already reached.
 *
 *   base "off"                        -> off (car never read)
 *   car known, soc >= carMaxSoc       -> off (full enough)
 *   car known, soc <  carMaxSoc       -> on
 *   car unknown (unreachable)         -> hold the plug's current state; don't
 *                                        start a charge we can't justify, and
 *                                        don't interrupt one already running
 */
export function applyCarSocGate(base: Decision, carSoc: CarSoc | null, charger: ChargerState, config: PolicyConfig): Decision {
	if (base.action === "off") return base;

	if (carSoc === null) {
		if (config.chargeIfCarUnknown) {
			return { action: "on", window: base.window, reason: `${base.reason}; car unreachable — charging anyway` };
		}
		return {
			action: charger.on ? "on" : "off",
			window: base.window,
			reason: "car battery unknown (couldn't reach the car) — holding current plug state",
		};
	}
	if (carSoc.soc >= config.carMaxSoc) {
		return {
			action: "off",
			window: base.window,
			reason: `car battery ${carSoc.soc}% ≥ ${config.carMaxSoc}% — no need to charge`,
		};
	}
	const tag = carSoc.stale ? " (cached)" : "";
	return { action: "on", window: base.window, reason: `${base.reason}; car ${carSoc.soc}%${tag}` };
}

interface Guard {
	readonly safe: boolean;
	readonly reason: string;
}

/**
 * Main-switch protection. The breaker carries the grid import; charging the car
 * adds to it. We must keep `gridImport(without car) + carPowerW` under the limit.
 *
 * The car's current contribution to the import is subtracted first (using its
 * measured draw, or the nominal `carPowerW` when the plug reports nothing), so
 * the check reads the same whether the car is already on or still off. Example:
 * importing 9 kW with the car off → 9 + 2 = 11 kW projected → blocked; importing
 * 7 kW → 9 kW projected → allowed.
 */
export function mainSwitchGuard(snapshot: EnergySnapshot, charger: ChargerState, config: PolicyConfig): Guard {
	const gridImportW = Math.max(0, snapshot.gridW);
	const carDrawW = charger.on ? (charger.powerW > 0 ? charger.powerW : config.carPowerW) : 0;
	const importExclCarW = Math.max(0, gridImportW - carDrawW);
	const projectedW = importExclCarW + config.carPowerW;
	if (projectedW > config.mainSwitchLimitW) {
		return {
			safe: false,
			reason:
				`main-switch protection: grid import ${Math.round(importExclCarW)}W + ${config.carPowerW}W car ` +
				`= ${Math.round(projectedW)}W would exceed the ${config.mainSwitchLimitW}W limit`,
		};
	}
	return { safe: true, reason: "" };
}

export function solarCoverage(snapshot: EnergySnapshot, charger: ChargerState, config: PolicyConfig): Coverage {
	const carDrawW = charger.on ? (charger.powerW > 0 ? charger.powerW : config.carPowerW) : 0;
	const baseHouseW = Math.max(0, snapshot.loadW - carDrawW);
	const threshold = config.solarCoverRatio * (baseHouseW + config.carPowerW);
	return { covered: snapshot.solarW >= threshold, baseHouseW, threshold };
}
