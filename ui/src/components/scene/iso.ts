/**
 * Isometric projection.
 *
 * World space is right-handed and building-shaped:
 *   x  east  (right, and slightly down on screen)
 *   y  up    (height)
 *   z  south (toward the viewer's lower-left)
 *
 * A true 30° isometric keeps every vertical edge vertical on screen, which is
 * what makes flat-shaded volumes read cleanly. Every solid in the scene is
 * built through here so nothing is aligned by eye.
 */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}
export interface Pt {
	x: number;
	y: number;
}

const ANGLE = Math.PI / 6; // 30°
const COS = Math.cos(ANGLE);
const SIN = Math.sin(ANGLE);

/** World -> screen. */
export function iso(x: number, y: number, z: number): Pt {
	return { x: (x - z) * COS, y: (x + z) * SIN - y };
}

export const pt = (p: Pt): string => `${round(p.x)},${round(p.y)}`;

/** A closed polygon path from world-space corners. */
export function face(corners: Vec3[]): string {
	const screen = corners.map((c) => iso(c.x, c.y, c.z));
	return `M${screen.map(pt).join(" L")} Z`;
}

export interface BoxFaces {
	/** Lit from above - the lightest tone. */
	top: string;
	/** The +z side, facing the viewer's lower-left. */
	left: string;
	/** The +x side, facing the viewer's lower-right - the darkest tone. */
	right: string;
}

/**
 * The three visible faces of an axis-aligned box, as SVG path data.
 * `o` is the near-bottom corner; the box extends +x, +y (up) and +z.
 */
export function box(o: Vec3, w: number, h: number, d: number): BoxFaces {
	const x0 = o.x;
	const x1 = o.x + w;
	const y0 = o.y;
	const y1 = o.y + h;
	const z0 = o.z;
	const z1 = o.z + d;

	return {
		top: face([
			{ x: x0, y: y1, z: z0 },
			{ x: x1, y: y1, z: z0 },
			{ x: x1, y: y1, z: z1 },
			{ x: x0, y: y1, z: z1 },
		]),
		left: face([
			{ x: x0, y: y0, z: z1 },
			{ x: x1, y: y0, z: z1 },
			{ x: x1, y: y1, z: z1 },
			{ x: x0, y: y1, z: z1 },
		]),
		right: face([
			{ x: x1, y: y0, z: z0 },
			{ x: x1, y: y0, z: z1 },
			{ x: x1, y: y1, z: z1 },
			{ x: x1, y: y1, z: z0 },
		]),
	};
}

/** Screen position of a world point, for anchoring wires and labels. */
export const anchor = (v: Vec3): Pt => iso(v.x, v.y, v.z);

function round(n: number): number {
	return Math.round(n * 100) / 100;
}
