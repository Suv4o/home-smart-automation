import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DashboardState } from "../../lib/types.ts";
import { AutoIcon, BoltIcon, CarIcon, LockedIcon, LockUnknownIcon, PauseIcon, UnlockedIcon } from "../icons.tsx";
import { Dialog } from "./Dialog.tsx";
import {
	clampHours,
	HALF_VH,
	HANDLE_PX,
	HOURS_DEFAULT,
	HOURS_MAX,
	HOURS_MIN,
	hoursLabel,
	nextStage,
	PANEL_VH,
	panelOffset,
	type Stage,
	swipeDirection,
} from "./sheet.ts";

const TOKEN_KEY = "dashboard-token";
const CAR_HINT = "Reaching the car over Bluetooth. If it is asleep this can take up to a minute.";
const PLUG_HINT = "Reading the meter and switching the plug.";
type Mode = "force_on" | "force_off";

/**
 * An action and the words to describe it while it runs.
 *
 * The copy is part of the action rather than the button, because the wait is
 * where it is needed: a car command can take a minute and a half (a 30s BLE
 * timeout, three attempts, plus wake settles), and the override endpoint runs a
 * whole decision tick before it answers. A bare spinner for that long looks like
 * a hang.
 */
interface Action {
	path: string;
	method: string;
	body?: unknown;
	/** Present tense, shown while it runs: "Unlocking the car". */
	label: string;
	/** Shown on success: "Car unlocked". */
	done: string;
	/** Why this one might take a while. Shown once the wait gets noticeable. */
	hint?: string;
	/** Drop back to the dashboard afterwards, when the result shows there. */
	closeOnSuccess?: boolean;
}

interface Job extends Action {
	startedAt: number;
}

interface Sent {
	ok: boolean;
	status: number;
	message: string;
}

/**
 * Longer than the slowest thing the daemon can legitimately do: a car command is
 * a 30s Bluetooth timeout times three attempts, plus wake settles. The point is
 * not to cut work short but to guarantee the request always settles - without
 * it, a dropped Wi-Fi link would leave the progress overlay spinning forever
 * with no way past it.
 */
const REQUEST_TIMEOUT_MS = 120_000;

async function send(path: string, method: string, body: unknown, token: string): Promise<Sent> {
	const abort = new AbortController();
	const timer = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
	try {
		const res = await fetch(path, {
			method,
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: body ? JSON.stringify(body) : undefined,
			signal: abort.signal,
		});
		if (res.ok) return { ok: true, status: res.status, message: "" };
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		return { ok: false, status: res.status, message: j.error ?? `HTTP ${res.status}` };
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") {
			return { ok: false, status: 0, message: "Gave up waiting for the daemon to answer." };
		}
		return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
	} finally {
		window.clearTimeout(timer);
	}
}

/**
 * The manual controls, as a sheet that slides up over the illustration.
 *
 * Three things shape it. It **floats** rather than taking layout space, so
 * opening it never squashes the scene. It opens in **two steps** - a peek, then
 * the full panel - so a glance at the controls doesn't have to cover the
 * dashboard. And there is **no PIN field on the surface**: the PIN is asked for
 * in a dialog at the moment an action needs it, which keeps the resting state
 * clean and means the field isn't sitting on a living-room wall all day.
 *
 * Actions are grouped into sections with room to grow - locking the car, ending
 * a charge and so on are expected to land here later.
 */
