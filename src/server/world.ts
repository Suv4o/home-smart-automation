import type { TeslaCar } from "../car/tesla.ts";
import type { ChargerController, ChargerState } from "../charger/types.ts";
import type { AppConfig } from "../config.ts";
import { type ChargeState, chargeState } from "../engine/charge-state.ts";
import {
	type Calibration,
	isSamplingMinute,
	loadCalibration,
	nextFactor,
	sampleFactor,
	saveCalibration,
} from "../providers/solar-calibration.ts";
import { estimatePv, fetchWeather, type WeatherReading } from "../providers/weather.ts";
import { MELBOURNE_TZ } from "../time.ts";
import { isActive, loadOverride } from "../engine/override.ts";
import { applyCarSocGate, decide } from "../engine/policy.ts";
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
 * The decision shown here runs the *same two steps* the tick does - the window
 * rules and then the car's own battery gate. Skipping the second one made the
 * dashboard announce "starting to charge" while the daemon, having applied it,
 * left the plug alone.
 *
 * The car is read here in exactly one case: while it is genuinely drawing power.
 * A charging car is already awake, so polling it costs no wake, and the
 * percentage can then climb visibly instead of sitting on an hour-old figure.
 * Any other time `buildState` uses the cache only - waking a sleeping vehicle
 * stays reserved for the decision tick and the explicit refresh action.
 */
export class World {
	#snapshot: { value: EnergySnapshot; at: number } | null = null;
	#weather: { value: WeatherReading; at: number } | null = null;
	#weatherInFlight = false;
	#calibration: Calibration | null = null;
	#calibrationLoaded = false;
	#lastSampledHour: string | null = null;
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

