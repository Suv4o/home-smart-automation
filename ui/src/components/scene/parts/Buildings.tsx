import { anchor, box, face, iso, pt } from "../iso.ts";
import { BATTERY, CHARGER, DRIVE, GRID_POST, HOUSE, LAWN, onPitch, PANELS, ROOF_OVERHANG, ROOF_RIDGE_X, ROOF_RIDGE_Y } from "../layout.ts";
import type { Palette } from "../palette.ts";

/** Lawn and driveway slabs. */
export function Ground({ p }: { p: Palette }) {
	const lawn = box(LAWN.o, LAWN.w, LAWN.h, LAWN.d);
	const drive = box(DRIVE.o, DRIVE.w, DRIVE.h, DRIVE.d);
	return (
		<g>
			<path d={lawn.top} fill={p.ground} />
			<path d={lawn.left} fill={p.groundEdge} />
			<path d={lawn.right} fill={p.groundEdge} opacity={0.75} />
			<path d={drive.top} fill={p.drive} />
			<path d={drive.left} fill={p.driveEdge} />
			<path d={drive.right} fill={p.driveEdge} opacity={0.8} />
		</g>
	);
}

/** House walls: three flat-shaded faces giving the volume its weight. */
export function HouseVolume({ p }: { p: Palette }) {
	const b = box(HOUSE.o, HOUSE.w, HOUSE.h, HOUSE.d);
	return (
		<g>
			<path d={b.right} fill={p.wallRight} />
			<path d={b.left} fill={p.wallLeft} />
			<path d={b.top} fill={p.soffit} />
		</g>
	);
}

/**
 * A gable roof: two pitches meeting at a ridge running along z, plus the gable
 * triangle on the front. The left pitch carries the solar array.
 */
export function Roof({ p }: { p: Palette }) {
	const { w, d } = HOUSE;
	const eave = HOUSE.h;
	const oh = ROOF_OVERHANG;
	const ridgeX = ROOF_RIDGE_X;

	const frontPitch = face([
		{ x: -oh, y: eave, z: d + oh },
		{ x: ridgeX, y: ROOF_RIDGE_Y, z: d + oh },
		{ x: ridgeX, y: ROOF_RIDGE_Y, z: -oh },
		{ x: -oh, y: eave, z: -oh },
	]);
	const backPitch = face([
		{ x: ridgeX, y: ROOF_RIDGE_Y, z: d + oh },
		{ x: w + oh, y: eave, z: d + oh },
		{ x: w + oh, y: eave, z: -oh },
		{ x: ridgeX, y: ROOF_RIDGE_Y, z: -oh },
	]);
	const gable = face([
		{ x: 0, y: eave, z: d },
		{ x: ridgeX, y: ROOF_RIDGE_Y, z: d },
		{ x: w, y: eave, z: d },
	]);

	return (
		<g>
			<path d={gable} fill={p.wallLeft} />
			<path d={frontPitch} fill={p.roofLeft} />
			<path d={backPitch} fill={p.roofRight} />
			{/* ridge highlight */}
			<path
				d={`M${pt(iso(ridgeX, ROOF_RIDGE_Y, d + oh))} L${pt(iso(ridgeX, ROOF_RIDGE_Y, -oh))}`}
				stroke={p.roofTop}
				strokeWidth={3}
				fill="none"
			/>
		</g>
	);
}

/** Solar array, lying on the front roof pitch. */
export function SolarPanels({ p, lit }: { p: Palette; lit: number }) {
	// Built from fractions along the pitch, so every quad is coplanar with the
	// roof by construction rather than by hand-matched slope numbers.
	const cells: string[] = [];
	const gap = 0.015;
	const dz = (PANELS.z1 - PANELS.z0) / PANELS.cols;
	const dt = (PANELS.t1 - PANELS.t0) / PANELS.rows;

	for (let r = 0; r < PANELS.rows; r++) {
		for (let c = 0; c < PANELS.cols; c++) {
			const ta = PANELS.t0 + r * dt + gap;
			const tb = PANELS.t0 + (r + 1) * dt - gap;
			const za = PANELS.z0 + c * dz + 2;
			const zb = PANELS.z0 + (c + 1) * dz - 2;
			cells.push(face([onPitch(ta, za), onPitch(tb, za), onPitch(tb, zb), onPitch(ta, zb)]));
		}
	}
	return (
		<g>
			{cells.map((d, i) => (
				<g key={i}>
					<path d={d} fill={p.panel} stroke={p.panelGrid} strokeWidth={1.2} strokeOpacity={0.55} />
					{lit > 0 && <path d={d} fill={p.panelLit} opacity={0.1 + lit * 0.32} />}
				</g>
			))}
		</g>
	);
}

