import { useEffect, useRef, useState } from "react";
import type { DashboardState } from "../lib/types.ts";

export type Connection = "connecting" | "live" | "offline";

/** The server pings every 20s; three misses means the stream is dead. */
const STALE_MS = 62_000;
/** How often the watchdog checks. */
const CHECK_MS = 2_000;

/**
 * Subscribes to the server's SSE stream, and keeps itself honest about whether
 * that stream is actually alive.
 *
 * Two things learned the hard way shape this:
 *
 * 1. **Don't fight EventSource's own reconnect.** `error` fires with readyState
 *    CONNECTING while the browser is *already* retrying. Calling `close()` there
 *    cancels that native retry and hands recovery to a `setTimeout` - which a
 *    background or occluded tab throttles hard. A wall dashboard is backgrounded
 *    almost all the time, so that is precisely when it would fail to come back.
 *    We now only take over once the source has genuinely given up (CLOSED).
 *
 * 2. **A quiet stream is not a live one.** The screen showed hours-old energy
 *    figures while still claiming "live", because nothing ever contradicted the
 *    last message. The server's ping lets us tell silence from death, and the
 *    watchdog forces a fresh connection when the pings stop - whatever the cause.
 *
 * Stale numbers on an energy dashboard are worse than no numbers, so silence is
 * always reported rather than papered over.
 */
export function useLiveState(): { state: DashboardState | null; connection: Connection } {
	const [state, setState] = useState<DashboardState | null>(null);
	const [connection, setConnection] = useState<Connection>("connecting");
	const retryRef = useRef(0);

	useEffect(() => {
		let source: EventSource | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;
		let lastSeen = Date.now();

		const connect = (): void => {
			if (cancelled) return;
			source?.close();
			lastSeen = Date.now();
			source = new EventSource("/api/stream");

			source.onopen = () => {
				retryRef.current = 0;
				lastSeen = Date.now();
				setConnection("live");
			};
			source.onmessage = (e) => {
				lastSeen = Date.now();
				setConnection("live");
				try {
					setState(JSON.parse(e.data) as DashboardState);
				} catch {
					// a malformed frame shouldn't kill the stream
				}
			};
			// Proof of life between state changes; carries no payload we need.
			source.addEventListener("ping", () => {
				lastSeen = Date.now();
				setConnection("live");
			});
			source.onerror = () => {
				if (cancelled) return;
				if (source?.readyState === EventSource.CLOSED) {
					// It has stopped trying, so recovery is ours. Back off to 30s so a
					// long outage doesn't hammer the daemon.
					setConnection("offline");
					const delay = Math.min(30_000, 1000 * 2 ** retryRef.current++);
					timer = setTimeout(connect, delay);
				} else {
					// Still retrying by itself - leave it alone and say so.
					setConnection("connecting");
				}
			};
		};

		// Watchdog: whatever the reason for the silence, rebuild the connection
		// rather than sitting on numbers that may be hours old.
		const watchdog = setInterval(() => {
			if (cancelled || Date.now() - lastSeen < STALE_MS) return;
			setConnection("offline");
			connect();
		}, CHECK_MS);

		// A tablet that has been asleep wakes with a dead socket and no error; check
		// the moment the screen comes back rather than waiting for the watchdog.
		const onVisible = (): void => {
			if (document.visibilityState === "visible" && Date.now() - lastSeen >= STALE_MS) connect();
		};
		document.addEventListener("visibilitychange", onVisible);

		connect();
		return () => {
			cancelled = true;
			clearInterval(watchdog);
			document.removeEventListener("visibilitychange", onVisible);
			if (timer) clearTimeout(timer);
			source?.close();
		};
	}, []);

	return { state, connection };
}
