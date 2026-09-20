import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	clampHours,
	HALF_VH,
	HANDLE_PX,
	HOURS_DEFAULT,
	hoursLabel,
	handleTotal,
	nextStage,
	PANEL_VH,
	panelHeight,
	panelOffset,
	scrollerMaxHeight,
	type Stage,
	swipeDirection,
	visibleHeight,
} from "./sheet.ts";

/** What iOS reserves for the home indicator; 0px everywhere else. */
const SAFE = "env(safe-area-inset-bottom, 0px)";

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
		assert.equal(panelOffset("half"), `calc(${PANEL_VH - HALF_VH} * var(--vh-unit))`);
		assert.equal(panelOffset("closed"), `calc(${PANEL_VH} * var(--vh-unit) - ${HANDLE_PX}px - ${SAFE})`);
	});

	it("measures in a unit that follows the visible viewport", () => {
		// Never a bare `vh`: on a phone that is a percent of the viewport with the
		// URL bar hidden, so the bottom of the panel ends up underneath it.
		for (const css of [panelHeight(), panelOffset("half"), panelOffset("closed"), scrollerMaxHeight("full")]) {
			assert.match(css, /var\(--vh-unit\)/, css);
			assert.doesNotMatch(css, /\d+vh\b/, css);
		}
	});

	it("scrolls the part of the panel you can see, not the part you cannot", () => {
		// The regression this guards: the panel is always PANEL_VH tall, but at the
		// half stage only HALF_VH of it is on screen. Sizing the scroll area to the
		// panel made it believe its content fitted - no overflow, nothing to drag -
		// while the bottom of it hung below the viewport, unreachable.
		assert.equal(scrollerMaxHeight("half"), `calc(${HALF_VH} * var(--vh-unit) - ${HANDLE_PX}px - ${SAFE})`);
		assert.equal(scrollerMaxHeight("full"), `calc(${PANEL_VH} * var(--vh-unit) - ${HANDLE_PX}px - ${SAFE})`);
		assert.notEqual(scrollerMaxHeight("half"), scrollerMaxHeight("full"));
	});

	it("reports only the handle as visible when closed", () => {
		assert.equal(visibleHeight("closed"), handleTotal());
		assert.equal(visibleHeight("half"), `calc(${HALF_VH} * var(--vh-unit))`);
		assert.equal(visibleHeight("full"), `calc(${PANEL_VH} * var(--vh-unit))`);
	});

	it("leaves exactly the handle visible when closed", () => {
		assert.ok(HANDLE_PX > 0 && HANDLE_PX < 96, "handle stays a slim strip");
		assert.ok(HALF_VH < PANEL_VH, "the peek is shorter than the full panel");
	});
});

describe("safe areas", () => {
	it("reserves the home indicator under the grab handle", () => {
		// The symptom without this: on an installed iOS app the page runs edge to
		// edge, so the 52px strip has the indicator sitting in its lower half and
		// the chevron looks like it is hovering over a gap.
		assert.equal(handleTotal(), `calc(${HANDLE_PX}px + ${SAFE})`);
		assert.match(handleTotal(), /env\(safe-area-inset-bottom/);
	});

	it("subtracts it everywhere the handle is subtracted", () => {
		// Miss one of these and the sheet and the space reserved for it disagree
		// by the height of the indicator.
		for (const css of [panelOffset("closed"), scrollerMaxHeight("half"), scrollerMaxHeight("full")]) {
			assert.match(css, /env\(safe-area-inset-bottom/, css);
		}
	});

	it("falls back to zero, so nothing changes off iOS", () => {
		// Android, the kiosk tablet and desktop all report no inset; the fallback
		// keeps the expression valid there rather than dropping the declaration.
		assert.match(handleTotal(), /,\s*0px\)/);
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
			assert.ok(visibleHeight(s).length > 0, s);
			assert.ok(scrollerMaxHeight(s).length > 0, s);
		}
	});
});
