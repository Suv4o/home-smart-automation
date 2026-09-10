import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { logger } from "../logger.ts";
import { encryptPassword, SOLARMAN_PUBLIC_KEYS } from "./solarman-crypto.ts";
import type { EnergySnapshot, SolarProvider } from "./types.ts";

/**
 * Client for the API the globalhome.solarmanpv.com web app talks to itself.
 *
 * Endpoints and field names here were captured from a live session in the
 * browser, not from public documentation, so they can change without notice.
 * Responses are checked rather than trusted: a shape change should fail loudly
 * here rather than quietly produce an `undefined` that ends up deciding
 * whether to draw kilowatts from the grid.
 */

const BASE = "https://globalhome.solarmanpv.com";
/** The public client id the web app itself uses. */
const CLIENT_ID = "test";
const REQUEST_TIMEOUT_MS = 20_000;

/** Matches the query the web app itself sends. */
const STATION_SEARCH = "/maintain-s/operating/station/search?order.direction=DESC&order.property=id&page=1&size=20";

const TOKEN_FILE = join(
	process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"),
	"home-automation",
	"solarman.token.json",
);

const TokenResponse = z
	.object({
		access_token: z.string().min(1),
		refresh_token: z.string().min(1).optional(),
		expires_in: z.number().optional(),
	})
	.loose();

export interface TokenSet {
	accessToken: string;
	refreshToken: string | undefined;
	/** Epoch ms. */
	expiresAt: number;
}

export class SolarmanAuthError extends Error {}
export class SolarmanShapeError extends Error {}

async function readTokenCache(): Promise<TokenSet | null> {
	try {
		const t = JSON.parse(await readFile(TOKEN_FILE, "utf8")) as TokenSet;
		return typeof t.accessToken === "string" && typeof t.expiresAt === "number" ? t : null;
	} catch {
		return null;
	}
}

