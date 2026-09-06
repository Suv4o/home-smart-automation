import { countdown } from "../lib/format.ts";
import type { Connection } from "../hooks/useLiveState.ts";
import type { DashboardState } from "../lib/types.ts";

const WINDOW_LABEL: Record<string, string> = {
	free: "free power",
	morning: "morning battery share",
	solar: "solar surplus",
};

/**
 * The headline: is the car charging, and why. The reason is always spelled out
 * in words - colour alone never carries the message.
 */
export function StatusBanner({ state, connection }: { state: DashboardState; connection: Connection }) {
	const d = state.decision;
	const charging = d?.action === "on";
	const blocked = d?.action === "off" && /main-switch/.test(d.reason);

	const tone = blocked ? "text-critical" : charging ? "text-good" : "text-ink-dim";
	const headline = blocked
		? "PAUSED — GRID TOO BUSY"
		: charging
			? state.charger?.on
				? "CHARGING"
				: "STARTING TO CHARGE"
			: "NOT CHARGING";

	return (
		<header className="px-6 pt-5 pb-3">
			<div className="flex items-baseline justify-between gap-3">
				<h1 className={`text-4xl font-bold tracking-tight ${tone}`}>{headline}</h1>
				<span className="text-lg text-muted">{d ? WINDOW_LABEL[d.window] : "—"}</span>
			</div>
			<p className="mt-1 text-xl leading-snug text-ink-dim">{d?.reason ?? "waiting for a reading…"}</p>

			{state.override && (
				<p className="mt-2 inline-block rounded-full bg-surface px-4 py-1 text-lg text-warning">
					manual override · {countdown(state.override.until)}
				</p>
			)}
			{connection !== "live" && (
				<p className="mt-2 text-lg text-serious">
					{connection === "offline" ? "reconnecting to the daemon…" : "connecting…"}
				</p>
			)}
			{state.errors.length > 0 && (
				<p className="mt-2 text-base text-serious">{state.errors[0]}</p>
			)}
		</header>
	);
}
