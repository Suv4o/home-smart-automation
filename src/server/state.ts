import type { PolicyConfig } from "../config.ts";
import type { ChargeState } from "../engine/charge-state.ts";
import type { Override } from "../engine/override.ts";
import type { Action, Window } from "../engine/policy.ts";
import type { Sky } from "./sky.ts";

/** Everything the dashboard needs, in one serialisable object. */
export interface DashboardState {
	/** When this state was assembled (ISO). */
	readonly at: string;
	readonly sky: Sky;
	/** Null when Solarman couldn't be read - the UI says so rather than lying. */
	readonly energy: {
		solarW: number;
		loadW: number;
		gridW: number;
		batteryW: number;
		batterySoc: number;
		/** When the reading was taken (ISO), so the UI can age it. */
		at: string;
	} | null;
	readonly charger: { on: boolean; powerW: number } | null;
	/**
	 * What the plug is actually doing. "waiting" means it is live but the car
	 * isn't drawing - the cable is probably not plugged in.
	 */
	readonly chargeState: ChargeState;
	/** From cache only - the display never wakes the car. */
	readonly car: {
		soc: number;
		at: string;
		ageMs: number;
		/**
		 * Minutes the car said it still needed, as of `at` - the figure the Tesla
		 * app shows. Null when the car isn't reporting one. The UI counts down from
		 * the reading rather than treating it as current.
		 */
		minutesToFull: number | null;
		chargeLimit: number | null;
	} | null;
	readonly decision: { action: Action; window: Window; reason: string; source: "policy" | "override" } | null;
	readonly override: Override | null;
	/** Thresholds, so the UI can label what it's showing without hardcoding them. */
	readonly limits: Pick<
		PolicyConfig,
		"mainSwitchLimitW" | "carPowerW" | "carMaxSoc" | "batteryBypassPct" | "solarCoverRatio" | "batteryStopPct"
	> & { morningStartMin: number; freeStartMin: number; freeEndMin: number };
	/** Recent read failures, so a degraded state is visible rather than silent. */
	readonly errors: string[];
}

type Listener = (s: DashboardState) => void;

/**
 * One in-memory copy of the world, with subscribers. Both the decision tick and
 * the faster display poller write here; SSE clients read from it.
 */
export class StateStore {
	#state: DashboardState | null = null;
	readonly #listeners = new Set<Listener>();

	get(): DashboardState | null {
		return this.#state;
	}

	set(next: DashboardState): void {
		this.#state = next;
		for (const l of this.#listeners) {
			try {
				l(next);
			} catch {
				// a broken client must not take down the loop
			}
		}
	}

	/** Returns an unsubscribe function. */
	subscribe(l: Listener): () => void {
		this.#listeners.add(l);
		return () => this.#listeners.delete(l);
	}

	get subscriberCount(): number {
		return this.#listeners.size;
	}
}
