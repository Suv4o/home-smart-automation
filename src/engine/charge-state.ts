import type { ChargerState } from "../charger/types.ts";

/**
 * What the plug is actually doing, as opposed to whether it is switched on.
 *
 *   off      the plug is off
 *   waiting  the plug is live but nothing is drawing from it - typically the
 *            cable isn't in the car, or the car has finished
 *   charging the car is drawing real power
 */
export type ChargeState = "off" | "waiting" | "charging";

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
export function chargeState(charger: ChargerState | null, minDrawW: number): ChargeState {
	if (!charger || !charger.on) return "off";
	return charger.powerW >= minDrawW ? "charging" : "waiting";
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
	// from it means the car has stopped of its own accord.
	if (charge === "waiting" && override.sawCharging) return "release";
	return "keep";
}
