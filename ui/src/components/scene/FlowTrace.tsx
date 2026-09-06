import { dotCount, polylineLength, roundedPath } from "./geometry.ts";
import type { Pt } from "./iso.ts";
import type { Palette } from "./palette.ts";
import { dashed, type FlowTone, toneColor } from "./tone.ts";

export { dashed, toneColor };
export type { FlowTone };

interface Props {
	id: string;
	/** Screen points, written in the direction energy travels when positive. */
	points: Pt[];
	watts: number;
	tone: FlowTone;
	/** false plays the dots the other way along the same path. */
	forward?: boolean;
	p: Palette;
}

/** Below this a wire is drawn as dormant: visible topology, no motion. */
const ACTIVE_W = 50;
/**
 * One energy wire: a dormant base trace, an active glow, travelling dots and an
 * arrowhead.
 *
 * The dots ride the path with CSS `offset-path`, which the compositor handles -
 * cheaper than SMIL and much cheaper than animating a blur. "Glow" is two
 * stacked strokes rather than a filter, for the same reason: filters are what
 * would make this stutter on an old tablet.
 */
export function FlowTrace({ id, points, watts, tone, forward = true, p }: Props) {
	// "waiting" is drawn, but never animated: the socket is live and nothing is
	// moving through it, so dots and an arrowhead would be a lie.
	const waiting = tone === "waiting";
	const active = !waiting && Math.abs(watts) >= ACTIVE_W && tone !== "idle";
	const ordered = forward ? points : [...points].reverse();
	const d = roundedPath(ordered, 14);
	const colour = active || waiting ? toneColor(p, tone, p.muted) : p.muted;
	const dash = (active && dashed(tone)) || waiting ? "13 9" : undefined;

	// ~3kW moves briskly; small flows crawl; nothing ever strobes.
	const duration = active ? Math.min(6, Math.max(1.6, 6000 / Math.abs(watts))) : 0;
	const dots = dotCount(polylineLength(ordered));

	return (
		<g>
			<path d={d} fill="none" stroke={p.page} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
			<path
				d={d}
				fill="none"
				stroke={colour}
				strokeWidth={active ? 3 : waiting ? 2.5 : 2}
				strokeDasharray={dash}
				strokeLinecap="round"
				strokeLinejoin="round"
				opacity={active ? 0.62 : waiting ? 0.8 : 0.3}
				markerEnd={active ? `url(#arrow-${id})` : undefined}
			/>

			{active && (
				<>
					{/* soft halo, then the crisp core - two strokes, no blur filter */}
					<path d={d} fill="none" stroke={colour} strokeWidth={9} strokeDasharray={dash} strokeLinecap="round" opacity={0.12} />
					<defs>
						<marker id={`arrow-${id}`} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
							<path d="M0,1 L9,5 L0,9 z" fill={colour} />
						</marker>
					</defs>

					{Array.from({ length: dots }, (_, i) => (
						<circle
							key={i}
							r={4.5}
							fill={colour}
							style={{
								offsetPath: `path("${d}")`,
								offsetRotate: "0deg",
								animation: `trace-run ${duration}s linear infinite`,
								animationDelay: `${(duration / dots) * i}s`,
							}}
						/>
					))}
					{/* Source node. It sits at the *start* deliberately: parked on the
					    end it covered the arrowhead, which is why the wire into the car
					    looked like it had no direction at all. */}
					<circle cx={ordered[0]!.x} cy={ordered[0]!.y} r={5} fill={colour}>
						<animate attributeName="opacity" values="0.45;1;0.45" dur="2.4s" repeatCount="indefinite" />
					</circle>
				</>
			)}
		</g>
	);
}
