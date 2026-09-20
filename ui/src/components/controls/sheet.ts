/**
 * Geometry and state for the bottom control sheet.
 *
 * Kept free of JSX so it can be unit-tested - Node's type-stripping runs `.ts`
 * but not `.tsx`.
 */

/** closed shows only the handle; half is a peek; full is the whole panel. */
export type Stage = "closed" | "half" | "full";

/** Panel height, and the two heights it rests at, as viewport percentages. */
export const PANEL_VH = 92;
export const HALF_VH = 52;
/** Visible height of the grab handle when closed. */
export const HANDLE_PX = 52;

/**
 * One viewport percent - as `dvh` where the browser has it, `vh` where it hasn't.
 *
 * This matters only on phones, and it matters a lot there. `vh` is a percent of
 * the *largest* viewport, the one you get with the URL bar hidden, so while the
 * bar is showing `92vh` is taller than the screen and the bottom of the panel
 * sits underneath it. `dvh` tracks the viewport that is actually on display.
 *
 * The indirection through a custom property (declared in index.css behind an
 * `@supports`) is what keeps the old kiosk tablet working: an unsupported unit
 * makes the whole declaration invalid and would collapse the panel to auto
 * height, so the fallback has to happen in CSS rather than here.
 */
const VH = "var(--vh-unit)";

/**
 * What iOS reserves at the bottom of the screen for the home indicator.
 *
 * Zero on every other device, so this costs nothing anywhere else. It is only
 * ever non-zero because index.html asks for `viewport-fit=cover` and a
 * translucent status bar, which run the page edge to edge and hand the job of
 * avoiding the reserved strips to us.
 */
const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";

/**
 * The full height of the closed sheet: the tappable strip, plus the band under
 * it that the home indicator sits in.
 *
 * Without the second term the strip is 52px of which iOS spends the lower half
 * on its own indicator, so the chevron is pushed into it and the sheet looks
 * like it is floating above a gap.
 */
export function handleTotal(): string {
	return `calc(${HANDLE_PX}px + ${SAFE_BOTTOM})`;
}

/** The panel's own height. Constant across stages; only the offset moves. */
export function panelHeight(): string {
	return `calc(${PANEL_VH} * ${VH})`;
}

/**
 * How much of the panel is on screen at each stage.
 *
 * The panel is always laid out at its full height and slid down with a
 * transform, so this is *not* the same as its height - and the difference is
 * what the scroll area below has to be told about.
 */
export function visibleHeight(stage: Stage): string {
	if (stage === "full") return `calc(${PANEL_VH} * ${VH})`;
	if (stage === "half") return `calc(${HALF_VH} * ${VH})`;
	return handleTotal();
}

/**
 * The height the scrolling content area is allowed to occupy.
 *
 * Sizing it from the panel is the bug this exists to prevent. At the half stage
 * the panel is 92vh tall but only 52vh of it is on screen, so a content area
 * sized to the panel believes everything fits - `scrollHeight === clientHeight`,
 * no scrollbar, nothing to drag - while its bottom third hangs below the
 * viewport, permanently out of reach. Clamping to what is visible makes the
 * overflow real, and therefore scrollable.
 *
 * `closed` deliberately returns the half-stage height rather than zero: the
 * panel is off-screen anyway, and keeping the content laid out at the size it
 * will open to avoids a reflow on the way up.
 */
export function scrollerMaxHeight(stage: Stage): string {
	const vh = stage === "full" ? PANEL_VH : HALF_VH;
	return `calc(${vh} * ${VH} - ${HANDLE_PX}px - ${SAFE_BOTTOM})`;
}

/**
 * Where a swipe or tap takes the sheet next.
 *
 * Deliberately a two-step ladder rather than a toggle: one gesture peeks at the
 * controls, a second commits to the full panel, and coming back down retraces
 * the same steps.
 */
export function nextStage(stage: Stage, dir: "up" | "down"): Stage {
	if (dir === "up") return stage === "closed" ? "half" : "full";
	return stage === "full" ? "half" : "closed";
}

/**
 * How far to push the panel down its own height, as a CSS length.
 *
 * The panel is always laid out at its full height and moved with `transform`,
 * so opening it is a composited slide rather than an animated `height` - the old
 * tablet cannot repaint a growing box smoothly, and animating height would also
 * reflow the illustration above it.
 */
export function panelOffset(stage: Stage): string {
	if (stage === "full") return "0px";
	if (stage === "half") return `calc(${PANEL_VH - HALF_VH} * ${VH})`;
	return `calc(${PANEL_VH} * ${VH} - ${HANDLE_PX}px - ${SAFE_BOTTOM})`;
}

/** A vertical drag becomes a direction only once it clears the threshold. */
export function swipeDirection(dy: number, threshold = 36): "up" | "down" | null {
	if (dy <= -threshold) return "up";
	if (dy >= threshold) return "down";
	return null;
}

/** Matches the server's own clamp in POST /api/override. */
export const HOURS_MIN = 1;
export const HOURS_MAX = 12;
export const HOURS_DEFAULT = 2;

export function clampHours(hours: number): number {
	if (!Number.isFinite(hours)) return HOURS_DEFAULT;
	return Math.min(HOURS_MAX, Math.max(HOURS_MIN, Math.round(hours)));
}

export function hoursLabel(hours: number): string {
	const h = clampHours(hours);
	return h === 1 ? "1 hour" : `${h} hours`;
}