export function ControlSheet({ state, onDone }: { state: DashboardState; onDone: () => void }) {
	const locked = state.car?.locked ?? null;
	const [stage, setStage] = useState<Stage>("closed");
	const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [job, setJob] = useState<Job | null>(null);
	const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

	const [hoursFor, setHoursFor] = useState<Mode | null>(null);
	const [hours, setHours] = useState(HOURS_DEFAULT);
	const [releaseWhenDone, setReleaseWhenDone] = useState(false);
	const [scheduled, setScheduled] = useState(false);
	const [startAt, setStartAt] = useState("22:00");
	const [askCar, setAskCar] = useState(false);
	const [askUnlock, setAskUnlock] = useState(false);
	const [pinOpen, setPinOpen] = useState(false);
	const [pin, setPin] = useState("");
	const pending = useRef<((token: string) => Promise<void>) | null>(null);
	const dragFrom = useRef<number | null>(null);

	const perform = async (action: Action, tok: string): Promise<void> => {
		setBusy(true);
		setError(null);
		setOutcome(null);
		setJob({ ...action, startedAt: Date.now() });

		const res = await send(action.path, action.method, action.body, tok);

		setBusy(false);
		setJob(null);

		if (res.ok) {
			localStorage.setItem(TOKEN_KEY, tok);
			setToken(tok);
			setPinOpen(false);
			setPin("");
			setOutcome({ ok: true, text: action.done });
			onDone();
			// Let the confirmation land before anything moves. Actions whose result
			// is visible on the dashboard then get out of the way; ones you read in
			// the sheet itself - the padlock - stay put so you can see them flip.
			window.setTimeout(() => {
				setOutcome(null);
				if (action.closeOnSuccess) setStage("closed");
			}, 1100);
			return;
		}
		if (res.status === 401) {
			// A stored PIN that the daemon no longer accepts: drop it and ask again
			// rather than failing silently on every later tap.
			localStorage.removeItem(TOKEN_KEY);
			setToken("");
			pending.current = (t) => perform(action, t);
			setPin("");
			setPinOpen(true);
			setError("That PIN wasn't accepted.");
			return;
		}
		setOutcome({ ok: false, text: res.message });
	};

	/** Run an action, collecting the PIN first if we don't have one yet. */
	const act = (action: Action): void => {
		setError(null);
		if (!token) {
			pending.current = (t) => perform(action, t);
			setPin("");
			setPinOpen(true);
			return;
		}
		void perform(action, token);
	};

	const move = (dir: "up" | "down"): void => setStage((s) => nextStage(s, dir));
	const onTouchStart = (e: React.TouchEvent): void => {
		dragFrom.current = e.touches[0]?.clientY ?? null;
	};
	const onTouchEnd = (e: React.TouchEvent): void => {
		const from = dragFrom.current;
		dragFrom.current = null;
		if (from === null) return;
		const dir = swipeDirection((e.changedTouches[0]?.clientY ?? from) - from);
		if (dir) move(dir);
	};

	return (
		<>
			{/* Scrim. Present only when open, so the resting dashboard is untouched. */}
			<div
				onClick={() => setStage("closed")}
				aria-hidden
				className="fixed inset-0 z-30 bg-black/40 transition-opacity duration-300"
				style={{
					opacity: stage === "closed" ? 0 : 1,
					pointerEvents: stage === "closed" ? "none" : "auto",
					touchAction: "none",
				}}
			/>

			<div
				className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-3xl border-t border-hairline bg-surface"
				style={{
					height: `${PANEL_VH}vh`,
					transform: `translateY(${panelOffset(stage)})`,
					transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
				}}
			>
				<button
					type="button"
					onClick={() => move(stage === "full" ? "down" : "up")}
					aria-label={stage === "closed" ? "Open controls" : "Resize controls"}
					aria-expanded={stage !== "closed"}
					className="flex w-full shrink-0 items-center justify-center active:bg-hairline"
					// `touch-action: none` is what stops the page moving underneath. Without
					// it the browser treats the same drag as a scroll and runs its own
					// overscroll animation alongside ours, which is the shudder you see.
					style={{ height: HANDLE_PX, touchAction: "none" }}
					onTouchStart={onTouchStart}
					onTouchEnd={onTouchEnd}
				>
					<Chevron pointsDown={stage === "full"} />
				</button>

				<Progress job={job} outcome={outcome} stage={stage} onDismiss={() => setOutcome(null)} />

				<div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto px-5 pb-8" style={{ overscrollBehavior: "contain" }}>
					<Section title="Charging">
						<Tile
							icon={<BoltIcon />}
							label="Charge"
							hint={`for ${hoursLabel(HOURS_DEFAULT)}`}
							onClick={() => {
								setHours(HOURS_DEFAULT);
								setReleaseWhenDone(false);
								setScheduled(false);
								setHoursFor("force_on");
							}}
						/>
						<Tile
							icon={<PauseIcon />}
							label="Pause"
							hint={`for ${hoursLabel(HOURS_DEFAULT)}`}
							onClick={() => {
								setHours(HOURS_DEFAULT);
								setScheduled(false);
								setHoursFor("force_off");
							}}
						/>
						<Tile
							icon={<AutoIcon />}
							label="Automatic"
							hint={state.override ? "cancel the override" : "already automatic"}
							disabled={!state.override}
							onClick={() =>
								act({
									path: "/api/override",
									method: "DELETE",
									label: "Handing back to the schedule",
									done: "Back to automatic",
									hint: PLUG_HINT,
									closeOnSuccess: true,
								})
							}
						/>
					</Section>

					<Section title="Car">
						{/*
						 * One button for both directions. It shows the state we were last
						 * told and asks for the opposite - and because the request names
						 * the end state rather than "toggle", a reading that has gone
						 * stale behind our back cannot make it do the wrong thing.
						 */}
						<Tile
							icon={locked === null ? <LockUnknownIcon /> : locked ? <LockedIcon /> : <UnlockedIcon />}
							label={locked === false ? "Lock" : locked ? "Unlock" : "Lock"}
							hint={locked === null ? "lock state unknown" : locked ? "car is locked" : "car is unlocked"}
							onClick={() => {
								// Locking is harmless; unlocking a car from a wall tablet
								// deserves a deliberate second tap.
								if (locked === true) setAskUnlock(true);
								else
									act({
										path: "/api/car/lock",
										method: "POST",
										body: { locked: true },
										label: "Locking the car",
										done: "Car locked",
										hint: CAR_HINT,
									});
							}}
						/>
						<Tile icon={<CarIcon />} label="Check now" hint="wakes the car" onClick={() => setAskCar(true)} />
					</Section>

					{error && !pinOpen && <p className="mt-5 text-base font-medium text-critical">{error}</p>}
				</div>
			</div>

			{/* How long to hold the override for. */}
			<Dialog
				open={hoursFor !== null}
				title={hoursFor === "force_off" ? "Pause charging" : "Charge the car"}
				description={
					hoursFor === "force_off"
						? "Holds the charger off, then hands back to the automatic schedule."
						: "Charges regardless of the schedule. The breaker limit still applies."
				}
				confirmLabel={hoursFor === "force_off" ? "Pause" : "Charge"}
				tone={hoursFor === "force_off" ? "critical" : "default"}
				busy={busy}
				onClose={() => setHoursFor(null)}
				onConfirm={() => {
					const mode = hoursFor;
					setHoursFor(null);
					if (mode) {
						const charging = mode === "force_on";
						act({
							path: "/api/override",
							method: "POST",
							body: {
								mode,
								hours: clampHours(hours),
								// Only meaningful when charging; a pause has nothing to finish.
								releaseWhenDone: charging && releaseWhenDone,
							},
							// Only sent when asked for; otherwise the server starts it now.
							...(scheduled ? { startAt } : {}),
							label: scheduled
								? charging
									? `Scheduling a charge for ${startAt}`
									: `Scheduling a pause for ${startAt}`
								: charging
									? "Starting the charge"
									: "Pausing charging",
							done: scheduled
								? `${charging ? "Charging" : "Paused"} at ${startAt} for ${hoursLabel(hours)}`
								: charging
									? `Charging for ${hoursLabel(hours)}`
									: `Paused for ${hoursLabel(hours)}`,
							hint: PLUG_HINT,
							closeOnSuccess: true,
						});
					}
				}}
			>
				<HoursSlider hours={hours} onChange={setHours} />

				{/* Scheduling applies to both directions: "charge from 22:00" and
				    "pause from 16:00" are equally useful. */}
				<Check
					checked={scheduled}
					onChange={setScheduled}
					label="Start at a set time"
					hint={
						scheduled
							? `Begins at ${startAt} and runs for ${hoursLabel(hours)}. Until then the normal schedule is in charge.`
							: "Otherwise it starts straight away."
					}
				>
					<input
						type="time"
						value={startAt}
						onChange={(e) => setStartAt(e.target.value)}
						onClick={(e) => e.stopPropagation()}
						className="mt-3 w-full rounded-2xl bg-surface px-4 py-3 text-center text-2xl font-semibold tabular-nums text-ink outline-none focus:ring-2 focus:ring-good"
					/>
				</Check>

				{hoursFor === "force_on" && (
					<Check
						checked={releaseWhenDone}
						onChange={setReleaseWhenDone}
						label="Stop early when the car is full"
						hint="Hands back to the schedule as soon as the car stops charging, instead of holding the charger on for the rest of the time."
					/>
				)}
			</Dialog>

			<Dialog
				open={askCar}
				title="Check the car now?"
				description="Reading the battery wakes the car over Bluetooth. The dashboard otherwise only ever shows a cached figure."
				confirmLabel="Check now"
				busy={busy}
				onClose={() => setAskCar(false)}
				onConfirm={() => {
					setAskCar(false);
					act({
						path: "/api/car/refresh",
						method: "POST",
						label: "Waking the car",
						done: "Car reading updated",
						hint: CAR_HINT,
					});
				}}
			/>

			<Dialog
				open={askUnlock}
				title="Unlock the car?"
				description="It will stay unlocked until you lock it again, or the car locks itself."
				confirmLabel="Unlock"
				tone="critical"
				busy={busy}
				onClose={() => setAskUnlock(false)}
				onConfirm={() => {
					setAskUnlock(false);
					act({
						path: "/api/car/lock",
						method: "POST",
						body: { locked: false },
						label: "Unlocking the car",
						done: "Car unlocked",
						hint: CAR_HINT,
					});
				}}
			/>

			<Dialog
				open={pinOpen}
				title="Enter your PIN"
				description="These controls switch a real 2kW load, so they're behind a PIN."
				confirmLabel="Confirm"
				confirmDisabled={pin.trim() === ""}
				busy={busy}
				error={error}
				onClose={() => {
					setPinOpen(false);
					pending.current = null;
					setError(null);
				}}
				onConfirm={() => {
					const run = pending.current;
					if (run) void run(pin.trim());
				}}
			>
				<input
					type="password"
					inputMode="numeric"
					autoComplete="off"
					value={pin}
					onChange={(e) => setPin(e.target.value)}
					placeholder="PIN"
					className="w-full rounded-2xl bg-page px-4 py-3.5 text-center text-2xl tracking-[0.4em] text-ink outline-none focus:ring-2 focus:ring-good"
				/>
			</Dialog>
		</>
	);
}

