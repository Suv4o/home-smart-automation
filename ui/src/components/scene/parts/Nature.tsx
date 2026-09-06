import { anchor } from "../iso.ts";
import { SUN } from "../layout.ts";
import type { Palette } from "../palette.ts";

/** Trees and bushes, framing the scene. Fixed positions - no jitter on render. */
const TREES = [
	{ x: -46, z: -26, r: 22, h: 48 },
	{ x: 196, z: 190, r: 20, h: 40 },
	{ x: -44, z: 214, r: 17, h: 32 },
] as const;

const BUSHES = [
	{ x: 150, z: 236, r: 17 },
	{ x: 176, z: 214, r: 13 },
	{ x: -48, z: 150, r: 14 },
	{ x: -30, z: 196, r: 11 },
] as const;

export function Foliage({ p, behind }: { p: Palette; behind: boolean }) {
	// Things further back (smaller z) draw behind the buildings.
	const trees = TREES.filter((t) => (behind ? t.z < 110 : t.z >= 110));
	const bushes = BUSHES.filter((b) => (behind ? b.z < 110 : b.z >= 110));

	return (
		<g>
			{trees.map((t, i) => {
				const base = anchor({ x: t.x, y: 0, z: t.z });
				const crown = anchor({ x: t.x, y: t.h, z: t.z });
				return (
					<g key={`t${i}`}>
						<ellipse cx={base.x} cy={base.y + 2} rx={t.r * 0.7} ry={t.r * 0.22} fill={p.shadow} />
						<rect x={base.x - 2.5} y={crown.y} width={5} height={base.y - crown.y} fill={p.trunk} rx={2} />
						<circle cx={crown.x} cy={crown.y} r={t.r} fill={p.foliage} />
						<circle cx={crown.x - t.r * 0.32} cy={crown.y - t.r * 0.28} r={t.r * 0.62} fill={p.foliageLight} />
						<circle cx={crown.x + t.r * 0.36} cy={crown.y + t.r * 0.2} r={t.r * 0.5} fill={p.foliageDark} />
					</g>
				);
			})}
			{bushes.map((b, i) => {
				const c = anchor({ x: b.x, y: b.r * 0.5, z: b.z });
				return (
					<g key={`b${i}`}>
						<ellipse cx={c.x} cy={c.y + b.r * 0.55} rx={b.r * 0.9} ry={b.r * 0.24} fill={p.shadow} />
						<circle cx={c.x - b.r * 0.5} cy={c.y + b.r * 0.16} r={b.r * 0.66} fill={p.foliageDark} />
						<circle cx={c.x + b.r * 0.45} cy={c.y + b.r * 0.2} r={b.r * 0.58} fill={p.foliage} />
						<circle cx={c.x} cy={c.y} r={b.r * 0.8} fill={p.foliage} />
						<circle cx={c.x - b.r * 0.2} cy={c.y - b.r * 0.24} r={b.r * 0.44} fill={p.foliageLight} />
					</g>
				);
			})}
		</g>
	);
}

/**
 * Sun with rays, or the moon at its real phase.
 *
 * Which one shows is decided by the sun's height, never by production - an
 * overcast midday still gets a sun. Output only drives how bright it looks.
 */
export function SunRays({ intensity }: { intensity: number }) {
	const rays = 12;
	const reach = 16 + intensity * 22;
	return (
		<g transform={`translate(${SUN.x} ${-SUN.y})`}>
			{Array.from({ length: rays }, (_, i) => {
				const a = (i / rays) * Math.PI * 2;
				return (
					<line
						key={i}
						x1={Math.cos(a) * (SUN.r + 10)}
						y1={Math.sin(a) * (SUN.r + 10)}
						x2={Math.cos(a) * (SUN.r + 10 + reach)}
						y2={Math.sin(a) * (SUN.r + 10 + reach)}
						stroke="#FFC93C"
						strokeWidth={5}
						strokeLinecap="round"
						opacity={0.3 + intensity * 0.55}
					>
						<animate
							attributeName="opacity"
							values={`${0.25 + intensity * 0.35};${0.5 + intensity * 0.5};${0.25 + intensity * 0.35}`}
							dur="4s"
							begin={`${i * 0.16}s`}
							repeatCount="indefinite"
						/>
					</line>
				);
			})}
			<circle r={SUN.r + 12} fill="#FFC93C" opacity={0.16} />
			<circle r={SUN.r} fill="#FFD65C" />
			<circle r={SUN.r} fill="#FFF0B8" opacity={intensity * 0.75} />
		</g>
	);
}

export function Moon({ phase, fraction }: { phase: number; fraction: number }) {
	const waxing = phase < 0.5;
	const offset = (1 - fraction * 2) * SUN.r * (waxing ? -1 : 1);
	return (
		<g transform={`translate(${SUN.x} ${-SUN.y})`}>
			<defs>
				<mask id="moon-lit">
					<circle r={SUN.r} fill="white" />
					<circle r={SUN.r} cx={offset} fill="black" />
				</mask>
			</defs>
			<circle r={SUN.r + 16} fill="#DCE6F5" opacity={0.09} />
			<circle r={SUN.r} fill="#20293D" />
			<g mask="url(#moon-lit)">
				<circle r={SUN.r} fill="#E4EAF6" />
				<circle cx={-10} cy={-9} r={5} fill="#C6D0E4" opacity={0.7} />
				<circle cx={9} cy={7} r={7} fill="#C6D0E4" opacity={0.55} />
				<circle cx={13} cy={-13} r={3.5} fill="#C6D0E4" opacity={0.6} />
			</g>
		</g>
	);
}
