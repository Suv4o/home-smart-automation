import { useState } from "react";
import type { DashboardState } from "../lib/types.ts";

const TOKEN_KEY = "dashboard-token";

/**
 * Manual controls. These switch a real 2kW load, so every call carries the
 * token, and every override expires on its own - a forgotten tap must not
 * strand the system.
 */
export function OverrideSheet({ state, onDone }: { state: DashboardState; onDone: () => void }) {
	const [open, setOpen] = useState(false);
	const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const call = async (path: string, method: string, body?: unknown): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(path, {
				method,
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
				body: body ? JSON.stringify(body) : undefined,
			});
			if (!res.ok) {
				const j = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(j.error ?? `HTTP ${res.status}`);
			}
			localStorage.setItem(TOKEN_KEY, token);
			onDone();
			setOpen(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="w-full bg-surface py-4 text-xl font-semibold text-ink-dim active:bg-hairline"
			>
				Controls
			</button>
		);
	}

	return (
		<div className="bg-surface px-5 py-5">
			<div className="mb-4 flex items-center justify-between">
				<h2 className="text-2xl font-semibold">Controls</h2>
				<button type="button" onClick={() => setOpen(false)} className="text-xl text-muted">
					close
				</button>
			</div>

			<input
				type="password"
				inputMode="numeric"
				value={token}
				onChange={(ev) => setToken(ev.target.value)}
				placeholder="PIN"
				className="mb-4 w-full rounded-lg bg-page px-4 py-3 text-xl text-ink outline-none"
			/>

			<div className="grid grid-cols-2 gap-3">
				<Action label="Charge for 2h" disabled={busy} onClick={() => call("/api/override", "POST", { mode: "force_on", hours: 2 })} />
				<Action label="Pause for 2h" disabled={busy} onClick={() => call("/api/override", "POST", { mode: "force_off", hours: 2 })} />
				<Action label="Back to automatic" disabled={busy || !state.override} onClick={() => call("/api/override", "DELETE")} />
				<Action label="Check car now" hint="wakes the car" disabled={busy} onClick={() => call("/api/car/refresh", "POST")} />
			</div>

			{error && <p className="mt-4 text-lg text-critical">{error}</p>}
		</div>
	);
}

function Action({ label, hint, disabled, onClick }: { label: string; hint?: string; disabled: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="rounded-xl bg-page px-4 py-5 text-lg font-medium text-ink disabled:opacity-40 active:bg-hairline"
		>
			{label}
			{hint && <span className="mt-1 block text-sm font-normal text-muted">{hint}</span>}
		</button>
	);
}
