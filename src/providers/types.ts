/** Where a snapshot came from. Kept on the reading so logs stay diagnosable. */
export type SnapshotSource = "web" | "local" | "openapi";

/**
 * One normalised reading of the whole system. Every provider maps its own
 * vendor-shaped payload into this, so the policy engine never sees Solarman
 * field names.
 *
 * Sign conventions matter and are easy to get backwards:
 *   batteryW  positive = charging,  negative = discharging
 *   gridW     positive = importing, negative = exporting
 */
export interface EnergySnapshot {
	/** When the inverter produced the reading - not when we fetched it. */
	readonly at: Date;
	/** PV generation, watts. */
	readonly solarW: number;
	/** Whole-house consumption, watts. Includes whatever the charger is drawing. */
	readonly loadW: number;
	/** House battery state of charge, 0-100. */
	readonly batterySoc: number;
	readonly batteryW: number;
	readonly gridW: number;
	readonly source: SnapshotSource;
}

export interface SolarProvider {
	readonly name: string;
	snapshot(): Promise<EnergySnapshot>;
	/** Untouched upstream payload from the last snapshot, for `--raw` debugging. */
	lastRaw(): unknown;
	close(): Promise<void>;
}
