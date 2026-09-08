/** Mirrors `DashboardState` on the server (src/server/state.ts). */
export type Action = "on" | "off";
export type Window = "free" | "morning" | "solar";
export type SkyPhase = "day" | "dawn" | "dusk" | "night";

export interface Sky {
	phase: SkyPhase;
	sunElevation: number;
	moonPhase: number;
	moonFraction: number;
	moonName: string;
	daylight: number;
}

export interface DashboardState {
	at: string;
	sky: Sky;
	energy: { solarW: number; loadW: number; gridW: number; batteryW: number; batterySoc: number; at: string } | null;
	charger: { on: boolean; powerW: number } | null;
	/** "waiting" = plug live but nothing drawing, i.e. no cable in the car. */
	chargeState: "off" | "waiting" | "charging";
	car: {
		soc: number;
		at: string;
		ageMs: number;
		minutesToFull: number | null;
		chargeLimit: number | null;
		/** null = we have never been told; the UI says so rather than guessing. */
		locked: boolean | null;
	} | null;
	decision: { action: Action; window: Window; reason: string; source: "policy" | "override" } | null;
	override: { mode: "force_on" | "force_off"; until: number; setAt: number; releaseWhenDone?: boolean } | null;
	limits: {
		mainSwitchLimitW: number;
		carPowerW: number;
		carMaxSoc: number;
		batteryBypassPct: number;
		solarCoverRatio: number;
		batteryStopPct: number;
		morningStartMin: number;
		freeStartMin: number;
		freeEndMin: number;
	};
	errors: string[];
}