async function writeTokenCache(t: TokenSet): Promise<void> {
	await mkdir(dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
	await writeFile(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

export function tokenCachePath(): string {
	return TOKEN_FILE;
}

/**
 * Seeds the token cache with a refresh token lifted from a logged-in browser
 * session. `expiresAt: 0` forces the very next request to redeem it, which both
 * validates the token and swaps it for a fresh, rotating pair. This is the
 * supported way in - headless password login is blocked by Cloudflare
 * Turnstile (see docs/authentication.md).
 */
export async function seedRefreshToken(refreshToken: string): Promise<void> {
	await writeTokenCache({ accessToken: "", refreshToken, expiresAt: 0 });
}

/** Retries transient transport failures only. Never wraps a decision. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
	let lastError: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (err instanceof SolarmanAuthError || err instanceof SolarmanShapeError) throw err;
			if (i < attempts - 1) {
				const backoff = 500 * 2 ** i;
				logger.warn({ label, attempt: i + 1, backoff, err: String(err) }, "retrying");
				await new Promise((r) => setTimeout(r, backoff));
			}
		}
	}
	throw lastError;
}

export class SolarmanWebProvider implements SolarProvider {
	readonly name = "solarman-web";

	readonly #email: string | undefined;
	readonly #password: string | undefined;

	#tokens: TokenSet | null = null;
	/** Single-flighted so concurrent 401s cause one refresh, not a stampede. */
	#pendingAuth: Promise<TokenSet> | null = null;
	#stationId: string | undefined;
	#raw: unknown = null;

	constructor(email?: string, password?: string, stationId?: string) {
		this.#email = email;
		this.#password = password;
		this.#stationId = stationId;
	}

	lastRaw(): unknown {
		return this.#raw;
	}

	async close(): Promise<void> {}

	// --- auth ---------------------------------------------------------------

	/**
	 * OAuth2 password grant. The password is RSA-encrypted before sending - the
	 * token endpoint rejects a plaintext password with `AUTH_INVALID_PARAM`.
	 *
	 * The app selects one of three public keys by build environment. The
	 * production key is tried first; if it comes back `AUTH_INVALID_PARAM` (the
	 * symptom of the server being unable to decrypt) the other keys are tried
	 * before giving up, so login does not hinge on guessing the environment.
	 */
	async login(): Promise<TokenSet> {
		if (!this.#email || !this.#password) {
			throw new SolarmanAuthError(
				"No cached token and no SOLARMAN_EMAIL/SOLARMAN_PASSWORD set. Seed a refresh token instead - " +
					"see docs/authentication.md.",
			);
		}
		const keys = Object.entries(SOLARMAN_PUBLIC_KEYS);
		let lastError: unknown;
		for (const [keyName, pem] of keys) {
			const body = new URLSearchParams({
				grant_type: "password",
				username: this.#email,
				password: encryptPassword(this.#password, pem),
				client_id: CLIENT_ID,
			});
			try {
				const tokens = await this.#tokenRequest(body, `login (${keyName} key)`);
				this.#tokens = tokens;
				await writeTokenCache(tokens);
				return tokens;
			} catch (err) {
				lastError = err;
				// Only a decrypt-side rejection is worth retrying with another
				// key; a genuine bad-credentials error would recur identically.
				if (err instanceof SolarmanAuthError && /AUTH_INVALID_PARAM/.test(err.message)) {
					logger.warn({ keyName }, "login rejected the key, trying the next one");
					continue;
				}
				throw err;
			}
		}
		throw lastError;
	}

	async #refresh(refreshToken: string): Promise<TokenSet> {
		const tokens = await this.#tokenRequest(
			new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CLIENT_ID,
			}),
			"refresh",
		);
		this.#tokens = tokens;
		await writeTokenCache(tokens);
		return tokens;
	}

	async #tokenRequest(body: URLSearchParams, label: string): Promise<TokenSet> {
		const res = await fetch(`${BASE}/oauth2-s/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const text = await res.text();
		if (!res.ok) {
			throw new SolarmanAuthError(
				`${label} failed: HTTP ${res.status} ${text.slice(0, 500)}\n` +
					`If this is a 400/401 the grant fields have likely changed - re-capture the real ` +
					`login request (see docs/authentication.md).`,
			);
		}
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			throw new SolarmanAuthError(`${label} returned non-JSON: ${text.slice(0, 300)}`);
		}
		const parsed = TokenResponse.safeParse(json);
		if (!parsed.success) throw new SolarmanAuthError(`${label} response missing access_token: ${text.slice(0, 300)}`);

		const { access_token, refresh_token, expires_in } = parsed.data;
		// Expire a minute early so a request never races the boundary.
		const ttl = (expires_in ?? 3600) * 1000 - 60_000;
		return { accessToken: access_token, refreshToken: refresh_token, expiresAt: Date.now() + Math.max(ttl, 0) };
	}

	async #auth(force = false): Promise<TokenSet> {
		if (this.#pendingAuth) return this.#pendingAuth;

		this.#tokens ??= await readTokenCache();
		const current = this.#tokens;
		if (!force && current && current.expiresAt > Date.now()) return current;

		this.#pendingAuth = (async () => {
			try {
				if (current?.refreshToken) {
					try {
						return await this.#refresh(current.refreshToken);
					} catch (err) {
						logger.warn({ err: String(err) }, "refresh failed, falling back to full login");
					}
				}
				return await this.login();
			} finally {
				this.#pendingAuth = null;
			}
		})();
		return this.#pendingAuth;
	}

	async #authedFetch(path: string, init: RequestInit = {}): Promise<unknown> {
		const call = async (token: string): Promise<Response> =>
			fetch(`${BASE}${path}`, {
				...init,
				headers: { Accept: "application/json", ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});

		return withRetry(path, async () => {
			let { accessToken } = await this.#auth();
			let res = await call(accessToken);
			if (res.status === 401 || res.status === 403) {
				({ accessToken } = await this.#auth(true));
				res = await call(accessToken);
			}
			const text = await res.text();
			if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
			try {
				return JSON.parse(text) as unknown;
			} catch {
				throw new SolarmanShapeError(`${path} returned non-JSON: ${text.slice(0, 300)}`);
			}
		});
	}

	// --- data ---------------------------------------------------------------

	async stationId(): Promise<string> {
		if (this.#stationId) return this.#stationId;
		const json = await this.#authedFetch(STATION_SEARCH, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		const id = findStationId(json);
		if (!id) {
			throw new SolarmanShapeError(
				`Could not find a station id in the station list response. Run \`snapshot --raw\` and set ` +
					`SOLARMAN_STATION_ID in .env manually. Payload: ${JSON.stringify(json).slice(0, 500)}`,
			);
		}
		this.#stationId = id;
		logger.info({ stationId: id }, "discovered station");
		return id;
	}

	/**
	 * Two calls, because the power figures and the battery SOC live on
	 * different endpoints - `fast/system` carries no `batterySoc` at all.
	 */
	async snapshot(): Promise<EnergySnapshot> {
		const id = await this.stationId();
		const [fast, operating] = await Promise.all([
			this.#authedFetch(`/maintain-s/fast/system/${id}`),
			this.#authedFetch(`/maintain-s/operating/system/${id}`),
		]);
		this.#raw = { fast, operating };
		return mapSnapshot(fast, operating);
	}
}

// --- mapping ---------------------------------------------------------------

