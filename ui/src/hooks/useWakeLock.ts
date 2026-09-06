import { useEffect } from "react";

/**
 * Holds the tablet's screen on. The dashboard is meant to sit visible in a
 * living room, and Android will otherwise sleep it after a minute or two.
 *
 * The lock is dropped when the tab is hidden, so it must be re-acquired on
 * visibility change.
 */
export function useWakeLock(): void {
	useEffect(() => {
		let sentinel: WakeLockSentinel | null = null;
		let cancelled = false;

		const acquire = async (): Promise<void> => {
			if (cancelled || document.visibilityState !== "visible") return;
			try {
				sentinel = await navigator.wakeLock?.request("screen");
			} catch {
				// Unsupported browser or denied - not fatal, the screen just sleeps.
			}
		};

		void acquire();
		const onVisible = (): void => void acquire();
		document.addEventListener("visibilitychange", onVisible);

		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", onVisible);
			void sentinel?.release().catch(() => undefined);
		};
	}, []);
}
