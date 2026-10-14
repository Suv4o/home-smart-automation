/**
 * How long to wait before trying the car again after a failed Bluetooth read.
 *
 * This exists because retrying hard made the failure worse rather than better.
 *
 * A Tesla accepts only a handful of simultaneous BLE connections and is slow to
 * release them. The dashboard refreshes every 15 seconds, and while the car was
 * charging a failed read left the cache untouched - so the "due for a read"
 * condition stayed true and the next refresh tried again immediately. Each
 * attempt claimed a slot the car had not yet freed from the previous one, and
 * the car answered every single one with "already connected to the maximum
 * number of BLE devices". 139 attempts over 45 minutes, none of which could
 * have succeeded, because the thing blocking them was the attempt before.
 *
 * Proven by stopping the daemon for 90 seconds and reading once by hand: it
 * worked first time, with nothing else changed.
 *
 * So the delay grows with each consecutive failure, giving the radio room to
 * clear. The cap keeps a car that is genuinely out of range - parked elsewhere
 * for the day - from drifting into retrying once an hour, while still costing
 * only a few attempts over that time.
 */

/** First retry waits this long; each further failure doubles it. */
const BASE_MS = 30_000;
/** Never wait longer than this between attempts. */
const MAX_MS = 10 * 60_000;

/**
 * Delay before the next attempt, given how many have failed in a row.
 *
 * `0` means no failures and therefore no delay - the normal path, where the
 * caller's own schedule decides when to read.
 */
export function carRetryDelayMs(consecutiveFailures: number): number {
	if (consecutiveFailures <= 0) return 0;
	const doublings = Math.min(consecutiveFailures - 1, 20); // guard against overflow
	return Math.min(BASE_MS * 2 ** doublings, MAX_MS);
}

/** Human-readable form of a delay, for the message shown on the dashboard. */
export function retryLabel(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	return `${Math.round(ms / 60_000)}m`;
}
