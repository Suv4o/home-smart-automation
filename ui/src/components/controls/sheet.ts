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
	if (stage === "half") return `${PANEL_VH - HALF_VH}vh`;
	return `calc(${PANEL_VH}vh - ${HANDLE_PX}px)`;
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
