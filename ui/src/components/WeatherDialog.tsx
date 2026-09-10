import { chargingThresholdW, forecastDays, hhmm, hoursOn, peakW, sunWindow } from "../lib/solar.ts";
import type { DashboardState } from "../lib/types.ts";
import { Dialog } from "./controls/Dialog.tsx";

/**
 * The solar outlook: whether the sun will actually cover the car, today and
 * tomorrow.
 *
 * This is the reason weather is here at all. A temperature is decoration; "there
 * is a six-hour charging window tomorrow from 10:00" answers the question the
 * whole system exists to serve - wait for the sun, or override tonight.
 */
export function WeatherDialog({
	state,
	open,
	onClose,
}: {
	state: DashboardState;
	open: boolean;
	onClose: () => void;
}) {
	const w = state.weather;
	const threshold = chargingThresholdW(state);
	const days = forecastDays(state);

	return (
		<Dialog open={open} title="Sun and weather" onClose={onClose}>
			{w ? (
				<>
					<div className="flex items-baseline gap-3">
						<span className="text-4xl font-bold text-ink">{Math.round(w.temperatureC)}°</span>
						<span className="text-lg text-ink-dim">{w.condition.label}</span>
					</div>
					<p className="mt-1 text-base text-muted">
						feels {Math.round(w.feelsLikeC)}° · {w.cloudCoverPct}% cloud
						{w.todayMinC !== null && w.todayMaxC !== null && (
							<> · today {Math.round(w.todayMinC)}–{Math.round(w.todayMaxC)}°</>
						)}
					</p>

					<div className="mt-5 space-y-4 border-t border-hairline pt-4">
						{days.map((day, i) => (
							<Outlook key={day} label={i === 0 ? "Today" : "Tomorrow"} hours={hoursOn(state, day)} thresholdW={threshold} />
						))}
					</div>

					<p className="mt-4 text-sm leading-snug text-muted">
						A window means the forecast sun alone should clear {Math.round(threshold)} W — the same bar the solar
						rule uses.{" "}
						{/*
						  * Say where the number comes from. The forecast gives irradiance on
						  * a flat surface; how much this roof makes from it depends on pitch,
						  * orientation and shading, so it is measured from real output rather
						  * than assumed — a fixed guess was out by 1.65x here.
						  */}
						{w.solarSamples > 0 && w.solarFactor !== null ? (
							<>
								Output is worked out from your system's own generation ({w.solarSamples} reading
								{w.solarSamples === 1 ? "" : "s"} so far), so it gets more accurate as it runs.
							</>
						) : (
							<>
								Output uses a starting estimate until your system has generated in daylight a few times, then it
								calibrates itself against what your roof actually makes.
							</>
						)}
					</p>
				</>
			) : (
				<p className="text-lg leading-snug text-ink-dim">
					No weather right now. The forecast needs the internet; everything else on this dashboard only needs the
					local network, so charging carries on regardless.
				</p>
			)}
		</Dialog>
	);
}

function Outlook({
	label,
	hours,
	thresholdW,
}: {
	label: string;
	hours: { time: string; radiationWm2: number; estimatedW: number | null }[];
	thresholdW: number;
}) {
	const window = sunWindow(hours, thresholdW);
	const peak = peakW(hours);

	return (
		<div>
			<h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{label}</h3>
			{window ? (
				<p className="mt-1 text-lg font-medium text-good">
					Charging window {hhmm(window.from)}–{hhmm(window.to)} · {window.hours}h
				</p>
			) : (
				<p className="mt-1 text-lg font-medium text-ink-dim">
					{peak === null ? "Set SOLAR_ARRAY_KWP to estimate output" : "Not enough sun to run the car on solar alone"}
				</p>
			)}
			{peak !== null && (
				<p className="mt-0.5 text-base text-muted">peak about {(peak / 1000).toFixed(1)} kW</p>
			)}
			<SunBar hours={hours} thresholdW={thresholdW} />
		</div>
	);
}

/** A day at a glance: one bar per daylight hour, filled bars clear the bar. */
function SunBar({
	hours,
	thresholdW,
}: {
	hours: { time: string; radiationWm2: number; estimatedW: number | null }[];
	thresholdW: number;
}) {
	const daylight = hours.filter((h) => h.radiationWm2 > 0);
	if (!daylight.length) return null;
	const max = Math.max(...daylight.map((h) => h.radiationWm2));

	return (
		<div className="mt-2 flex items-end gap-[3px]" aria-hidden>
			{daylight.map((h) => {
				const good = h.estimatedW !== null && h.estimatedW >= thresholdW;
				return (
					<span
						key={h.time}
						className={`w-full rounded-sm ${good ? "bg-good" : "bg-hairline"}`}
						style={{ height: `${Math.max(3, (h.radiationWm2 / max) * 34)}px` }}
						title={`${hhmm(h.time)} · ${Math.round(h.radiationWm2)} W/m²`}
					/>
				);
			})}
		</div>
	);
}
