import type { ReactNode } from "react";
import { ago, etaLabel, type Freshness, freshness, power } from "../lib/format.ts";
import type { DashboardState } from "../lib/types.ts";
import { CarIcon, GridIcon, HomeIcon, SolarIcon } from "./icons.tsx";

/** The KPI row: four numbers, readable from across the room. */
export function StatStrip({ state }: { state: DashboardState }) {
	const e = state.energy;
	const importing = (e?.gridW ?? 0) > 0;
	// The scene paints the grid wire red when the breaker guard is holding the car
	// off; the strip has to agree, or the same number appears in two colours.
	const d = state.decision;
	const blocked = d?.action === "off" && /main-switch/.test(d.reason);
	const car = state.car;
	const fresh = freshness(car ? car.ageMs : null);

	return (
		<div className="grid grid-cols-4 gap-px bg-hairline">
			<Tile icon={<SolarIcon />} label="solar" value={e ? power(e.solarW) : "—"} tone={e && e.solarW > 50 ? "text-good" : "text-ink"} />
			<Tile icon={<HomeIcon />} label="home" value={e ? power(e.loadW) : "—"} tone="text-ink" />
			<Tile
				icon={<GridIcon />}
				label={importing ? "grid in" : "grid out"}
				value={e ? power(e.gridW) : "—"}
				tone={
					!e || Math.abs(e.gridW) < 50
						? "text-ink"
						: blocked
							? "text-critical"
							: importing
								? "text-warning"
								: "text-good"
				}
			/>
			{/* Everything about the car sits here - percentage, whether it is
			    actually charging, and how old the reading is. The illustration used
			    to carry a second caption underneath it, which just cluttered the
			    scene with something this tile already had room for. */}
			<Tile
				icon={<CarIcon />}
				label="car"
				value={car ? `${Math.round(car.soc)}%` : "unknown"}
				tone={fresh === "stale" ? "text-muted" : "text-ink"}
				// Never dimming alone: the state or the age is always written out.
				note={carNote(state, car ? ago(car.ageMs) : null, fresh)}
			/>
		</div>
	);
}

/**
 * The icon rides with the label rather than above the number: the value is what
 * you read from across the room, and putting a glyph over it would compete for
 * that first glance. It also inherits the muted label tone, so it recedes.
 */
function Tile({
	icon,
	label,
	value,
	tone,
	note,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	tone: string;
	note?: string;
}) {
	return (
		<div className="bg-page px-3 py-4 text-center">
			<div className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
			<div className="mt-1 flex items-center justify-center gap-1.5 text-base uppercase tracking-wide text-muted">
				{icon}
				<span>{label}</span>
			</div>
			{/*
			  * Always rendered, empty or not. The note comes and goes with the car's
			  * state, and letting it change the strip's height resized the
			  * illustration above it every time - the scene fits itself to whatever
			  * space is left, so 22px here moved the whole drawing.
			  */}
			<div className="mt-0.5 min-h-5 text-sm text-muted">{note}</div>
		</div>
	);
}

/**
 * The one line under the car percentage.
 *
 * While the car is drawing power the figure is being re-read every few minutes,
 * so saying "charging" is more useful than an age that is always near zero. A
 * live plug with nothing on the end says so plainly, because that is the case
 * people misread. Otherwise it falls back to how old the reading is.
 */
function carNote(state: DashboardState, age: string | null, fresh: Freshness): string | undefined {
	if (state.chargeState === "charging") {
		// How much longer the car itself says it needs - the same figure the Tesla
		// app shows. It beats the word "charging", which the headline already says,
		// and it is only available while charging anyway.
		const eta = state.car ? etaLabel(state.car.minutesToFull, state.car.ageMs) : null;
		return eta ?? "charging";
	}
	if (state.chargeState === "full") return "fully charged";
	if (state.chargeState === "waiting") return "not plugged in";
	return fresh !== "fresh" && age ? age : undefined;
}