	/**
	 * Cached weather, re-fetched on its own TTL.
	 *
	 * Never awaited by `buildState`: the display refreshes every 15 seconds and a
	 * weather call must not sit in front of it. A failure keeps the last good
	 * reading, and only when that ages out does the UI lose the weather - the
	 * energy dashboard carries on regardless, which is the whole contract for an
	 * optional feed on a house that only needs the LAN.
	 */
	#refreshWeather(): void {
		if (!this.#config.weather.enabled || this.#weatherInFlight) return;
		const fresh = this.#weather && Date.now() - this.#weather.at < this.#config.weather.refreshMs;
		if (fresh) return;
		// Wait for the first Solarman reading when it is our only source of the
		// array size - otherwise the opening forecast would carry no output
		// estimates until the next refresh a quarter of an hour later.
		if (this.#config.weather.arrayKwp === null && !this.#snapshot) return;

		this.#weatherInFlight = true;
		void fetchWeather({
			latitude: this.#config.location.latitude,
			longitude: this.#config.location.longitude,
			// Configured value wins; otherwise use what Solarman already knows about
			// this system, so the forecast works without anyone looking up their
			// array size.
			arrayKwp: this.#config.weather.arrayKwp ?? this.#snapshot?.value.arrayKwp ?? null,
			factor: this.#calibration?.factor,
			timezone: MELBOURNE_TZ,
		})
			.then((value) => {
				this.#weather = { value, at: Date.now() };
				this.#clearError("weather");
			})
			.catch((err) => this.#noteError("weather", err))
			.finally(() => {
				this.#weatherInFlight = false;
			});
	}

	/**
	 * Learn how much this roof makes per unit of forecast irradiance.
	 *
	 * Compares what the system is generating right now against the irradiance the
	 * forecast gave for this hour. One measured ratio replaces guessing at roof
	 * pitch, orientation, shading and inverter losses - and the guess was out by
	 * 1.65x on this house, so the estimate is worth measuring rather than
	 * modelling.
	 */
	async #calibrate(snapshot: EnergySnapshot | null): Promise<void> {
		if (!this.#calibrationLoaded) {
			this.#calibration = await loadCalibration();
			this.#calibrationLoaded = true;
		}
		const arrayKwp = this.#config.weather.arrayKwp ?? snapshot?.arrayKwp ?? null;
		const ghi = this.#currentIrradiance();
		if (!snapshot || arrayKwp === null || ghi === null) return;

		// One sample per forecast hour, taken near its midpoint. The irradiance
		// figure is an hourly average, so a reading every fifteen seconds adds no
		// information - it just drowns the average in whatever the last ten minutes
		// happened to look like.
		const clock = melbourneClock();
		const hourKey = `${new Date().toDateString()}:${clock.hour}`;
		if (this.#lastSampledHour === hourKey || !isSamplingMinute(clock.minute)) return;

		const sample = sampleFactor({
			observedW: snapshot.solarW,
			ghiWm2: ghi,
			arrayKwp,
			batterySoc: snapshot.batterySoc,
		});
		if (sample === null) return; // weak sun, a full battery, or an implausible ratio
		this.#lastSampledHour = hourKey;

		const before = this.#calibration?.factor;
		this.#calibration = nextFactor(this.#calibration, sample);
		if (before !== this.#calibration.factor) {
			logger.debug(
				{ sample: Math.round(sample * 100) / 100, factor: this.#calibration.factor, samples: this.#calibration.samples },
				"solar calibration updated",
			);
			await saveCalibration(this.#calibration);
		}
	}

	/** Forecast irradiance for the hour we are currently in. */
	#currentIrradiance(): number | null {
		const sun = this.#weather?.value.sun;
		if (!sun?.length) return null;
		const now = new Date();
		const key = new Intl.DateTimeFormat("sv-SE", {
			timeZone: MELBOURNE_TZ,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			hourCycle: "h23",
		})
			.format(now)
			.replace(" ", "T");
		return sun.find((h) => h.time.startsWith(key))?.radiationWm2 ?? null;
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

		this.#refreshWeather();
		void this.#calibrate(snapshot);

		const charge = chargeState(
			charger,
			this.#config.car.drawMinW,
			car && { soc: car.soc, chargeLimit: car.chargeLimit, chargingState: car.chargingState },
		);

		const decision =
			snapshot && charger
				? applyCarSocGate(
						decide({
							minutesOfDay: clock.minutesOfDay,
							snapshot,
							charger,
							config: policy,
							// Pending overrides are shown, never acted on - so the preview
							// matches what the tick will actually do.
							override: override && isActive(override) ? override : null,
						}),
						// From the cache, never a fresh read: the display must not wake the
						// car. Slightly staler than the tick's view, which is the price of
						// showing the gate at all.
						car ? { soc: car.soc, stale: Date.now() - car.at >= this.#config.car.socTtlMs } : null,
						charger,
						policy,
					)
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
						locked: car.locked,
						chargingState: car.chargingState,
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
				carStartMaxSoc: policy.carStartMaxSoc,
				batteryBypassPct: policy.batteryBypassPct,
				solarCoverRatio: policy.solarCoverRatio,
				batteryStopPct: policy.batteryStopPct,
				morningStartMin: policy.morningStartMin,
				freeStartMin: policy.freeStartMin,
				freeEndMin: policy.freeEndMin,
			},
			weather: this.#weather
				? {
						temperatureC: this.#weather.value.temperatureC,
						feelsLikeC: this.#weather.value.feelsLikeC,
						cloudCoverPct: this.#weather.value.cloudCoverPct,
						isDay: this.#weather.value.isDay,
						condition: this.#weather.value.condition,
						todayMaxC: this.#weather.value.todayMaxC,
						todayMinC: this.#weather.value.todayMinC,
						// Estimates are recomputed here, not baked in when the forecast was
						// fetched: the calibration can change between refreshes and the
						// figures on screen should follow it immediately rather than
						// carrying a stale factor for up to a quarter of an hour.
						sun: this.#weather.value.sun.map((h) => ({
							time: h.time,
							radiationWm2: h.radiationWm2,
							estimatedW: estimatePv(
								h.radiationWm2,
								this.#config.weather.arrayKwp ?? this.#snapshot?.value.arrayKwp ?? null,
								this.#calibration?.factor,
							),
						})),
						ageMs: Date.now() - this.#weather.at,
						solarFactor: this.#calibration?.factor ?? null,
						solarSamples: this.#calibration?.samples ?? 0,
					}
				: null,
			timezone: MELBOURNE_TZ,
			errors: [...this.#errors],
		};

		// Kick off a battery read if one is due. Deliberately not awaited: a BLE
		// round-trip takes seconds and must not hold up the display refresh. The
		// value lands in the cache and the follow-up publish picks it up.
		void this.#refreshCarWhileCharging(charge, car?.at ?? null);
		this.#wasCharging = charge === "charging";

		return state;
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

	/**
	 * Read the car around the edges of a charge, and while one is running.
	 *
	 * Three moments matter. When a charge **starts** - that first figure anchors
	 * everything the driver watches afterwards. **While it runs**, at
	 * `socTtlChargingMs`, so the percentage climbs visibly. And when the draw
	 * **stops** with the socket still live, because that is the one moment the
	 * dashboard cannot interpret on its own: a car that has finished and a cable
	 * that was never plugged in look identical at the plug. One read settles it,
	 * and the car is certainly awake - it has just this moment stopped charging.
	 */
	async #refreshCarWhileCharging(charge: ChargeState, cachedAt: number | null): Promise<void> {
		if (this.#carReadInFlight) return;

		const charging = charge === "charging";
		const justStarted = charging && !this.#wasCharging;
		const dueWhileCharging =
			charging && (cachedAt === null || Date.now() - cachedAt >= this.#config.car.socTtlChargingMs);
		// Only when the plug is still live: a plug switched off is the guard acting,
		// and waking the car to explain that would be a wake spent on nothing.
		const justStopped = this.#wasCharging && (charge === "waiting" || charge === "full");

		if (!justStarted && !dueWhileCharging && !justStopped) return;

		this.#carReadInFlight = true;
		try {
			const reading = await this.#car.refresh();
			if (reading) {
				logger.info(
					{ soc: reading.soc, trigger: justStopped ? "draw stopped" : justStarted ? "charge started" : "due" },
					"car battery read",
				);
				await this.publish(); // show the new figure without waiting for the next poll
			}
		} catch (err) {
			this.#noteError("car", err);
		} finally {
			this.#carReadInFlight = false;
		}
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
