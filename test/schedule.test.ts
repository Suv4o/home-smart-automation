import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isActive, isExpired, isPending, type Override } from "../src/engine/override.ts";
import { melbourneClock, nextOccurrenceMs } from "../src/time.ts";

const HOUR = 3_600_000;
const at = (o: Partial<Override>): Override =>
	({ mode: "force_on", setAt: Date.now(), until: Date.now() + HOUR, ...o }) as Override;

/**
 * A scheduled override is stored and displayed from the moment it is set, but
 * must not touch the plug until its start time. Getting this wrong would mean
 * "charge at 10pm" started charging immediately.
 */
describe("override scheduling", () => {
	const now = 1_000_000_000_000;

	it("treats an override with no start time as running now", () => {
		const o = at({ from: undefined, until: now + HOUR });
		assert.equal(isPending(o, now), false);
		assert.equal(isActive(o, now), true);
	});

	it("holds a future one back", () => {
		const o = at({ from: now + 3 * HOUR, until: now + 8 * HOUR });
		assert.equal(isPending(o, now), true);
		assert.equal(isActive(o, now), false, "must not drive the plug yet");
	});

	it("starts it once the time arrives", () => {
		const o = at({ from: now, until: now + 5 * HOUR });
		assert.equal(isPending(o, now), false);
		assert.equal(isActive(o, now), true);
	});

	it("still expires a scheduled one that has run its course", () => {
		const o = at({ from: now - 5 * HOUR, until: now - HOUR });
		assert.equal(isExpired(o, now), true);
		assert.equal(isActive(o, now), false);
	});

	it("never counts an expired override as merely pending", () => {
		// Both windows in the past: it is finished, not waiting to begin.
		const o = at({ from: now - 9 * HOUR, until: now - HOUR });
		assert.equal(isPending(o, now), false);
	});
});

describe("nextOccurrenceMs", () => {
	it("rejects anything that isn't a time of day", () => {
		// A malformed value must not schedule something for the epoch.
		for (const bad of ["25:00", "12:60", "abc", "", "7:5", "-1:00"]) {
			assert.equal(nextOccurrenceMs(bad), null, bad);
		}
	});

	it("accepts a valid time and lands within the next 24 hours", () => {
		const now = new Date();
		for (const t of ["00:00", "09:30", "22:00", "23:59"]) {
			const ms = nextOccurrenceMs(t, now);
			assert.ok(ms !== null, t);
			const deltaMin = (ms - now.getTime()) / 60_000;
			assert.ok(deltaMin >= 0 && deltaMin <= 24 * 60, `${t} landed ${deltaMin} minutes away`);
		}
	});

	it("resolves to the requested wall-clock time in the policy's zone", () => {
		const now = new Date();
		const ms = nextOccurrenceMs("22:00", now);
		assert.ok(ms !== null);
		const then = melbourneClock(new Date(ms));
		assert.equal(then.hour, 22);
		assert.equal(then.minute, 0);
	});

	it("means tomorrow when the time has already passed today", () => {
		const now = new Date();
		const c = melbourneClock(now);
		// One minute ago, in Melbourne terms.
		const past = (c.minutesOfDay + 24 * 60 - 1) % (24 * 60);
		const hhmm = `${String(Math.floor(past / 60)).padStart(2, "0")}:${String(past % 60).padStart(2, "0")}`;
		const ms = nextOccurrenceMs(hhmm, now);
		assert.ok(ms !== null);
		assert.ok(ms - now.getTime() > 23 * HOUR, "should be nearly a day away, not in the past");
	});
});
