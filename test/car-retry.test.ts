import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { carRetryDelayMs, retryLabel } from "../src/engine/car-retry.ts";

describe("car retry backoff", () => {
	it("does not delay while reads are succeeding", () => {
		// Zero failures means the caller's own schedule is in charge; the backoff
		// must not add a wait to the healthy path.
		assert.equal(carRetryDelayMs(0), 0);
		assert.equal(carRetryDelayMs(-1), 0);
	});

	it("backs off further on each consecutive failure", () => {
		const delays = [1, 2, 3, 4, 5].map(carRetryDelayMs);
		for (let i = 1; i < delays.length; i++) {
			assert.ok(delays[i]! > delays[i - 1]!, `attempt ${i + 1} should wait longer than ${i}`);
		}
	});

	it("waits long enough on the first failure for the car to free a BLE slot", () => {
		// The bug this guards: the dashboard polls every 15s, and retrying on that
		// cadence meant each attempt collided with the slot the previous one had
		// not yet released. A 90-second pause was enough to read first time by
		// hand, so the first backoff has to be comfortably longer than the poll.
		assert.ok(carRetryDelayMs(1) >= 30_000, "first retry waits at least 30s");
		assert.ok(carRetryDelayMs(1) > 15_000, "and well clear of the 15s refresh cycle");
	});

	it("caps the wait, so a car parked elsewhere still gets retried", () => {
		const capped = carRetryDelayMs(50);
		assert.ok(capped <= 10 * 60_000, "never waits more than ten minutes");
		assert.equal(capped, carRetryDelayMs(200), "stays at the cap rather than growing");
	});

	it("never returns a nonsensical delay, however many failures pile up", () => {
		for (const n of [1, 10, 100, 1000, Number.MAX_SAFE_INTEGER]) {
			const ms = carRetryDelayMs(n);
			assert.ok(Number.isFinite(ms) && ms > 0, `n=${n} gave ${ms}`);
		}
	});
});

describe("retry label", () => {
	it("reads as seconds under a minute and minutes above", () => {
		assert.equal(retryLabel(30_000), "30s");
		assert.equal(retryLabel(60_000), "1m");
		assert.equal(retryLabel(600_000), "10m");
	});
});
