import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dashed, toneColor } from "./tone.ts";
import { dotCount, polylineLength, roundedPath } from "./geometry.ts";
import { box, iso } from "./iso.ts";
import { project, ROUTES } from "./layout.ts";
import { DAY, DUSK, mixColor, mixPalette, NIGHT, skyPalette } from "./palette.ts";

/** Screen y-coordinates out of SVG path data, for comparing face heights. */
function ys(d: string): number[] {
	return [...d.matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

describe("iso projection", () => {
	it("puts the world origin at the screen origin", () => {
		assert.deepEqual(iso(0, 0, 0), { x: 0, y: 0 });
	});

	it("keeps vertical edges vertical on screen", () => {
		// Same x/z, different height: screen x must not move.
		const a = iso(5, 0, 3);
		const b = iso(5, 10, 3);
		assert.equal(a.x, b.x);
		assert.ok(b.y < a.y, "greater height must be higher on screen");
	});

	it("sends +x right and +z left", () => {
		assert.ok(iso(10, 0, 0).x > 0, "+x is to the right");
		assert.ok(iso(0, 0, 10).x < 0, "+z is to the left");
	});

	it("pushes both ground axes down the screen", () => {
		assert.ok(iso(10, 0, 0).y > 0);
		assert.ok(iso(0, 0, 10).y > 0);
	});
});

describe("box", () => {
	const faces = box({ x: 0, y: 0, z: 0 }, 10, 6, 8);

	it("emits three closed faces", () => {
		for (const [name, d] of Object.entries(faces)) {
			assert.ok(d.startsWith("M"), `${name} should start with a moveto`);
			assert.ok(d.endsWith("Z"), `${name} should be closed`);
			assert.equal(d.split("L").length, 4, `${name} should have 4 corners`);
		}
	});

	it("draws the top face above the side faces", () => {
		const topY = ys(faces.top);
		const leftY = ys(faces.left);
		assert.ok(Math.min(...topY) < Math.min(...leftY), "top must sit higher on screen");
	});
});

describe("roundedPath", () => {
	it("handles degenerate inputs", () => {
		assert.equal(roundedPath([]), "");
		assert.equal(roundedPath([{ x: 1, y: 2 }]), "M1,2");
		assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), "M0,0 L10,0");
	});

	it("bridges a corner with a quadratic through it", () => {
		const d = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 20);
		assert.match(d, /^M0,0/);
		assert.match(d, /Q100,0/, "the curve's control point is the original corner");
		assert.match(d, /L100,100$/);
	});

	it("clamps the corner radius to half the shortest segment", () => {
		// Segments are only 10 long, so a radius of 50 must not overshoot.
		const d = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 50);
		const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?),/g)].map((m) => Number(m[1]));
		assert.ok(Math.max(...xs) <= 10.001, "must never run past the corner");
		assert.ok(Math.min(...xs) >= -0.001, "must never run before the start");
	});

	it("survives repeated points without producing NaN", () => {
		const d = roundedPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }], 12);
		assert.ok(!d.includes("NaN"), d);
	});
});

describe("polylineLength", () => {
	it("sums the segments", () => {
		assert.equal(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 14 }]), 15);
	});
});

describe("palette mixing", () => {
	it("returns each end exactly", () => {
		assert.equal(mixColor("#000000", "#ffffff", 0), "#000000");
		assert.equal(mixColor("#000000", "#ffffff", 1), "#ffffff");
	});

	it("blends the midpoint", () => {
		assert.equal(mixColor("#000000", "#ffffff", 0.5), "#808080");
	});

	it("clamps out-of-range t", () => {
		assert.equal(mixColor("#000000", "#ffffff", -3), "#000000");
		assert.equal(mixColor("#000000", "#ffffff", 9), "#ffffff");
	});

	it("keeps rgba() colours usable", () => {
		const out = mixColor("rgba(0,0,0,0.4)", "rgba(255,255,255,0.8)", 0.5);
		assert.match(out, /^rgba\(128,128,128,0\.6\)$/);
	});

	it("mixes every key, and the ends are the source palettes", () => {
		assert.deepEqual(mixPalette(NIGHT, DAY, 1), DAY);
		assert.deepEqual(mixPalette(NIGHT, DAY, 0), NIGHT);
		const dusk = mixPalette(NIGHT, DAY, 0.5);
		assert.equal(Object.keys(dusk).length, Object.keys(DAY).length);
		assert.ok(!Object.values(dusk).some((v) => v.includes("NaN")), "no NaN in blended output");
	});
});