/** Recessed window with a warm interior after dark. */
export function Window({ p, night }: { p: Palette; night: number }) {
	const w = face([
		{ x: 34, y: 42, z: HOUSE.d },
		{ x: 66, y: 42, z: HOUSE.d },
		{ x: 66, y: 72, z: HOUSE.d },
		{ x: 34, y: 72, z: HOUSE.d },
	]);
	// A second window on the large right-hand wall, so it isn't a blank slab.
	const side = face([
		{ x: HOUSE.w, y: 44, z: 26 },
		{ x: HOUSE.w, y: 44, z: 58 },
		{ x: HOUSE.w, y: 74, z: 58 },
		{ x: HOUSE.w, y: 74, z: 26 },
	]);
	return (
		<g>
			<path d={w} fill={p.windowGlass} />
			<path d={w} fill={p.windowLight} opacity={night * 0.85} />
			<path d={w} fill="none" stroke={p.windowFrame} strokeWidth={3} />
			<path d={side} fill={p.windowGlass} opacity={0.85} />
			<path d={side} fill={p.windowLight} opacity={night * 0.7} />
			<path d={side} fill="none" stroke={p.windowFrame} strokeWidth={2.5} />
		</g>
	);
}

/** Wall-mounted home battery, with the charge level actually filling it. */
export function Battery({ p, soc, low }: { p: Palette; soc: number; low: boolean }) {
	const b = box(BATTERY.o, BATTERY.w, BATTERY.h, BATTERY.d);
	const fill = Math.max(0, Math.min(100, soc)) / 100;
	const { o, w, h, d } = BATTERY;
	const top = o.y + 3 + (h - 6) * fill;
	const level = face([
		{ x: o.x + 2, y: o.y + 3, z: o.z + d },
		{ x: o.x + w - 2, y: o.y + 3, z: o.z + d },
		{ x: o.x + w - 2, y: top, z: o.z + d },
		{ x: o.x + 2, y: top, z: o.z + d },
	]);
	const label = anchor({ x: o.x + w / 2, y: o.y + h / 2, z: o.z + d });

	return (
		<g>
			<path d={b.right} fill={p.deviceEdge} />
			<path d={b.left} fill={p.device} />
			<path d={b.top} fill={p.device} />
			<path d={level} fill={low ? p.flowWarning : p.flowGood} opacity={0.85} style={{ transition: "d 900ms ease" }} />
			<path d={b.left} fill="none" stroke={p.deviceEdge} strokeWidth={1.5} />
			<text x={label.x} y={label.y + 5} textAnchor="middle" fill={p.ink} style={{ fontSize: 13, fontWeight: 700 }}>
				{Math.round(soc)}%
			</text>
		</g>
	);
}

/** Wall charger beside the driveway. */
export function Charger({ p, active }: { p: Palette; active: boolean }) {
	const b = box(CHARGER.o, CHARGER.w, CHARGER.h, CHARGER.d);
	const led = anchor({ x: CHARGER.o.x + CHARGER.w / 2, y: CHARGER.o.y + CHARGER.h - 5, z: CHARGER.o.z + CHARGER.d });
	return (
		<g>
			<path d={b.right} fill={p.deviceEdge} />
			<path d={b.left} fill={p.device} />
			<path d={b.top} fill={p.device} />
			<circle cx={led.x} cy={led.y} r={2.6} fill={active ? p.flowGood : p.muted}>
				{active && <animate attributeName="opacity" values="0.4;1;0.4" dur="1.8s" repeatCount="indefinite" />}
			</circle>
		</g>
	);
}

/** Grid connection: a slim post with the service line running in. */
export function GridConnection({ p, tone }: { p: Palette; tone: string }) {
	const pole = box(GRID_POST.o, GRID_POST.w, GRID_POST.h, GRID_POST.d);
	// Two cross-arms centred on the pole, the lower one carrying the house drop.
	const armTop = box({ x: 167, y: 102, z: 34.5 }, 45, 4, 5);
	const armLow = box({ x: 173, y: 84, z: 34.5 }, 33, 3.5, 5);

	const insulator = (x: number, y: number) => box({ x, y, z: 36 }, 3, 6, 3);
	const insulators = [insulator(169, 106), insulator(206, 106), insulator(175, 87.5), insulator(201, 87.5)];

	// The span carries on past the frame - a sagging catenary is what makes this
	// read as a power line rather than a pole standing on its own.
	const span = (fromX: number, y: number, sag: number): string => {
		const a = anchor({ x: fromX, y, z: 36 });
		const b = anchor({ x: 352, y: y - 6, z: 36 });
		return `M${a.x},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 + sag} ${b.x},${b.y}`;
	};

	// Where the house drop leaves the pole; carries the live grid colour.
	const tap = anchor({ x: 176, y: 92, z: 37 });

	return (
		<g>
			{[span(207, 108, 26), span(170, 108, 30), span(202, 89, 24)].map((d, i) => (
				<path key={i} d={d} fill="none" stroke={p.muted} strokeWidth={1.6} opacity={0.5} strokeLinecap="round" />
			))}

			<path d={pole.right} fill={p.roofRight} />
			<path d={pole.left} fill={p.roofLeft} />
			<path d={pole.top} fill={p.roofTop} />

			{[armLow, armTop].map((arm, i) => (
				<g key={i}>
					<path d={arm.right} fill={p.roofRight} />
					<path d={arm.left} fill={p.roofLeft} />
					<path d={arm.top} fill={p.roofTop} />
				</g>
			))}

			{insulators.map((ins, i) => (
				<g key={i}>
					<path d={ins.left} fill={p.deviceEdge} />
					<path d={ins.top} fill={p.device} />
				</g>
			))}

			<circle cx={tap.x} cy={tap.y} r={3.5} fill={tone} />
		</g>
	);
}
