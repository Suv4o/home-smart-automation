import type { Palette } from "./palette.ts";

/**
 * `waiting` is the plug being live with nothing drawing from it - the cable
 * isn't in the car. It is not a flow, so it never animates; it just has to look
 * different from a dead wire.
 */
export type FlowTone = "good" | "warning" | "battery" | "critical" | "waiting" | "idle";

/**
 * Tone colours come from the palette, because the day and night surfaces need
 * different steps: the amber that reads on deep navy is far too light to be seen
 * on cream. Both sets are contrast-checked against their own surface.
 */
export function toneColor(p: Palette, tone: FlowTone, idle: string): string {
	switch (tone) {
		case "good":
			return p.flowGood;
		case "warning":
			return p.flowWarning;
		case "battery":
			return p.flowBattery;
		case "critical":
			return p.flowCritical;
		case "waiting":
			// A text tone, so it is legible on either surface by construction.
			return p.inkDim;
		default:
			return idle;
	}
}

/**
 * Whether the wire is drawn dashed, and this is a real signal rather than
 * decoration.
 *
 * Green, amber and red are close to indistinguishable under the common forms of
 * colour blindness - measured, the green/amber pair separates by ΔE 4.7 for a
 * protanope, where 8 is the floor, and green/red by 0.9 for a deuteranope. No
 * re-stepping fixes that; those hues collide by definition. So hue is never left
 * to carry the meaning on its own: **solid is energy that costs nothing** (solar,
 * battery, a charge in progress) and **dashed is metered or halted** (grid
 * import, a blocked charge). With the kW label on every live wire, the state
 * survives with no colour perception at all.
 */
export function dashed(tone: FlowTone): boolean {
	return tone === "warning" || tone === "critical" || tone === "waiting";
}
