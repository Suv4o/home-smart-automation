import { useEffect, useState } from "react";

/**
 * The time, in the zone the charging policy runs on.
 *
 * Two things it deliberately does not do. It does not use the tablet's own
 * timezone: the windows ("free power 10:00–14:00") are Melbourne wall time, and a
 * clock disagreeing with the schedule beside it would be worse than no clock. And
 * it does not take its value from the server's state updates - those land every
 * 15 seconds, so the minute would change late and unevenly. It ticks locally and
 * only borrows the *zone* from the server.
 */
export function Clock({ timezone }: { timezone: string }) {
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		// Align to the next minute, then tick once a minute: the display has no
		// seconds, so waking every second would be wasted work on a device that is
		// left running for months.
		let interval: number | undefined;
		const start = window.setTimeout(
			() => {
				setNow(new Date());
				interval = window.setInterval(() => setNow(new Date()), 60_000);
			},
			(60 - new Date().getSeconds()) * 1000,
		);
		return () => {
			window.clearTimeout(start);
			if (interval) window.clearInterval(interval);
		};
	}, []);

	const time = new Intl.DateTimeFormat("en-AU", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(now);

	return (
		<time className="text-3xl font-bold tabular-nums text-ink" dateTime={now.toISOString()}>
			{time}
		</time>
	);
}
