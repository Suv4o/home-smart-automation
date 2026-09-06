import type { AppConfig } from "../config.ts";
import { logger } from "../logger.ts";
import type { DashboardState, StateStore } from "./state.ts";
import { skyFor } from "./sky.ts";

/**
 * Scripted states for checking the display without waiting on the weather.
 *
 * Several of the visuals are impossible to exercise on demand - a sunny export,
 * a breaker-blocked tick, a nine-hour-old car reading, midnight - so `--demo`
 * cycles through them. Nothing here touches the plug, the car or Solarman.
 */
export interface Scenario {
	readonly name: string;
	readonly hour: number;
	readonly build: (base: DashboardState) => DashboardState;
}

/** A local time today, for forcing a particular sky. */
function at(hour: number): Date {
	const d = new Date();
	d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
	return d;
}

export const SCENARIOS: Scenario[] = [
	{
		name: "sunny · exporting · charging",
		hour: 12,
		build: (b) => ({
			...b,
			energy: { solarW: 6200, loadW: 900, gridW: -3300, batteryW: 2000, batterySoc: 74, at: b.at },
			charger: { on: true, powerW: 2050 },
			car: { soc: 58, at: b.at, ageMs: 4 * 60_000 },
			decision: { action: "on", window: "solar", reason: "solar 6200W ≥ 2030W (70% of 900W house + 2000W car)", source: "policy" },
		}),
	},
	{
		name: "free power · importing · charging",
		hour: 11,
		build: (b) => ({
			...b,
			energy: { solarW: 1250, loadW: 5300, gridW: 6100, batteryW: 2050, batterySoc: 63, at: b.at },
			charger: { on: true, powerW: 2010 },
			car: { soc: 41, at: b.at, ageMs: 22 * 60_000 },
			decision: { action: "on", window: "free", reason: "free-power window (10:00–14:00) — always charge", source: "policy" },
		}),
	},
	{
		name: "BLOCKED · grid over the breaker limit",
		hour: 11.5,
		build: (b) => ({
			...b,
			energy: { solarW: 1250, loadW: 5345, gridW: 10359, batteryW: 6270, batterySoc: 73, at: b.at },
			charger: { on: false, powerW: 0 },
			car: { soc: 52, at: b.at, ageMs: 9 * 60_000 },
			decision: {
				action: "off",
				window: "free",
				reason: "main-switch protection: grid import 10359W + 2000W car = 12359W would exceed the 10000W limit",
				source: "policy",
			},
		}),
	},
	{
		name: "dusk · winding down",
		hour: 17.9,
		build: (b) => ({
			...b,
			energy: { solarW: 320, loadW: 2100, gridW: 180, batteryW: -1600, batterySoc: 55, at: b.at },
			charger: { on: false, powerW: 0 },
			car: { soc: 66, at: b.at, ageMs: 95 * 60_000 },
			decision: { action: "off", window: "solar", reason: "solar 320W < 2870W needed (house 2100W + 2000W car)", source: "policy" },
		}),
	},
	{
		name: "night · stale car reading",
		hour: 22,
		build: (b) => ({
			...b,
			energy: { solarW: 0, loadW: 1450, gridW: 90, batteryW: -1360, batterySoc: 48, at: b.at },
			charger: { on: false, powerW: 0 },
			car: { soc: 87, at: new Date(Date.now() - 9 * 3_600_000).toISOString(), ageMs: 9 * 3_600_000 },
			decision: { action: "off", window: "solar", reason: "solar 0W < 2415W needed (house 1450W + 2000W car)", source: "policy" },
		}),
	},
	{
		name: "dawn · manual override charging",
		hour: 6.75,
		build: (b) => ({
			...b,
			energy: { solarW: 240, loadW: 3100, gridW: 1150, batteryW: 0, batterySoc: 34, at: b.at },
			charger: { on: true, powerW: 1980 },
			car: { soc: 24, at: b.at, ageMs: 2 * 60_000 },
			override: { mode: "force_on", until: Date.now() + 82 * 60_000, setAt: Date.now() },
			decision: { action: "on", window: "morning", reason: "manual override: charge now", source: "override" },
		}),
	},
];

/** Cycles the scenarios, publishing each to the store. */
export function startDemo(config: AppConfig, store: StateStore, signal: AbortSignal, periodMs = 6000): void {
	let i = 0;
	const emit = (): void => {
		const s = SCENARIOS[i % SCENARIOS.length]!;
		const when = at(s.hour);
		const base: DashboardState = {
			at: when.toISOString(),
			sky: skyFor(when, config.location.latitude, config.location.longitude),
			energy: null,
			charger: null,
			car: null,
			decision: null,
			override: null,
			limits: {
				mainSwitchLimitW: config.policy.mainSwitchLimitW,
				carPowerW: config.policy.carPowerW,
				carMaxSoc: config.policy.carMaxSoc,
				batteryBypassPct: config.policy.batteryBypassPct,
				solarCoverRatio: config.policy.solarCoverRatio,
				batteryStopPct: config.policy.batteryStopPct,
				morningStartMin: config.policy.morningStartMin,
				freeStartMin: config.policy.freeStartMin,
				freeEndMin: config.policy.freeEndMin,
			},
			errors: [],
		};
		store.set(s.build(base));
		logger.info({ scenario: s.name, sky: base.sky.phase }, "demo");
		i++;
	};
	emit();
	const timer = setInterval(emit, periodMs);
	signal.addEventListener("abort", () => clearInterval(timer), { once: true });
}
