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
