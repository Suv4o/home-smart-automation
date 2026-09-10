import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { TeslaCar } from "../car/tesla.ts";
import type { AppConfig } from "../config.ts";
import { clearOverride, type OverrideMode, saveOverride } from "../engine/override.ts";
import { logger } from "../logger.ts";
import type { StateStore } from "./state.ts";
import { nextOccurrenceMs } from "../time.ts";
import type { World } from "./world.ts";

/** Keep SSE connections from being dropped by idle timeouts. */
const HEARTBEAT_MS = 20_000;
/** The car refresh wakes the vehicle - don't let it be spammed. */
const CAR_REFRESH_COOLDOWN_MS = 60_000;

export interface ServerDeps {
	readonly config: AppConfig;
	readonly store: StateStore;
	readonly world: World;
	readonly car: TeslaCar;
	/** Runs a full decision tick immediately, so an override takes effect at once. */
	readonly runTick: () => Promise<void>;
}

export function startServer(deps: ServerDeps, signal: AbortSignal): void {
	const { config, store, world, car } = deps;
	const app = new Hono();

	/**
	 * Reads are open on the LAN so the tablet just works. Writes need the token -
	 * they can switch a 2kW load, so they are not something any device on the
	 * network should be able to do.
	 */
	const requireToken = (header: string | undefined): string | null => {
		if (!config.ui.token) return "controls are disabled (set DASHBOARD_TOKEN to enable them)";
		const supplied = header?.replace(/^Bearer\s+/i, "").trim();
		return supplied === config.ui.token ? null : "invalid or missing token";
	};

	app.get("/api/state", (c) => {
		const s = store.get();
		return s ? c.json(s) : c.json({ error: "no reading yet" }, 503);
	});

	// Server-Sent Events: one-way server->client, so no WebSocket needed, and
	// EventSource reconnects on its own if the daemon restarts.
	app.get("/api/stream", (c) => {
		return new Response(
			new ReadableStream({
				start(controller) {
					const enc = new TextEncoder();
					const send = (data: unknown): void => {
						try {
							controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
						} catch {
							// client vanished mid-write; cleanup below handles it
						}
					};

					const current = store.get();
					if (current) send(current);

					const unsubscribe = store.subscribe(send);
					// A *named* event, not a bare comment: the browser exposes it to
					// the page, so the dashboard can tell "quiet because nothing
					// changed" from "quiet because the stream died". A comment would
					// keep proxies happy but stay invisible to the client.
					const heartbeat = setInterval(() => {
						try {
							controller.enqueue(enc.encode(`event: ping\ndata: ${Date.now()}\n\n`));
						} catch {
							/* ignore */
						}
					}, HEARTBEAT_MS);

					const close = (): void => {
						clearInterval(heartbeat);
						unsubscribe();
						try {
							controller.close();
						} catch {
							/* already closed */
						}
					};
					c.req.raw.signal.addEventListener("abort", close, { once: true });
					signal.addEventListener("abort", close, { once: true });
				},
			}),
			{
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				},
			},
		);
	});

	app.post("/api/override", async (c) => {
		const denied = requireToken(c.req.header("Authorization"));
		if (denied) return c.json({ error: denied }, 401);

		const body = (await c.req.json().catch(() => ({}))) as {
			mode?: string;
			hours?: number;
			releaseWhenDone?: unknown;
			/** Optional "HH:MM" wall-clock start, resolved here rather than by the client. */
			startAt?: unknown;
		};
		if (body.mode !== "force_on" && body.mode !== "force_off") {
			return c.json({ error: "mode must be force_on or force_off" }, 400);
		}
		const hours = typeof body.hours === "number" && body.hours > 0 && body.hours <= 12 ? body.hours : 2;

		// The start time is resolved on this side on purpose. The tablet may be set
		// to another timezone, and the windows the user is scheduling around are
		// Melbourne wall time - so "22:00" has to mean 22:00 to the policy, not to
		// whatever clock the browser happens to be running.
		let from: number | undefined;
		if (body.startAt !== undefined && body.startAt !== null && body.startAt !== "") {
			if (typeof body.startAt !== "string") {
				return c.json({ error: "startAt must be a HH:MM string" }, 400);
			}
			const resolved = nextOccurrenceMs(body.startAt);
			if (resolved === null) return c.json({ error: `startAt is not a time of day: ${body.startAt}` }, 400);
			from = resolved;
		}

		// The run length counts from when it starts, not from when it was set.
		const override = await saveOverride(
			body.mode as OverrideMode,
			(from ?? Date.now()) + hours * 3_600_000,
			body.releaseWhenDone === true,
			from,
		);

		await deps.runTick(); // act immediately so the button feels instant
		await world.publish();
		return c.json(override);
	});

	app.delete("/api/override", async (c) => {
		const denied = requireToken(c.req.header("Authorization"));
		if (denied) return c.json({ error: denied }, 401);
		await clearOverride();
		logger.info("override cleared - back to automatic");
		await deps.runTick();
		await world.publish();
		return c.json({ ok: true });
	});

	/**
	 * Lock or unlock. Takes the state you want rather than "toggle", so a stale
	 * dashboard can never send the opposite of what its button offered.
	 */
	app.post("/api/car/lock", async (c) => {
		const denied = requireToken(c.req.header("Authorization"));
		if (denied) return c.json({ error: denied }, 401);

		const body = (await c.req.json().catch(() => ({}))) as { locked?: unknown };
		if (typeof body.locked !== "boolean") {
			return c.json({ error: "locked must be true or false" }, 400);
		}
		logger.info({ locked: body.locked }, body.locked ? "locking the car" : "unlocking the car");
		try {
			const actual = await car.setLocked(body.locked);
			await world.publish();
			return c.json({ locked: actual });
		} catch (err) {
			await world.publish();
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	let lastCarRefresh = 0;
	app.post("/api/car/refresh", async (c) => {
		const denied = requireToken(c.req.header("Authorization"));
		if (denied) return c.json({ error: denied }, 401);

		const since = Date.now() - lastCarRefresh;
		if (since < CAR_REFRESH_COOLDOWN_MS) {
			return c.json({ error: `wait ${Math.ceil((CAR_REFRESH_COOLDOWN_MS - since) / 1000)}s` }, 429);
		}
		lastCarRefresh = Date.now();
		logger.info("manual car refresh requested - this wakes the car");
		const reading = await car.refresh();
		await world.publish();
		return reading ? c.json(reading) : c.json({ error: "could not reach the car" }, 502);
	});

	// The built SPA. Anything not matched above falls through to index.html.
	app.use("/*", serveStatic({ root: "./ui/dist" }));
	app.get("/*", serveStatic({ path: "./ui/dist/index.html" }));

	const server = serve({ fetch: app.fetch, port: config.ui.port, hostname: config.ui.host }, (info) => {
		logger.info({ host: config.ui.host, port: info.port }, "dashboard listening");
	});
	signal.addEventListener("abort", () => server.close(), { once: true });
}
