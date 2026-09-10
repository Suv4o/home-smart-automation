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
							<Outlook
								key={day}
								label={i === 0 ? "Today" : "Tomorrow"}
								hours={hoursOn(state, day)}
								thresholdW={threshold}
								timezone={state.timezone}
								isToday={i === 0}
							/>
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
	timezone,
	isToday,
}: {
	label: string;
	hours: { time: string; radiationWm2: number; estimatedW: number | null }[];
	thresholdW: number;
	timezone: string;
	isToday: boolean;
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
			<SunBar hours={hours} thresholdW={thresholdW} timezone={timezone} isToday={isToday} />
		</div>
	);
}

/**
 * A day at a glance: one bar per daylight hour.
 *
 * The bars carry hour labels because without them the shape means nothing - you
 * could see a good afternoon but not know whether it was morning or evening, and
 * "peak 2.5 kW" gives no clue when to plug in. Today also marks the current
 * hour, so you can see at once how much of the good sun is still ahead.
 */
function SunBar({
	hours,
	thresholdW,
	timezone,
	isToday,
}: {
	hours: { time: string; radiationWm2: number; estimatedW: number | null }[];
	thresholdW: number;
	timezone: string;
	isToday: boolean;
}) {
	const daylight = hours.filter((h) => h.radiationWm2 > 0);
	if (!daylight.length) return null;
	const max = Math.max(...daylight.map((h) => h.radiationWm2));
	const nowHour = isToday ? Number(new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date())) : -1;

	// Label roughly every third hour, always including the first and last, so a
	// short winter day still gets both ends without crowding a long summer one.
	const step = Math.max(1, Math.round(daylight.length / 4));

	return (
		<div className="mt-2">
			<div className="flex items-end gap-[3px]">
				{daylight.map((h) => {
					const good = h.estimatedW !== null && h.estimatedW >= thresholdW;
					const isNow = Number(h.time.slice(11, 13)) === nowHour;
					return (
						<span
							key={h.time}
							className={`relative w-full rounded-sm ${good ? "bg-good" : "bg-hairline"} ${
								isNow ? "outline outline-2 outline-offset-1 outline-ink-dim" : ""
							}`}
							style={{ height: `${Math.max(3, (h.radiationWm2 / max) * 34)}px` }}
							title={`${hhmm(h.time)} · ${Math.round(h.radiationWm2)} W/m²${h.estimatedW === null ? "" : ` · ~${h.estimatedW} W`}`}
						/>
					);
				})}
			</div>

			<div className="mt-1 flex gap-[3px]">
				{daylight.map((h, i) => {
					const show = i % step === 0 || i === daylight.length - 1;
					const isNow = Number(h.time.slice(11, 13)) === nowHour;
					return (
						<span
							key={h.time}
							className={`w-full text-center text-[10px] tabular-nums ${isNow ? "font-bold text-ink-dim" : "text-muted"}`}
						>
							{show || isNow ? h.time.slice(11, 13) : ""}
						</span>
					);
				})}
			</div>

			{isToday && nowHour >= 0 && (
				<p className="mt-1 text-xs text-muted">outlined bar is the hour you are in now</p>
			)}
		</div>
	);
}
