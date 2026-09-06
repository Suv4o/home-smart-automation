import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { TeslaCar } from "../car/tesla.ts";
import type { AppConfig } from "../config.ts";
import { clearOverride, type OverrideMode, saveOverride } from "../engine/override.ts";
import { logger } from "../logger.ts";
import type { StateStore } from "./state.ts";
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

		const body = (await c.req.json().catch(() => ({}))) as { mode?: string; hours?: number };
		if (body.mode !== "force_on" && body.mode !== "force_off") {
			return c.json({ error: "mode must be force_on or force_off" }, 400);
		}
		const hours = typeof body.hours === "number" && body.hours > 0 && body.hours <= 12 ? body.hours : 2;
		const override = await saveOverride(body.mode as OverrideMode, Date.now() + hours * 3_600_000);

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
