import { logger } from "../logger.ts";
import type { ChargerController, ChargerState } from "./types.ts";

/**
 * Wraps a real controller: reads pass straight through so decisions are made
 * against genuine plug state, but switching only logs. This is the default
 * until `--live` is passed, so a day of observation costs nothing.
 */
export class DryRunCharger implements ChargerController {
	readonly name: string;
	readonly #delegate: ChargerController;

	constructor(delegate: ChargerController) {
		this.#delegate = delegate;
		this.name = `${delegate.name} (dry-run)`;
	}

	state(): Promise<ChargerState> {
		return this.#delegate.state();
	}

	async on(): Promise<void> {
		logger.info("DRY RUN: would switch charger ON");
	}

	async off(): Promise<void> {
		logger.info("DRY RUN: would switch charger OFF");
	}
}
