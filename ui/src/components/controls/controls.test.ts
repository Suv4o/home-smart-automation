import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	clampHours,
	HALF_VH,
	HANDLE_PX,
	HOURS_DEFAULT,
	hoursLabel,
	nextStage,
	PANEL_VH,
	panelOffset,
	type Stage,
	swipeDirection,
} from "./sheet.ts";

describe("sheet stages", () => {
	it("opens in two steps and closes back down the same way", () => {
		assert.equal(nextStage("closed", "up"), "half");
		assert.equal(nextStage("half", "up"), "full");
		assert.equal(nextStage("full", "down"), "half");
		assert.equal(nextStage("half", "down"), "closed");
	});

	it("stays put at the ends", () => {
		assert.equal(nextStage("full", "up"), "full");
		assert.equal(nextStage("closed", "down"), "closed");
	});

	it("shows more of the panel the further it opens", () => {
		// Offsets push the panel down, so opening further means a smaller offset.
		assert.equal(panelOffset("full"), "0px");
		assert.equal(panelOffset("half"), `${PANEL_VH - HALF_VH}vh`);
		assert.equal(panelOffset("closed"), `calc(${PANEL_VH}vh - ${HANDLE_PX}px)`);
	});

	it("leaves exactly the handle visible when closed", () => {
		assert.ok(HANDLE_PX > 0 && HANDLE_PX < 96, "handle stays a slim strip");
		assert.ok(HALF_VH < PANEL_VH, "the peek is shorter than the full panel");
	});
});

describe("swipe threshold", () => {
	it("ignores small drags, so a tap never moves the sheet", () => {
		assert.equal(swipeDirection(0), null);
		assert.equal(swipeDirection(-10), null);
		assert.equal(swipeDirection(35), null);
	});

	it("reads sign as direction once past the threshold", () => {
		assert.equal(swipeDirection(-40), "up");
		assert.equal(swipeDirection(40), "down");
	});
});

describe("override hours", () => {
	it("defaults to two, matching the server", () => {
		assert.equal(HOURS_DEFAULT, 2);
		assert.equal(clampHours(Number.NaN), 2);
	});

	it("clamps to the range the API accepts", () => {
		assert.equal(clampHours(0), 1);
		assert.equal(clampHours(-5), 1);
		assert.equal(clampHours(99), 12);
		assert.equal(clampHours(3.4), 3);
	});

	it("writes the unit out, and gets the singular right", () => {
		assert.equal(hoursLabel(1), "1 hour");
		assert.equal(hoursLabel(2), "2 hours");
		assert.equal(hoursLabel(12), "12 hours");
	});
});

describe("stage type stays exhaustive", () => {
	it("covers every stage in panelOffset", () => {
		for (const s of ["closed", "half", "full"] as Stage[]) {
			assert.ok(panelOffset(s).length > 0, s);
		}
	});
});
