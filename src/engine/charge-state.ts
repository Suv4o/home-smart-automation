import type { ChargerState } from "../charger/types.ts";

/**
 * What the plug is actually doing, as opposed to whether it is switched on.
 *
 *   off      the plug is off
 *   waiting  the plug is live but nothing is drawing from it - typically the
 *            cable isn't in the car, or the car has finished
 *   charging the car is drawing real power
 */
export type ChargeState = "off" | "waiting" | "charging" | "full";

/**
 * How close to its own limit counts as finished.
 *
 * The last reading before a car stops drawing is never exactly the limit - it is
 * taken up to a poll interval earlier, so a car that finished at 100% was last
 * seen at 99%. Charging at ~2kW gains about half a percent per five-minute poll,
 * so three points is comfortable margin without swallowing a genuinely
 * part-charged car.
 */
const FULL_TOLERANCE_PCT = 3;

/** The last thing the car told us about itself. All fields may be unknown. */
export interface CarView {
	soc: number;
	chargeLimit: number | null;
	chargingState: string | null;
}

/**
 * Has the car finished, as opposed to never having been connected?
 *
 * Its own word is taken first when it gives one. Otherwise the battery level
 * against its charge limit decides: a car sitting at its limit has finished, and
 * one well below it was never drawing in the first place.
 */
export function carIsFull(car: CarView | null): boolean {
	if (!car) return false;
	if (car.chargingState === "Complete") return true;
	if (car.chargingState === "Disconnected" || car.chargingState === "NoPower") return false;
	if (car.chargeLimit === null) return false;
	return car.soc >= car.chargeLimit - FULL_TOLERANCE_PCT;
}

/**
 * A live plug is not the same thing as a charging car.
 *
 * The dashboard used to treat "plug on" as "car charging", which is wrong
 * whenever the cable isn't plugged in: the socket sits energised at a couple of
 * watts and the illustration claimed a charge was under way. The mobile
 * connector pulls around 2kW, so anything under `minDrawW` means no car is
 * taking power.
 *
 * This is also the trigger for reading the battery more often: a car that is
 * drawing power is awake, so polling it costs nothing extra.
 */
export function chargeState(charger: ChargerState | null, minDrawW: number, car: CarView | null = null): ChargeState {
	if (!charger || !charger.on) return "off";
	if (charger.powerW >= minDrawW) return "charging";
	// A live socket with nothing drawing has two very different causes, and
	// telling the user the wrong one is worse than saying nothing: a car that has
	// finished was reported as "waiting to be plugged in" while sitting there
	// plugged in and full.
	return carIsFull(car) ? "full" : "waiting";
}

/** What the tick should do with an override, given what the car is doing. */
export type OverrideAction = "keep" | "mark-charging" | "release";

/**
 * Whether a "charge for N hours" override has served its purpose early.
 *
 * The signal is the car itself stopping: the socket is still live, but nothing
 * is drawing from it any more. Two conditions stop that being misread:
 *
 *   - it only counts once the car has actually charged under this override
 *     (`sawCharging`), so setting one before plugging in doesn't cancel itself;
 *   - a plug that is *off* is never treated as finished, because that is the
 *     breaker guard holding the charge back, not the car being done.
 *
 * A car that pauses mid-charge - for thermal reasons, say - looks the same as
 * one that has finished. The consequence is mild: control returns to the normal
 * schedule, which will start it again if the conditions still warrant it.
 */
export function overrideAction(
	override: { mode: string; releaseWhenDone?: boolean; sawCharging?: boolean } | null,
	charge: ChargeState,
): OverrideAction {
	if (!override || override.mode !== "force_on" || !override.releaseWhenDone) return "keep";
	if (charge === "charging") return override.sawCharging ? "keep" : "mark-charging";
	// "off" is the guard, not the car: only a live socket with nothing drawing
	// from it means the car has stopped of its own accord. "full" is the same
	// event, just with the reason confirmed.
	if ((charge === "waiting" || charge === "full") && override.sawCharging) return "release";
	return "keep";
}
