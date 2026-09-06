import type { TeslaCar } from "../car/tesla.ts";
import type { ChargerController, ChargerState } from "../charger/types.ts";
import type { AppConfig } from "../config.ts";
import { type ChargeState, chargeState } from "../engine/charge-state.ts";
import { loadOverride } from "../engine/override.ts";
import { decide } from "../engine/policy.ts";
import { logger } from "../logger.ts";
import type { EnergySnapshot, SolarProvider } from "../providers/types.ts";
import { melbourneClock } from "../time.ts";
import type { DashboardState, StateStore } from "./state.ts";
import { skyFor } from "./sky.ts";

/** Keep at most this many recent errors for the UI. */
const MAX_ERRORS = 3;

/**
 * One place that reads the world and assembles dashboard state, shared by the
 * decision tick and the faster display poller so the two can never drift apart.
 *
 * The Solarman snapshot is cached here: the display refreshes every ~15s but
 * upstream only updates every ~5 minutes, so a re-fetch is throttled to
 * `solarmanMinIntervalMs`. The plug is local and cheap, so it's read every time.
 *
 * The car is read here in exactly one case: while it is genuinely drawing power.
 * A charging car is already awake, so polling it costs no wake, and the
 * percentage can then climb visibly instead of sitting on an hour-old figure.
 * Any other time `buildState` uses the cache only - waking a sleeping vehicle
 * stays reserved for the decision tick and the explicit refresh action.
 */
export class World {
	#snapshot: { value: EnergySnapshot; at: number } | null = null;
	#errors: string[] = [];
	/** Previous charge state, so we can spot the moment a charge begins. */
	#wasCharging = false;
	/** One BLE read at a time; they are slow and the display polls far faster. */
	#carReadInFlight = false;

	readonly #provider: SolarProvider;
	readonly #charger: ChargerController;
	readonly #car: TeslaCar;
	readonly #config: AppConfig;
	readonly #store: StateStore;

	constructor(
		provider: SolarProvider,
		charger: ChargerController,
		car: TeslaCar,
		config: AppConfig,
		store: StateStore,
	) {
		this.#provider = provider;
		this.#charger = charger;
		this.#car = car;
		this.#config = config;
		this.#store = store;
	}

	/** Cached Solarman reading, re-fetched only when older than `maxAgeMs`. */
	async snapshot(maxAgeMs: number): Promise<EnergySnapshot | null> {
		const cached = this.#snapshot;
		if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;
		try {
			const value = await this.#provider.snapshot();
			this.#snapshot = { value, at: Date.now() };
			this.#clearError("solarman");
			return value;
		} catch (err) {
			this.#noteError("solarman", err);
			return cached?.value ?? null; // keep showing the last good reading, aged
		}
	}

	async chargerState(): Promise<ChargerState | null> {
		try {
			const s = await this.#charger.state();
			this.#clearError("plug");
			return s;
		} catch (err) {
			this.#noteError("plug", err);
			return null;
		}
	}

	/**
	 * Assemble the current picture for the dashboard. Reads Solarman (throttled)
	 * and the plug, takes the car from cache, and computes what the policy would
	 * decide right now - without acting on it.
	 */
	async buildState(): Promise<DashboardState> {
		const [snapshot, charger] = await Promise.all([
			this.snapshot(this.#config.ui.solarmanMinIntervalMs),
			this.chargerState(),
		]);
		const [car, override] = await Promise.all([this.#car.cachedSoc(), loadOverride()]);

		const now = new Date();
		const clock = melbourneClock(now);
		const { policy } = this.#config;

		const charge = chargeState(charger, this.#config.car.drawMinW);

		const decision =
			snapshot && charger
				? decide({ minutesOfDay: clock.minutesOfDay, snapshot, charger, config: policy, override })
				: null;

		const state: DashboardState = {
			at: now.toISOString(),
			sky: skyFor(now, this.#config.location.latitude, this.#config.location.longitude),
			energy: snapshot
				? {
						solarW: snapshot.solarW,
						loadW: snapshot.loadW,
						gridW: snapshot.gridW,
						batteryW: snapshot.batteryW,
						batterySoc: snapshot.batterySoc,
						at: new Date(this.#snapshot?.at ?? now.getTime()).toISOString(),
					}
				: null,
			charger,
			chargeState: charge,
			car: car
				? {
						soc: car.soc,
						at: new Date(car.at).toISOString(),
						ageMs: Date.now() - car.at,
						minutesToFull: car.minutesToFull,
						chargeLimit: car.chargeLimit,
					}
				: null,
			decision: decision
				? {
						action: decision.action,
						window: decision.window,
						reason: decision.reason,
						source: decision.source ?? "policy",
					}
				: null,
			override,
			limits: {
				mainSwitchLimitW: policy.mainSwitchLimitW,
				carPowerW: policy.carPowerW,
				carMaxSoc: policy.carMaxSoc,
				batteryBypassPct: policy.batteryBypassPct,
				solarCoverRatio: policy.solarCoverRatio,
				batteryStopPct: policy.batteryStopPct,
				morningStartMin: policy.morningStartMin,
				freeStartMin: policy.freeStartMin,
				freeEndMin: policy.freeEndMin,
			},
			errors: [...this.#errors],
		};

		// Kick off a battery read if one is due. Deliberately not awaited: a BLE
		// round-trip takes seconds and must not hold up the display refresh. The
		// value lands in the cache and the follow-up publish picks it up.
		void this.#refreshCarWhileCharging(charge, car?.at ?? null);
		this.#wasCharging = charge === "charging";

		return state;
	}

	/**
	 * Keep the battery percentage fresh for as long as the car is drawing power.
	 *
	 * Reads immediately when a charge starts - that first figure is the one worth
	 * having, since it anchors everything the driver watches afterwards - and then
	 * at `socTtlChargingMs` while it continues.
	 */
	async #refreshCarWhileCharging(charge: ChargeState, cachedAt: number | null): Promise<void> {
		if (charge !== "charging" || this.#carReadInFlight) return;

		const justStarted = !this.#wasCharging;
		const stale = cachedAt === null || Date.now() - cachedAt >= this.#config.car.socTtlChargingMs;
		if (!justStarted && !stale) return;

		this.#carReadInFlight = true;
		try {
			const reading = await this.#car.refresh();
			if (reading) {
				logger.info({ soc: reading.soc, trigger: justStarted ? "charge started" : "due" }, "car battery read while charging");
				await this.publish(); // show the new figure without waiting for the next poll
			}
		} catch (err) {
			this.#noteError("car", err);
		} finally {
			this.#carReadInFlight = false;
		}
	}

	/** Build and publish, so every SSE client sees it. */
	async publish(): Promise<DashboardState> {
		const state = await this.buildState();
		this.#store.set(state);
		return state;
	}

	/** Runs the display refresh loop until aborted. */
	start(signal: AbortSignal): void {
		const tick = (): void => {
			this.publish().catch((err) => logger.warn({ err: String(err) }, "display refresh failed"));
		};
		tick();
		const timer = setInterval(tick, this.#config.ui.refreshMs);
		signal.addEventListener("abort", () => clearInterval(timer), { once: true });
	}

	#noteError(scope: string, err: unknown): void {
		const message = `${scope}: ${err instanceof Error ? err.message : String(err)}`;
		this.#errors = [message, ...this.#errors.filter((e) => !e.startsWith(`${scope}:`))].slice(0, MAX_ERRORS);
		logger.warn({ scope, err: String(err) }, "world read failed");
	}

	#clearError(scope: string): void {
		this.#errors = this.#errors.filter((e) => !e.startsWith(`${scope}:`));
	}
}
