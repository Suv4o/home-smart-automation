import { useState } from "react";
import type { Connection } from "../hooks/useLiveState.ts";
import { clockLabel, countdown, power } from "../lib/format.ts";
import type { DashboardState } from "../lib/types.ts";
import { Dialog } from "./controls/Dialog.tsx";
import { AlertIcon, BoltIcon, BoltOffIcon, InfoIcon, PlugIcon } from "./icons.tsx";

const WINDOW_LABEL: Record<string, string> = {
	free: "free power",
	morning: "morning battery share",
	solar: "solar surplus",
};

/**
 * The headline: is the car charging, and why.
 *
 * The "why" is one sentence of arithmetic - useful when you walk up to the
 * tablet wondering what it is doing, noise the rest of the time. It now lives
 * behind the ⓘ, which frees the header to carry only what is worth reading from
 * across the room, and gives the explanation room to show the thresholds the
 * decision was actually measured against.
 *
 * The window name went the same way - it names a rule rather than reporting a
 * state, and it reads better in the dialog beside the hours it covers.
 *
 * What stays visible is anything that needs acting on without being asked for:
 * an active override, a lost connection, and read failures.
 */
export function StatusBanner({ state, connection }: { state: DashboardState; connection: Connection }) {
	const [why, setWhy] = useState(false);
	const d = state.decision;
	const charging = d?.action === "on";
	const blocked = d?.action === "off" && /main-switch/.test(d.reason);

	// The policy wanting to charge is not the same as a car actually charging.
	// With the plug live and no cable in the car this used to read "CHARGING",
	// which was the most prominent wrong thing on the screen.
	const waiting = charging && state.chargeState === "waiting";

	const status = blocked
		? { icon: <AlertIcon />, headline: "PAUSED — GRID TOO BUSY", tone: "text-critical" }
		: waiting
			? { icon: <PlugIcon />, headline: "WAITING FOR THE CAR", tone: "text-ink-dim" }
			: charging
				? {
						icon: <BoltIcon size={30} />,
						headline: state.chargeState === "charging" ? "CHARGING" : "STARTING TO CHARGE",
						tone: "text-good",
					}
				: { icon: <BoltOffIcon />, headline: "NOT CHARGING", tone: "text-ink-dim" };
	const { headline, tone } = status;

	const { limits: l } = state;

	return (
		<header className="px-6 pt-5 pb-3">
			{/* The tone sits on the row so the icon inherits it through
			    `currentColor`; the ⓘ overrides it back to muted. */}
			<div className={`flex items-center gap-3 ${tone}`}>
				<span className="shrink-0">{status.icon}</span>
				<h1 className="text-4xl font-bold tracking-tight">{headline}</h1>
				<button
					type="button"
					onClick={() => setWhy(true)}
					aria-label="Why is it doing this?"
					className="shrink-0 rounded-full p-1 text-muted active:bg-hairline"
				>
					<InfoIcon />
				</button>
			</div>

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
			{state.errors.length > 0 && <p className="mt-2 text-base text-serious">{state.errors[0]}</p>}

			<Dialog open={why} title={`Why is it ${headlineVerb(headline)}?`} onClose={() => setWhy(false)}>
				<p className="text-lg leading-snug text-ink">
					{waiting
						? "The charger is on, but nothing is drawing from it — plug the cable into the car."
						: (d?.reason ?? "No reading yet.")}
				</p>

				{/* The thresholds the sentence above was measured against, so the
				    numbers in it can be checked rather than taken on trust. */}
				<dl className="mt-5 space-y-2 border-t border-hairline pt-4 text-base">
					<Fact term="Window" value={windowDetail(d?.window, l)} />
					<Fact term="Grid limit" value={power(l.mainSwitchLimitW)} />
					<Fact term="Car charger" value={power(l.carPowerW)} />
					<Fact term="Solar rule" value={`needs ${Math.round(l.solarCoverRatio * 100)}% of house + car`} />
					<Fact term="Stop car at" value={`${l.carMaxSoc}%`} />
					<Fact term="House battery" value={`start above ${l.batteryBypassPct}% · floor ${l.batteryStopPct}%`} />
				</dl>
			</Dialog>
		</header>
	);
}

function Fact({ term, value }: { term: string; value: string }) {
	return (
		<div className="flex justify-between gap-4">
			<dt className="text-muted">{term}</dt>
			<dd className="text-right font-medium text-ink">{value}</dd>
		</div>
	);
}

/** "NOT CHARGING" -> "not charging", so the dialog title reads as a question. */
function headlineVerb(headline: string): string {
	return headline.toLowerCase().replace(/ — .*$/, "");
}

function windowDetail(window: string | undefined, l: DashboardState["limits"]): string {
	const name = window ? WINDOW_LABEL[window] : undefined;
	if (!name) return "—";
	const when =
		window === "free"
			? `${clockLabel(l.freeStartMin)}–${clockLabel(l.freeEndMin)}`
			: window === "morning"
				? `${clockLabel(l.morningStartMin)}–${clockLabel(l.freeStartMin)}`
				: `after ${clockLabel(l.freeEndMin)}`;
	return `${name} · ${when}`;
}
