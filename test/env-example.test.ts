import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ENV_KEYS } from "../src/config.ts";

const example = readFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");

/** `NAME=` at the start of a line, commented out or not. */
function documented(name: string): boolean {
	return new RegExp(`^#?\\s*${name}=`, "m").test(example);
}

/** The value `.env.example` ships for a variable, if it isn't commented out. */
function shipped(name: string): string | null {
	const m = example.match(new RegExp(`^${name}=(.*)$`, "m"));
	return m ? (m[1] ?? "").split("#")[0]!.trim() : null;
}

/**
 * `.env.example` is the only place the settings are described, so a variable
 * that never reaches it is effectively undiscoverable. This came up for real:
 * CAR_DRAW_MIN_W and CAR_SOC_TTL_CHARGING_MINUTES were added to the schema and
 * silently missing from the example.
 */
describe(".env.example documents every setting", () => {
	it("covers every key the config schema reads", () => {
		const missing = ENV_KEYS.filter((k) => !documented(k));
		assert.deepEqual(missing, [], `add these to .env.example: ${missing.join(", ")}`);
	});

	it("covers the variables our child processes read", () => {
		// Not in the zod schema: plug_local.py and tesla-control read these from the
		// environment themselves, but they still have to be set in .env.
		const external = [
			"TAPO_HOST",
			"TAPO_USERNAME",
			"TAPO_PASSWORD",
			"TAPO_ALIAS",
			"TESLA_KEY_NAME",
			"TESLA_VIN",
			"TESLA_CACHE_FILE",
		];
		const missing = external.filter((k) => !documented(k));
		assert.deepEqual(missing, [], `add these to .env.example: ${missing.join(", ")}`);
	});

	it("ships no secrets", () => {
		for (const key of ["DASHBOARD_TOKEN", "TAPO_PASSWORD", "TESLA_VIN", "SOLARMAN_STATION_ID"]) {
			assert.equal(shipped(key) ?? "", "", `${key} must ship blank in .env.example`);
		}
	});

	it("keeps the shipped values matching the schema defaults", () => {
		// A stale example is worse than none: it documents behaviour the code
		// doesn't have.
		for (const [key, expected] of [
			["CAR_SOC_TTL_MINUTES", "60"],
			["CAR_SOC_TTL_CHARGING_MINUTES", "5"],
			["CAR_DRAW_MIN_W", "500"],
			["CAR_START_MAX_SOC", "80"],
			["CAR_POWER_W", "2000"],
			["MAIN_SWITCH_LIMIT_W", "10000"],
			["BATTERY_START_PCT", "40"],
			["BATTERY_STOP_PCT", "15"],
			["BATTERY_BYPASS_PCT", "80"],
			["UI_PORT", "8080"],
			["UI_REFRESH_S", "15"],
			["SOLARMAN_MIN_INTERVAL_S", "60"],
		] as const) {
			assert.equal(shipped(key), expected, `${key} in .env.example should be the schema default`);
		}
	});
});