/**
 * The measured CVD separation between the green and amber wires is ΔE 4.7 - well
 * under the floor of 8 - and no re-stepping fixes it, because red/green
 * confusion is exactly what these hues collide on. The palette is therefore only
 * legitimate while a non-colour channel carries the same meaning, so that channel
 * is locked here: solid means energy that costs nothing, dashed means metered or
 * halted. Deleting the dash silently makes the scene unreadable for a deuteranope.
 */
describe("flow encoding is not colour-alone", () => {
	it("dashes exactly the metered and blocked tones", () => {
		assert.equal(dashed("warning"), true, "grid import is metered");
		assert.equal(dashed("critical"), true, "a blocked charge is halted");
		assert.equal(dashed("good"), false, "free energy is solid");
		assert.equal(dashed("battery"), false, "stored energy is solid");
	});

	it("separates import from export on the grid wire without hue", () => {
		// The same wire carries both directions, so this pair is the one a
		// colour-blind viewer most needs to tell apart.
		assert.notEqual(dashed("warning"), dashed("good"));
	});

	it("steps tones per surface rather than reusing one set", () => {
		for (const tone of ["good", "warning", "battery", "critical"] as const) {
			assert.notEqual(
				toneColor(DAY, tone, "#000"),
				toneColor(NIGHT, tone, "#000"),
				`${tone} must be re-stepped for the dark surface`,
			);
		}
		assert.equal(toneColor(DAY, "idle", "#123456"), "#123456");
	});
});

/**
 * Cream and navy average to grey, so a straight day-to-night lerp makes every
 * twilight look washed out. The blend goes through a chosen twilight instead,
 * and these pin the shape of that curve.
 */
describe("twilight is chosen, not averaged", () => {
	it("keeps the endpoints exact", () => {
		assert.deepEqual(skyPalette(1), DAY);
		assert.deepEqual(skyPalette(0), NIGHT);
	});

	it("passes through the dusk palette at half daylight", () => {
		assert.deepEqual(skyPalette(0.5), DUSK);
	});

	it("never lands on the day/night average mid-way", () => {
		const averaged = mixPalette(NIGHT, DAY, 0.5);
		assert.notEqual(skyPalette(0.5).page, averaged.page);
	});

	it("gives dusk the same keys as the other two", () => {
		assert.deepEqual(Object.keys(DUSK).sort(), Object.keys(DAY).sort());
		assert.deepEqual(Object.keys(DUSK).sort(), Object.keys(NIGHT).sort());
	});
});

/**
 * Dots are spaced by distance, not counted per wire. The battery run is roughly
 * a third the length of the others, so a fixed three sat on top of one another
 * and the short wire looked frantic next to the long ones.
 */
describe("dot density follows wire length", () => {
	it("gives the short battery run a single dot", () => {
		assert.equal(dotCount(polylineLength(project(ROUTES.junctionToBattery))), 1);
	});

	it("leaves the long runs with the full three", () => {
		for (const route of ["solarToJunction", "gridToJunction", "junctionToCar"] as const) {
			assert.equal(dotCount(polylineLength(project(ROUTES[route]))), 3, route);
		}
	});

	it("never drops to zero, and never exceeds three", () => {
		assert.equal(dotCount(0), 1);
		assert.equal(dotCount(1), 1);
		assert.equal(dotCount(10_000), 3);
	});
});

/**
 * A live plug with no cable in the car is the case the dashboard used to get
 * wrong, so the "waiting" tone is pinned: visible, distinct from a dead wire,
 * and never animated - nothing is flowing through it.
 */
describe("waiting wire", () => {
	it("is dashed, like everything that isn't free-flowing energy", () => {
		assert.equal(dashed("waiting"), true);
	});

	it("uses a tone distinct from both a live charge and a dead wire", () => {
		const live = toneColor(DAY, "good", DAY.muted);
		const dead = DAY.muted;
		const waiting = toneColor(DAY, "waiting", DAY.muted);
		assert.notEqual(waiting, live, "must not look like a charge in progress");
		assert.notEqual(waiting, dead, "must not look like a dormant wire");
	});

	it("keeps that separation on the dark surface too", () => {
		assert.notEqual(toneColor(NIGHT, "waiting", NIGHT.muted), NIGHT.muted);
		assert.notEqual(toneColor(NIGHT, "waiting", NIGHT.muted), toneColor(NIGHT, "good", NIGHT.muted));
	});
});