/** Depth-first search for the first plausible station id in an unknown payload. */
function findStationId(node: unknown, depth = 0): string | undefined {
	if (depth > 6 || node === null || typeof node !== "object") return undefined;
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = findStationId(item, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
	const rec = node as Record<string, unknown>;
	for (const key of ["systemId", "stationId", "id"]) {
		const v = rec[key];
		if (typeof v === "number" || (typeof v === "string" && v !== "")) return String(v);
	}
	for (const v of Object.values(rec)) {
		const found = findStationId(v, depth + 1);
		if (found) return found;
	}
	return undefined;
}

function requireNumber(node: unknown, field: string, endpoint: string): number {
	const v = (node as Record<string, unknown> | null)?.[field];
	const n = typeof v === "string" ? Number(v) : v;
	if (typeof n !== "number" || !Number.isFinite(n)) {
		const keys = node && typeof node === "object" ? Object.keys(node).slice(0, 40).join(", ") : "(not an object)";
		throw new SolarmanShapeError(
			`Expected a number at \`${field}\` in the ${endpoint} response but got ${JSON.stringify(v)}. ` +
				`Run \`snapshot --raw\` to see the payload. Keys present: ${keys}`,
		);
	}
	return n;
}

/**
 * Reads an enum-ish string field. Unknown values throw rather than defaulting,
 * because a wrong battery direction inverts every downstream safety decision.
 */
/**
 * The array's rated size, recovered from figures Solarman already publishes.
 *
 * "Full power hours" is generation divided by rated capacity - the standard
 * equivalent-full-load-hours measure - so dividing back the other way returns the
 * capacity. Saves the owner digging their system size out of installation
 * paperwork just to get a forecast.
 *
 * Lifetime totals are used rather than today's: at dawn both of today's figures
 * are near zero and their ratio is meaningless.
 */
export function deriveArrayKwp(fast: unknown): number | null {
	const f = (fast ?? {}) as Record<string, unknown>;
	const kwh = f["generationUploadTotal"];
	const hours = f["fullPowerHoursTotal"];
	if (typeof kwh !== "number" || typeof hours !== "number") return null;
	if (!(hours > 1) || !(kwh > 0)) return null; // too new to say anything useful
	const kwp = kwh / hours;
	// Sanity band: domestic rooftop arrays live between these. Anything outside
	// means the fields don't mean what we think, so say nothing.
	return kwp >= 0.5 && kwp <= 100 ? Math.round(kwp * 100) / 100 : null;
}

function requireStatus(node: unknown, field: string, endpoint: string): string {
	const v = (node as Record<string, unknown> | null)?.[field];
	const s = typeof v === "string" ? v.trim().toUpperCase() : "";
	if (s !== "CHARGE" && s !== "DISCHARGE" && s !== "STANDBY" && s !== "STATIC" && s !== "IDLE") {
		throw new SolarmanShapeError(
			`Unexpected \`${field}\` in the ${endpoint} response: ${JSON.stringify(v)}. ` +
				`Refusing to guess the battery direction - add the new value to requireStatus().`,
		);
	}
	return s;
}

/**
 * Maps the two captured endpoints onto EnergySnapshot.
 *
 * Grid power is *derived* rather than read. The payload does expose
 * `gridPower`, `buyPower` and `wirePower`, but their sign convention could not
 * be pinned down: in a captured night-time reading (importing, per
 * `wireStatus: "PURCHASE"`) they read 0, -3 and -3 respectively - too close to
 * zero to tell import from export. Getting that sign backwards would invert
 * every charging decision, so grid is instead computed from the energy
 * balance, using only fields whose meaning is unambiguous:
 *
 *     load = pv + discharge - charge + import
 *  => import = load - pv + (charge - discharge)
 *
 * Against the captured reading that gives 1876 - 0 + (0 - 1780) = 96W import,
 * consistent with `wireStatus: "PURCHASE"`.
 */
export function mapSnapshot(fast: unknown, operating: unknown): EnergySnapshot {
	const solarW = requireNumber(fast, "generationPower", "fast/system");
	const loadW = requireNumber(fast, "usePower", "fast/system");
	const batterySoc = requireNumber(operating, "batterySoc", "operating/system");

	// Battery direction comes from `batteryStatus`, NOT from the sign of the
	// power fields. Upstream reports charging as a *negative* `chargePower` /
	// `batteryPower` (e.g. -6300 while charging at 6.3kW) and discharging as a
	// *positive* `dischargePower`. Inferring the convention from a single
	// night-time sample got this backwards once already, which silently
	// inverted `gridW` and disabled the main-switch guard - so the direction is
	// now read from the field that states it explicitly.
	const status = requireStatus(fast, "batteryStatus", "fast/system");
	const magnitudeW = Math.abs(requireNumber(fast, "batteryPower", "fast/system"));
	const batteryW =
		status === "CHARGE" ? magnitudeW : status === "DISCHARGE" ? -magnitudeW : /* STANDBY etc. */ 0;

	// Conservation of energy: everything the house draws comes from PV, the
	// battery, or the grid. Positive = importing.
	const gridW = loadW - solarW + batteryW;

	return {
		// Neither endpoint carries a reading timestamp, so this is fetch time.
		// See the staleness note in the README.
		at: new Date(),
		solarW,
		loadW,
		batterySoc,
		batteryW,
		gridW,
		arrayKwp: deriveArrayKwp(fast),
		source: "web",
	};
}
