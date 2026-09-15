import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CLOUDS,
	cloudCount,
	DROPS,
	MAX_CLOUDS,
	MAX_DROPS,
	rainAngle,
	rainCount,
	STARS,
	starCount,
} from "./weather-layout.ts";

/**
 * The scene re-renders every fifteen seconds as readings arrive. If any of this
 * were positioned randomly at render time the sky would twitch four times a
 * minute, which is far worse than having no weather at all.
 */
describe("the sky never twitches", () => {
	it("hands back the identical layout on every read", async () => {
		const first = JSON.stringify(CLOUDS);
		// Whatever a re-render does, it reads the same frozen pool.
		const again = await import("./weather-layout.ts");
		assert.equal(JSON.stringify(again.CLOUDS), first);
		assert.equal(JSON.stringify(again.STARS), JSON.stringify(STARS));
		assert.equal(JSON.stringify(again.DROPS), JSON.stringify(DROPS));
	});

	it("adds clouds as cover rises without moving the ones already there", () => {
		// The important one. Going from light to heavy cover must extend the sky,
		// not rearrange it - otherwise every passing cloud front reshuffles
		// everything on screen.
		const light = CLOUDS.slice(0, cloudCount(20));
		const heavy = CLOUDS.slice(0, cloudCount(95));
		assert.ok(heavy.length > light.length, "heavier cover should mean more cloud");
		assert.deepEqual(heavy.slice(0, light.length), light);
	});

	it("fades stars out the same way", () => {
		const clear = STARS.slice(0, starCount(0, false));
		const hazy = STARS.slice(0, starCount(40, false));
		assert.deepEqual(clear.slice(0, hazy.length), hazy);
	});
});

describe("how much weather each condition earns", () => {
	it("leaves a clear sky genuinely empty", () => {
		// 2% cover is clear, not "a bit of one cloud".
		assert.equal(cloudCount(0), 0);
		assert.equal(cloudCount(9), 0);
		assert.equal(cloudCount(10), 1);
	});

	it("builds to a bank, and stops there", () => {
		assert.equal(cloudCount(100), MAX_CLOUDS);
		assert.equal(cloudCount(1000), MAX_CLOUDS, "nonsense input must not blow the budget");
		assert.equal(cloudCount(-5), 0);
	});

	it("rises without ever going backwards", () => {
		let previous = -1;
		for (let c = 0; c <= 100; c++) {
			const n = cloudCount(c);
			assert.ok(n >= previous, `cover ${c}% dropped the cloud count`);
			previous = n;
		}
	});

	it("shows stars only on a clear night", () => {
		assert.equal(starCount(0, true), 0, "never in daylight");
		assert.ok(starCount(0, false) > 0);
		assert.equal(starCount(60, false), 0, "not through heavy cloud");
	});

	it("scales rain with the condition, capped", () => {
		assert.equal(rainCount("sun"), 0);
		assert.equal(rainCount("cloud"), 0);
		assert.ok(rainCount("drizzle") < rainCount("rain"));
		assert.equal(rainCount("rain", 5), MAX_DROPS);
		assert.equal(rainCount("storm"), MAX_DROPS);
	});

	it("never draws more than the element budget allows", () => {
		// The tablet is old; the heaviest sky has to stay affordable.
		assert.ok(MAX_CLOUDS <= 6);
		assert.ok(MAX_DROPS <= 40);
		const worstCasePuffs = CLOUDS.reduce((n, c) => n + c.puffs.length, 0);
		assert.ok(worstCasePuffs + MAX_DROPS < 100, `weather layer too heavy: ${worstCasePuffs + MAX_DROPS}`);
	});
});

describe("rain leans with the wind", () => {
	it("falls near-vertical when the wind is unknown", () => {
		assert.equal(rainAngle(null), 8);
		assert.equal(rainAngle(Number.NaN), 8);
	});

	it("leans opposite ways for opposite winds", () => {
		assert.ok(rainAngle(90) < 0);
		assert.ok(rainAngle(270) > 0);
	});

	it("never lays the rain flat, however hard it blows", () => {
		// Past a lean it stops reading as rain and starts reading as a glitch.
		for (let d = 0; d < 360; d += 5) {
			assert.ok(Math.abs(rainAngle(d)) <= 22, `${d}° produced ${rainAngle(d)}°`);
		}
	});
});