function HoursSlider({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
	return (
		<div>
			<div className="mb-3 text-center text-4xl font-bold text-ink">{hoursLabel(hours)}</div>
			<input
				type="range"
				min={HOURS_MIN}
				max={HOURS_MAX}
				step={1}
				value={hours}
				onChange={(e) => onChange(clampHours(Number(e.target.value)))}
				className="h-2 w-full cursor-pointer appearance-none rounded-full bg-page accent-good"
			/>
			<div className="mt-2 flex justify-between text-sm text-muted">
				<span>{HOURS_MIN}h</span>
				<span>{HOURS_MAX}h</span>
			</div>
		</div>
	);
}

/**
 * What the sheet shows while an action is in flight, and just after.
 *
 * It covers the controls deliberately. Beyond telling you something is
 * happening, it stops a second command being fired into a Bluetooth link that is
 * still busy with the first - the tiles used to stay live throughout, so two
 * overlapping car commands were a tap away.
 *
 * The seconds counter matters more than the spinner: these waits are long enough
 * that a spinner alone reads as a hang, and a number that keeps moving is proof
 * the thing is alive. The explanation only appears once the wait is long enough
 * to need one, so quick actions stay quiet.
 */
function Progress({
	job,
	outcome,
	stage,
	onDismiss,
}: {
	job: Job | null;
	outcome: { ok: boolean; text: string } | null;
	stage: Stage;
	onDismiss: () => void;
}) {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!job) return;
		setElapsed(0);
		const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - job.startedAt) / 1000)), 250);
		return () => window.clearInterval(id);
	}, [job]);

	if (!job && !outcome) return null;

	return (
		<div
			className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-surface/95 px-8 text-center"
			role="status"
			aria-live="polite"
			// The panel is taller than the screen when only half open, so centring on
			// the panel would push this below the fold. Pad out the hidden part and
			// it centres on what you can actually see, at either height.
			style={{
				touchAction: "none",
				paddingBottom: stage === "half" ? `${PANEL_VH - HALF_VH}vh` : undefined,
			}}
		>
			{job && (
				<>
					<Spinner />
					<p className="text-2xl font-semibold text-ink">{job.label}…</p>
					{/* Only start counting once it is slow enough to be worth saying. */}
					{elapsed >= 2 && <p className="text-lg tabular-nums text-muted">{elapsed}s</p>}
					{job.hint && elapsed >= 5 && <p className="max-w-sm text-base leading-snug text-ink-dim">{job.hint}</p>}
				</>
			)}

			{outcome && (
				<>
					<Verdict ok={outcome.ok} />
					<p className={`text-2xl font-semibold ${outcome.ok ? "text-good" : "text-critical"}`}>{outcome.text}</p>
					{!outcome.ok && (
						<button
							type="button"
							onClick={onDismiss}
							className="mt-2 rounded-2xl bg-page px-6 py-3 text-lg font-semibold text-ink active:bg-hairline"
						>
							Close
						</button>
					)}
				</>
			)}
		</div>
	);
}

