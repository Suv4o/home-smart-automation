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
	// The plug is still live because an override or window says so, but the car
	// has finished. Announcing that is very different from asking for a cable.
	const full = charging && state.chargeState === "full";

	const status = blocked
		? { icon: <AlertIcon />, headline: "PAUSED — GRID TOO BUSY", tone: "text-critical" }
		: waiting
			? { icon: <PlugIcon />, headline: "WAITING FOR THE CAR", tone: "text-ink-dim" }
			: full
				? { icon: <BoltIcon size={30} />, headline: "CAR IS FULLY CHARGED", tone: "text-good" }
			: charging
				? {
						icon: <BoltIcon size={30} />,
						headline: state.chargeState === "charging" ? "CHARGING" : "STARTING TO CHARGE",
						tone: "text-good",
					}
				: { icon: <BoltOffIcon />, headline: "NOT CHARGING", tone: "text-ink-dim" };
	const { headline, tone } = status;

	const { limits: l } = state;
	// force_off produces an "off" decision, which never reaches the SOC gate, so
	// only a "charge now" actually suspends it.
	const overriddenOn = state.override?.mode === "force_on";

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

			<Dialog open={why} title={`Why is it ${headlineVerb(headline)}?`} onClose={() => setWhy(false)}>
				<p className="text-lg leading-snug text-ink">
					{waiting
						? "The charger is on, but nothing is drawing from it — plug the cable into the car."
						: full
							? "The car has finished and stopped drawing. The charger stays on until the override or window ends."
							: (d?.reason ?? "No reading yet.")}
				</p>

				{/* The thresholds the sentence above was measured against, so the
				    numbers in it can be checked rather than taken on trust. */}
				<dl className="mt-5 space-y-2 border-t border-hairline pt-4 text-base">
					<Fact term="Window" value={windowDetail(d?.window, l)} />
					<Fact term="Grid limit" value={power(l.mainSwitchLimitW)} />
					<Fact term="Car charger" value={power(l.carPowerW)} />
					<Fact term="Solar rule" value={`needs ${Math.round(l.solarCoverRatio * 100)}% of house + car`} />
					{/*
					  * A start threshold, not a ceiling - and a "charge now" override
					  * ignores it. The old wording ("stop car at 80%") described a rule
					  * that no longer exists, and during an override one that was
					  * switched off anyway.
					  */}
					<Fact
						term="Auto-start when car is"
						value={
							overriddenOn
								? `${l.carStartMaxSoc}% or less · not while overriding`
								: `${l.carStartMaxSoc}% or less`
						}
					/>
					<Fact
						term="Charges up to"
						value={state.car?.chargeLimit != null ? `${state.car.chargeLimit}% (car's own limit)` : "the car's own limit"}
					/>
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

/**
 * The notices that come and go: an active override, a lost connection, a read
 * failure.
 *
 * These live *over* the illustration rather than inside the header, and that is
 * the whole point. In the header each one added a line, which shortened the
 * space left for the scene - and the scene sizes its frame to the space it is
 * given, so an override appearing made the whole illustration visibly shrink.
 * Floating them costs no layout, so nothing moves when they arrive or go.
 *
 * The top of the scene is empty sky, so there is nothing underneath to obscure.
 */
export function StatusNotices({ state, connection }: { state: DashboardState; connection: Connection }) {
	const override = state.override;
	const offline = connection !== "live";
	const error = state.errors[0];
	if (!override && !offline && !error) return null;

	return (
		<div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-start gap-2 px-6 pt-1">
			{override && (
				<p className="rounded-full bg-surface/95 px-4 py-1 text-lg text-warning">
					manual override · {countdown(override.until)}
					{override.releaseWhenDone && " · or until the car is full"}
				</p>
			)}
			{offline && (
				<p className="rounded-full bg-surface/95 px-4 py-1 text-lg text-serious">
					{connection === "offline" ? "reconnecting to the daemon…" : "connecting…"}
				</p>
			)}
			{error && <p className="rounded-full bg-surface/95 px-4 py-1 text-base text-serious">{error}</p>}
		</div>
	);
}
