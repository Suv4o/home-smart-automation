import { anchor } from "../iso.ts";
import { CAR } from "../layout.ts";
import type { Palette } from "../palette.ts";

/**
 * The car, drawn in the scene's 3/4 view. Deliberately simple silhouette work -
 * a fastback roofline and short overhangs read as a Model Y without pretending
 * to be a rendering.
 */
export function TeslaCar({ p, soc, charging }: { p: Palette; soc: number | null; charging: boolean }) {
	const base = anchor({ x: CAR.x, y: CAR.y, z: CAR.z });
	const ring = 2 * Math.PI * 15;
	const pct = soc === null ? 0 : Math.max(0, Math.min(100, soc)) / 100;

	return (
		<g transform={`translate(${base.x} ${base.y})`}>
			<ellipse cx={0} cy={15} rx={58} ry={7} fill={p.shadow} />

			{/* Body. Drawn as a true side profile at roughly 2:1 length to height -
			    the previous outline was squat enough to read as a squashed hatchback. */}
			<path
				d="M-54,-3 C-54,-12 -48,-17 -39,-19 L-26,-21 C-19,-35 -6,-41 7,-41 L16,-41
				   C30,-40 42,-32 48,-22 C52,-17 54,-10 54,-3 L54,4 C54,8 51,10 47,10
				   L-47,10 C-51,10 -54,8 -54,4 Z"
				fill={p.car}
			/>
			{/* shaded rocker gives the flank some roundness */}
			<path d="M-54,1 C-30,7 30,7 54,1 L54,4 C54,8 51,10 47,10 L-47,10 C-51,10 -54,8 -54,4 Z"
				fill={p.carDark} opacity={0.5} />

			{/* glasshouse, split by the B-pillar */}
			<path d="M-22,-22 C-16,-33 -6,-38 3,-38 L3,-22 Z" fill={p.carGlass} />
			<path d="M8,-38 L15,-38 C26,-37 34,-31 39,-23 L8,-23 Z" fill={p.carGlass} opacity={0.85} />

			{/* lights */}
			<path d="M-54,-8 C-51,-10 -46,-10 -44,-8 L-44,-4 L-53,-4 Z" fill="#FFF3D0" opacity={0.95} />
			<path d="M52,-9 C53,-9 54,-7 54,-5 L54,-3 L47,-3 L47,-7 Z" fill="#E5544A" opacity={0.9} />
			<rect x={-6} y={-14} width={11} height={2} rx={1} fill={p.carDark} opacity={0.5} />

			{/* Wheels: real circles. They were ellipses before, which is what made
			    the car look squashed even where the body was right. */}
			{[-30, 30].map((cx) => (
				<g key={cx}>
					<circle cx={cx} cy={3} r={13.5} fill={p.carDark} opacity={0.45} />
					<circle cx={cx} cy={3} r={11.5} fill="#161C24" />
					<circle cx={cx} cy={3} r={5.5} fill={p.deviceEdge} opacity={0.75} />
					<circle cx={cx} cy={3} r={2} fill="#161C24" opacity={0.5} />
				</g>
			))}

			{/* Charge state, floating above the roof so it never fights the body.
			    Sits centred rather than off to the left, where it used to collide
			    with the foreground planting and clip the frame edge. */}
			<g transform="translate(-4 -66)">
				{/* short leader, so the badge reads as belonging to the car */}
				<line x1={0} y1={17} x2={0} y2={25} stroke={p.deviceEdge} strokeWidth={2} />
				<circle r={17} fill={p.device} opacity={0.96} />
				<circle r={15} fill="none" stroke={p.deviceEdge} strokeWidth={3.5} />
				{soc !== null && (
					<circle
						r={15}
						fill="none"
						stroke={charging ? p.flowGood : p.flowBattery}
						strokeWidth={3.5}
						strokeLinecap="round"
						strokeDasharray={`${ring * pct} ${ring}`}
						transform="rotate(-90)"
						style={{ transition: "stroke-dasharray 900ms ease" }}
					/>
				)}
				<text textAnchor="middle" y={5} fill={p.ink} style={{ fontSize: 13, fontWeight: 700 }}>
					{soc === null ? "?" : `${Math.round(soc)}%`}
				</text>
			</g>
		</g>
	);
}
