import { anchor, type Pt, type Vec3 } from "./iso.ts";

/**
 * The scene in world space, laid out for a portrait screen: roof and panels at
 * the top, house body in the middle, driveway with the car along the bottom,
 * grid entering from the right.
 *
 * Everything is expressed as world coordinates and projected once, so moving a
 * building moves the wires attached to it.
 */

/** House footprint. Taller walls than the roof rise, so the roof frames the
 *  building rather than swallowing it. */
export const HOUSE = { o: { x: 0, y: 0, z: 0 }, w: 132, h: 104, d: 92 } as const;
export const ROOF_OVERHANG = 8;
export const ROOF_RIDGE_X = 88;
export const ROOF_RIDGE_Y = 150;

/** Driveway slab, in front of the house (larger z = nearer the viewer). */
export const DRIVE = { o: { x: -14, y: 0, z: 110 }, w: 160, h: 3, d: 96 } as const;

/** Lawn. Kept tight: an isometric square projects to a wide diamond, so a big
 *  footprint fights the portrait frame. */
export const LAWN = { o: { x: -62, y: -3, z: -44 }, w: 292, h: 3, d: 284 } as const;

/** Wall-mounted battery, right-hand end of the front wall. */
export const BATTERY = { o: { x: 92, y: 22, z: 92 }, w: 26, h: 44, d: 7 } as const;

/** Wall charger, left-hand end, nearest the driveway. */
export const CHARGER = { o: { x: 12, y: 30, z: 92 }, w: 12, h: 19, d: 6 } as const;

/** The meter / inverter junction every flow routes through, between the two. */
export const JUNCTION: Vec3 = { x: 78, y: 76, z: 92 };

/** Solar array, expressed as fractions along the front roof pitch (0 = eave,
 *  1 = ridge) so the quads are guaranteed to lie in the plane. */
export const PANELS = { t0: 0.24, t1: 0.9, rows: 2, z0: 10, z1: 80, cols: 3 } as const;

/** A point on the front roof pitch: `t` runs eave (0) to ridge (1). */
export function onPitch(t: number, z: number): Vec3 {
	return {
		x: -ROOF_OVERHANG + t * (ROOF_RIDGE_X + ROOF_OVERHANG),
		y: HOUSE.h + t * (ROOF_RIDGE_Y - HOUSE.h),
		z,
	};
}

/** Grid connection post, off to the right. */
export const GRID_POST = { o: { x: 186, y: 0, z: 34 }, w: 6, h: 122, d: 6 } as const;

/** The car on the driveway, sitting just out from the charger. */
export const CAR = { x: 34, y: 3, z: 156 } as const;

/** Screen-space, since the sun isn't part of the isometric world. */
export const SUN = { x: 118, y: 236, r: 30 } as const;

/**
 * Flow wires, as world-space waypoints. Each list is written in the direction
 * energy travels when the value is positive, and `HouseScene` says so at the
 * call site - a wire animating backwards is not something you notice quickly.
 */
export const ROUTES = {
	/** Down the roof pitch and along the wall into the junction. */
	solarToJunction: [
		{ x: 52, y: 130, z: 44 },
		{ x: 52, y: 116, z: 92 },
		{ x: 78, y: 96, z: 92 },
		JUNCTION,
	],
	/** Junction across to the battery. Positive = charging the battery. */
	junctionToBattery: [JUNCTION, { x: 92, y: 72, z: 92 }, { x: 105, y: 60, z: 92 }],
	/** Off the pole's lower cross-arm into the junction, above the battery. */
	gridToJunction: [
		{ x: 176, y: 92, z: 37 },
		{ x: 176, y: 86, z: 92 },
		{ x: 100, y: 86, z: 92 },
		JUNCTION,
	],
	/**
	 * Junction along the wall, down through the charger, then out toward the car.
	 *
	 * It stops deliberately short of the bodywork. The car is painted after the
	 * wires, so a route ending *on* the car had its arrowhead hidden underneath -
	 * which is exactly why the charging cable looked like it had no direction.
	 * Ending just clear of the roof leaves the arrow visible, pointing at the car.
	 */
	junctionToCar: [
		JUNCTION,
		{ x: 20, y: 76, z: 92 },
		{ x: 18, y: 52, z: 92 },
		{ x: 18, y: 30, z: 100 },
		{ x: 30, y: 25, z: 120 },
	],
} as const satisfies Record<string, readonly Vec3[]>;

/**
 * Where each value sits. Hand-placed rather than taken from route midpoints -
 * the routes converge on the junction, so midpoints landed on top of one
 * another.
 *
 * The grid label is lifted just clear of the mast cap - enough that the whole
 * powerline shows, and no further, so the number still reads as belonging to the
 * pole rather than floating off in the sky.
 */
export const LABEL_AT = {
	solar: { x: -46, y: 150, z: 44 },
	grid: { x: 223, y: 157, z: 30 },
	battery: { x: 150, y: 30, z: 118 },
	car: { x: 26, y: 40, z: 168 },
} as const satisfies Record<string, Vec3>;

/** Project a world route to screen points for `roundedPath`. */
export const project = (route: readonly Vec3[]): Pt[] => route.map((v) => anchor(v));

/** Midpoint of a projected route, for placing its value label. */
export function routeLabel(route: readonly Vec3[], dx = 0, dy = -12): Pt {
	const pts = project(route);
	const mid = pts[Math.floor(pts.length / 2)]!;
	return { x: mid.x + dx, y: mid.y + dy };
}
