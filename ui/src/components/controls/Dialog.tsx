import { type ReactNode, useEffect, useRef } from "react";

interface Props {
	open: boolean;
	title: string;
	/** One line of context under the title. */
	description?: string;
	children?: ReactNode;
	confirmLabel: string;
	onConfirm: () => void;
	onClose: () => void;
	confirmDisabled?: boolean;
	busy?: boolean;
	error?: string | null;
	/** Marks the confirm button as a consequential action. */
	tone?: "default" | "critical";
}

/**
 * The one dialog in the app.
 *
 * Every prompt goes through here - the PIN, the hour pickers, the confirmation
 * for waking the car - so they share their layout, focus handling, dismissal and
 * error line rather than each growing its own. New controls should reuse it too;
 * the only thing they supply is a title and whatever sits in the body.
 */
export function Dialog({
	open,
	title,
	description,
	children,
	confirmLabel,
	onConfirm,
	onClose,
	confirmDisabled = false,
	busy = false,
	error = null,
	tone = "default",
}: Props) {
	const panel = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		// Move focus in, so a keyboard or screen-reader user lands on the dialog.
		panel.current?.querySelector<HTMLElement>("input,button")?.focus();
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
			<div className="absolute inset-0 bg-black/55 animate-[fade-in_160ms_ease-out]" onClick={onClose} aria-hidden />

			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="relative m-4 w-full max-w-md rounded-3xl border border-hairline bg-surface p-6 shadow-2xl animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)]"
			>
				<h2 className="text-2xl font-bold text-ink">{title}</h2>
				{description && <p className="mt-1.5 text-base leading-snug text-ink-dim">{description}</p>}

				{children && <div className="mt-5">{children}</div>}

				{error && <p className="mt-4 text-base font-medium text-critical">{error}</p>}

				<div className="mt-6 flex gap-3">
					<button
						type="button"
						onClick={onClose}
						className="flex-1 rounded-2xl bg-page px-4 py-3.5 text-lg font-medium text-ink-dim active:bg-hairline"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={confirmDisabled || busy}
						className={`flex-1 rounded-2xl px-4 py-3.5 text-lg font-semibold text-white disabled:opacity-40 ${
							tone === "critical" ? "bg-critical" : "bg-good"
						}`}
					>
						{busy ? "Working…" : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
