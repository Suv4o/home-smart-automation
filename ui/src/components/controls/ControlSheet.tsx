import { type ReactNode, useRef, useState } from "react";
import type { DashboardState } from "../../lib/types.ts";
import { AutoIcon, BoltIcon, CarIcon, LockedIcon, LockUnknownIcon, PauseIcon, UnlockedIcon } from "../icons.tsx";
import { Dialog } from "./Dialog.tsx";
import {
	clampHours,
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
type Mode = "force_on" | "force_off";

interface Sent {
	ok: boolean;
	status: number;
	message: string;
}

async function send(path: string, method: string, body: unknown, token: string): Promise<Sent> {
	try {
		const res = await fetch(path, {
			method,
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: body ? JSON.stringify(body) : undefined,
		});
		if (res.ok) return { ok: true, status: res.status, message: "" };
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		return { ok: false, status: res.status, message: j.error ?? `HTTP ${res.status}` };
	} catch (e) {
		return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
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

	const [hoursFor, setHoursFor] = useState<Mode | null>(null);
	const [hours, setHours] = useState(HOURS_DEFAULT);
	const [releaseWhenDone, setReleaseWhenDone] = useState(false);
	const [askCar, setAskCar] = useState(false);
	const [askUnlock, setAskUnlock] = useState(false);
	const [pinOpen, setPinOpen] = useState(false);
	const [pin, setPin] = useState("");
	const pending = useRef<((token: string) => Promise<void>) | null>(null);
	const dragFrom = useRef<number | null>(null);

	const perform = async (path: string, method: string, body: unknown, tok: string): Promise<void> => {
		setBusy(true);
		setError(null);
		const res = await send(path, method, body, tok);
		setBusy(false);

		if (res.ok) {
			localStorage.setItem(TOKEN_KEY, tok);
			setToken(tok);
			setPinOpen(false);
			setPin("");
			// Close up, so the change is visible on the dashboard behind.
			setStage("closed");
			onDone();
			return;
		}
		if (res.status === 401) {
			// A stored PIN that the daemon no longer accepts: drop it and ask again
			// rather than failing silently on every later tap.
			localStorage.removeItem(TOKEN_KEY);
			setToken("");
			pending.current = (t) => perform(path, method, body, t);
			setPin("");
			setPinOpen(true);
			setError("That PIN wasn't accepted.");
			return;
		}
		setError(res.message);
	};

	/** Run an action, collecting the PIN first if we don't have one yet. */
	const act = (path: string, method: string, body?: unknown): void => {
		setError(null);
		if (!token) {
			pending.current = (t) => perform(path, method, body, t);
			setPin("");
			setPinOpen(true);
			return;
		}
		void perform(path, method, body, token);
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
				}}
			/>

			<div
				className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-3xl border-t border-hairline bg-surface"
				style={{
					height: `${PANEL_VH}vh`,
					transform: `translateY(${panelOffset(stage)})`,
					transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
				}}
				onTouchStart={onTouchStart}
				onTouchEnd={onTouchEnd}
			>
				<button
					type="button"
					onClick={() => move(stage === "full" ? "down" : "up")}
					aria-label={stage === "closed" ? "Open controls" : "Resize controls"}
					aria-expanded={stage !== "closed"}
					className="flex w-full shrink-0 items-center justify-center active:bg-hairline"
					style={{ height: HANDLE_PX }}
				>
					<Chevron pointsDown={stage === "full"} />
				</button>

				<div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto px-5 pb-8">
					<Section title="Charging">
						<Tile
							icon={<BoltIcon />}
							label="Charge"
							hint={`for ${hoursLabel(HOURS_DEFAULT)}`}
							onClick={() => {
								setHours(HOURS_DEFAULT);
								setReleaseWhenDone(false);
								setHoursFor("force_on");
							}}
						/>
						<Tile
							icon={<PauseIcon />}
							label="Pause"
							hint={`for ${hoursLabel(HOURS_DEFAULT)}`}
							onClick={() => {
								setHours(HOURS_DEFAULT);
								setHoursFor("force_off");
							}}
						/>
						<Tile
							icon={<AutoIcon />}
							label="Automatic"
							hint={state.override ? "cancel the override" : "already automatic"}
							disabled={!state.override}
							onClick={() => act("/api/override", "DELETE")}
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
								else act("/api/car/lock", "POST", { locked: true });
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
						act("/api/override", "POST", {
							mode,
							hours: clampHours(hours),
							// Only meaningful when charging; a pause has nothing to finish.
							releaseWhenDone: mode === "force_on" && releaseWhenDone,
						});
					}
				}}
			>
				<HoursSlider hours={hours} onChange={setHours} />
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
					act("/api/car/refresh", "POST");
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
					act("/api/car/lock", "POST", { locked: false });
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

function Check({
	checked,
	onChange,
	label,
	hint,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
	hint?: string;
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
			<span>
				<span className="block text-lg font-medium leading-tight text-ink">{label}</span>
				{hint && <span className="mt-1 block text-sm leading-snug text-muted">{hint}</span>}
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