function Spinner() {
	return (
		<svg width="46" height="46" viewBox="0 0 24 24" fill="none" className="animate-spin text-good" aria-hidden>
			<circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
			<path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
		</svg>
	);
}

function Verdict({ ok }: { ok: boolean }) {
	return (
		<svg
			width="46"
			height="46"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={ok ? "text-good" : "text-critical"}
			aria-hidden
		>
			<circle cx="12" cy="12" r="9.5" />
			{ok ? <path d="M7.8 12.4l2.9 2.9 5.5-5.9" /> : <path d="M12 7.5v5.2M12 16.4h.01" />}
		</svg>
	);
}

function Check({
	checked,
	onChange,
	label,
	hint,
	children,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
	hint?: string;
	/** Revealed only when ticked - a control for a setting that is switched off
	    is just something else to mis-tap. */
	children?: ReactNode;
}) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className="mt-5 flex w-full items-start gap-3 rounded-2xl border border-hairline bg-page p-4 text-left active:bg-hairline"
		>
			<span
				className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 ${
					checked ? "border-good bg-good" : "border-hairline"
				}`}
			>
				{checked && (
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
						<path d="M5 13l4 4L19 7" />
					</svg>
				)}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-lg font-medium leading-tight text-ink">{label}</span>
				{hint && <span className="mt-1 block text-sm leading-snug text-muted">{hint}</span>}
				{checked && children}
			</span>
		</button>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-5 first:mt-1">
			<h3 className="mb-2.5 text-sm font-semibold uppercase tracking-wider text-muted">{title}</h3>
			<div className="grid grid-cols-2 gap-3">{children}</div>
		</section>
	);
}

function Tile({
	icon,
	label,
	hint,
	disabled = false,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	hint?: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="flex flex-col items-start gap-2 rounded-2xl border border-hairline bg-page p-4 text-left disabled:opacity-40 active:bg-hairline"
		>
			<span className="text-ink-dim">{icon}</span>
			<span className="text-lg font-semibold leading-tight text-ink">{label}</span>
			{hint && <span className="text-sm leading-tight text-muted">{hint}</span>}
		</button>
	);
}

function Chevron({ pointsDown }: { pointsDown: boolean }) {
	return (
		<svg
			width="34"
			height="34"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
			className="text-muted transition-transform duration-300"
			style={{ transform: pointsDown ? "rotate(180deg)" : "none" }}
		>
			<path d="M6 14l6-6 6 6" />
		</svg>
	);
}
