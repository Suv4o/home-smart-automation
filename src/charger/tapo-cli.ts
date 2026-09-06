import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.ts";
import type { ChargerController, ChargerState } from "./types.ts";

const run = promisify(execFile);
const TIMEOUT_MS = 60_000;

/**
 * The plug allows only one KLAP session at a time - two overlapping handshakes
 * get a `400 to handshake2`. The decision tick and the display poller can fire
 * together (both run at daemon startup), so every plug call in this process
 * queues behind the last one.
 */
let chain: Promise<unknown> = Promise.resolve();
function serialise<T>(fn: () => Promise<T>): Promise<T> {
	const next = chain.then(fn, fn);
	chain = next.catch(() => undefined);
	return next;
}

export class PlugCliError extends Error {}

/**
 * Drives the plug by shelling out to the Python local CLI
 * (`scripts/plug_local.py`), which controls the P110 over the LAN via
 * python-kasa. Keeping the plug protocol in Python lets us reuse the same
 * library the tapo-smart-plug repo already relies on.
 *
 * `cliCmd` is a full command line ("uv run --script scripts/plug_local.py");
 * the subcommand (state/on/off) is appended.
 */
export class TapoCliCharger implements ChargerController {
	readonly name = "tapo-cloud";
	readonly #cmd: string;
	readonly #args: string[];

	constructor(cliCmd: string) {
		const parts = cliCmd.trim().split(/\s+/);
		this.#cmd = parts[0] ?? "python3";
		this.#args = parts.slice(1);
	}

	async #invoke(sub: "state" | "on" | "off"): Promise<string> {
		return serialise(() => this.#invokeNow(sub));
	}

	async #invokeNow(sub: "state" | "on" | "off"): Promise<string> {
		try {
			const { stdout, stderr } = await run(this.#cmd, [...this.#args, sub], { timeout: TIMEOUT_MS });
			if (stderr.trim()) logger.debug({ sub, stderr: stderr.trim() }, "plug cli stderr");
			return stdout;
		} catch (err) {
			const e = err as { stderr?: string; message?: string };
			throw new PlugCliError(
				`plug CLI \`${this.#cmd} ${[...this.#args, sub].join(" ")}\` failed: ${e.stderr?.trim() || e.message}`,
			);
		}
	}

	async state(): Promise<ChargerState> {
		const stdout = await this.#invoke("state");
		let parsed: unknown;
		try {
			parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
		} catch {
			throw new PlugCliError(`plug CLI state returned non-JSON: ${stdout.slice(0, 200)}`);
		}
		const rec = parsed as { on?: unknown; powerW?: unknown };
		if (typeof rec.on !== "boolean") {
			throw new PlugCliError(`plug CLI state missing boolean 'on': ${JSON.stringify(parsed)}`);
		}
		const powerW = typeof rec.powerW === "number" && Number.isFinite(rec.powerW) ? rec.powerW : 0;
		return { on: rec.on, powerW };
	}

	async on(): Promise<void> {
		await this.#invoke("on");
		logger.info("charger switched on");
	}

	async off(): Promise<void> {
		await this.#invoke("off");
		logger.info("charger switched off");
	}
}
