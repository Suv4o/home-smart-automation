import type { Palette } from "../palette.ts";
import { CLOUDS, cloudCount, DROPS, rainAngle, rainCount, SKY, STARS, starCount } from "../weather-layout.ts";

/**
 * The weather layers.
 *
 * Everything here is positioned from the fixed pools in `weather-layout.ts`, so
 * nothing moves when the dashboard refreshes - only how *many* of each are drawn
 * changes with the conditions.
 *
 * Motion is CSS keyframes on `transform` and `opacity` only. That is the same
 * choice the flow dots make, for the same reason: it composites, where a blur
 * filter would make an old tablet stutter.
 */

/**
 * Clouds, drawn the way the bushes are - a few overlapping circles.
 *
 * Sharing that vocabulary is deliberate: a cloud built from the same shapes as
 * the foliage belongs to this scene, where a soft gradient blob would look like
 * it had been pasted on from somewhere else.
 */
export function Clouds({ p, coverPct, night }: { p: Palette; coverPct: number; night: boolean }) {
	const count = cloudCount(coverPct);
	if (count === 0) return null;

	// Night clouds are made dark, never transparent. Fading them was the obvious
	// way to stop them glowing against a black sky, but a half-transparent cloud
	// lets the stars behind it shine straight through - which is precisely the
	// thing a cloud is supposed to do something about. Dark and solid instead.
	const heavy = coverPct / 100 > 0.75;
	const fill = night ? (heavy ? "#1B2534" : "#242F40") : heavy ? "#B9BDC4" : "#DCDFE3";

	return (
		<g aria-hidden>
			{CLOUDS.slice(0, count).map((c, i) => (
				<g
					key={i}
					style={{
						animation: `cloud-drift ${c.driftS}s linear infinite`,
						animationDelay: `${c.delayS}s`,
					}}
				>
					<g transform={`translate(${c.x} ${c.y}) scale(${c.scale})`} opacity={night ? 1 : c.opacity}>
						{c.puffs.map((puff, j) => (
							<circle key={j} cx={puff.dx} cy={puff.dy} r={puff.r} fill={fill} />
						))}
						{/* A flat underside, so the cluster sits like a cloud rather than
						    floating as a clump of bubbles. */}
						<rect
							x={c.puffs[0]!.dx - 4}
							y={-1}
							width={Math.abs(c.puffs[c.puffs.length - 1]!.dx - c.puffs[0]!.dx) + 8}
							height={11}
							rx={5}
							fill={fill}
						/>
					</g>
				</g>
			))}
		</g>
	);
}

/**
 * Stars, on a clear night only, fading out as cloud builds.
 *
 * The brighter ones get a four-point sparkle rather than another circle. A field
 * of plain dots reads as specks of dust on the screen; the crossed points are
 * what actually say "star" at this size, and mixing them with small dots keeps
 * it from looking like confetti.
 */
export function Stars({ coverPct, isDay }: { coverPct: number; isDay: boolean }) {
	const count = starCount(coverPct, isDay);
	if (count === 0) return null;

	return (
		<g aria-hidden fill="#E8EEF9">
			{STARS.slice(0, count).map((s, i) => {
				const sparkle = s.r >= 2.15;
				const k = s.r * 2.4;
				return (
					<g
						key={i}
						transform={`translate(${s.x} ${s.y})`}
						style={{
							animation: `star-breathe ${s.breatheS}s ease-in-out infinite`,
							animationDelay: `${s.delayS}s`,
						}}
					>
						{sparkle ? (
							<>
								{/* Halo as a wide, faint circle - a blur filter would be the
								    obvious tool and the one thing this scene never uses. */}
								<circle r={k * 0.75} opacity={0.12} />
								<path
									d={`M0,${-k} Q${k * 0.13},${-k * 0.13} ${k},0 Q${k * 0.13},${k * 0.13} 0,${k} Q${-k * 0.13},${k * 0.13} ${-k},0 Q${-k * 0.13},${-k * 0.13} 0,${-k} Z`}
								/>
							</>
						) : (
							<circle r={s.r * 0.85} />
						)}
					</g>
				);
			})}
		</g>
	);
}

/**
 * Rain over the whole scene.
 *
 * Kept deliberately faint. It has to be visible enough to explain a low solar
 * figure, and quiet enough that the kW labels stay readable through it - those
 * are drawn after this, so they always win.
 */
export function Rain({
	icon,
	precipitationMm,
	windFromDeg,
	night,
}: {
	icon: string;
	precipitationMm: number;
	windFromDeg: number | null;
	night: boolean;
}) {
	const count = rainCount(icon, precipitationMm);
	if (count === 0) return null;
	const angle = rainAngle(windFromDeg);

	return (
		<g aria-hidden transform={`rotate(${angle} 0 0)`} stroke={night ? "#8FA6C4" : "#7C93AE"} strokeLinecap="round">
			{DROPS.slice(0, count).map((d, i) => (
				<line
					key={i}
					x1={d.x}
					y1={d.y}
					x2={d.x}
					y2={d.y + d.len}
					strokeWidth={1.7}
					opacity={d.opacity}
					style={{
						animation: `rain-fall ${d.fallS}s linear infinite`,
						animationDelay: `${d.delayS}s`,
					}}
				/>
			))}
		</g>
	);
}

/** Fog: low bands across the scene, drifting almost imperceptibly. */
export function Fog({ p, active }: { p: Palette; active: boolean }) {
	if (!active) return null;
	const bands = [
		{ y: -70, h: 26, o: 0.3, s: 150 },
		{ y: -20, h: 34, o: 0.38, s: 120 },
		{ y: 40, h: 30, o: 0.3, s: 170 },
	];
	return (
		<g aria-hidden>
			{bands.map((b, i) => (
				<rect
					key={i}
					x={SKY.left - 60}
					y={b.y}
					width={640}
					height={b.h}
					rx={b.h / 2}
					fill={p.page}
					opacity={b.o}
					style={{
						animation: `fog-drift ${b.s}s ease-in-out infinite alternate`,
						animationDelay: `${-i * 20}s`,
					}}
				/>
			))}
		</g>
	);
}
