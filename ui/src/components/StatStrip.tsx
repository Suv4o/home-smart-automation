import { ago, freshness, power } from "../lib/format.ts";
import type { DashboardState } from "../lib/types.ts";

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
			<Tile label="solar" value={e ? power(e.solarW) : "—"} tone={e && e.solarW > 50 ? "text-good" : "text-ink"} />
			<Tile label="home" value={e ? power(e.loadW) : "—"} tone="text-ink" />
			<Tile
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
			<Tile
				label="car"
				value={car ? `${Math.round(car.soc)}%` : "unknown"}
				tone={fresh === "stale" ? "text-muted" : "text-ink"}
				// Age is always written out; dimming alone never carries the meaning.
				note={car && fresh !== "fresh" ? ago(car.ageMs) : undefined}
			/>
		</div>
	);
}

function Tile({ label, value, tone, note }: { label: string; value: string; tone: string; note?: string }) {
	return (
		<div className="bg-page px-3 py-4 text-center">
			<div className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
			<div className="mt-1 text-base uppercase tracking-wide text-muted">{label}</div>
			{note && <div className="mt-0.5 text-sm text-muted">{note}</div>}
		</div>
	);
}
