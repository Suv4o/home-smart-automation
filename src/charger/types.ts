export interface ChargerState {
	readonly on: boolean;
	/** Present draw in watts. 0 when off. */
	readonly powerW: number;
}

/**
 * A switchable load. Deliberately on/off only - the P110 is a plain relay with
 * energy monitoring, it cannot modulate charging current.
 */
export interface ChargerController {
	readonly name: string;
	/** One round trip for both facts, since every poll needs them together. */
	state(): Promise<ChargerState>;
	on(): Promise<void>;
	off(): Promise<void>;
}
