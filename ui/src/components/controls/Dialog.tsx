import { type ReactNode, useEffect, useRef } from "react";

interface Props {
	open: boolean;
	title: string;
	/** One line of context under the title. */
	description?: string;
	children?: ReactNode;
	/**
	 * Omit both to get an information-only dialog: no choice to make, so it
	 * closes with a single button instead of offering Cancel and Confirm.
	 */
	confirmLabel?: string;
	onConfirm?: () => void;
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

			{/*
			  * Three bands: the title and the buttons are pinned, and only the body
			  * between them scrolls.
			  *
			  * The panel used to size itself to its content with no ceiling, which is
			  * fine for a PIN prompt and not at all fine for the weather dialog - two
			  * bar charts and a paragraph ran off the bottom of a phone screen, taking
			  * Cancel and Confirm with them and leaving no way to answer or dismiss
			  * it. Scrolling the whole panel would have been the easier fix and the
			  * worse one: the buttons would still have to be hunted for.
			  */}
			<div
				ref={panel}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="relative m-4 flex w-full max-w-md flex-col rounded-3xl border border-hairline bg-surface p-6 shadow-2xl animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)]"
				style={{
					// The m-4 above, plus whatever iOS reserves top and bottom.
					maxHeight:
						"calc(100 * var(--vh-unit) - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
				}}
			>
				<h2 className="shrink-0 text-2xl font-bold text-ink">{title}</h2>
				{description && <p className="mt-1.5 shrink-0 text-base leading-snug text-ink-dim">{description}</p>}

				{children && (
					<div className="-mx-1 mt-5 min-h-0 flex-1 overflow-y-auto px-1" style={{ overscrollBehavior: "contain" }}>
						{children}
					</div>
				)}

				{error && <p className="mt-4 shrink-0 text-base font-medium text-critical">{error}</p>}

				<div className="mt-6 flex shrink-0 gap-3">
					<button
						type="button"
						onClick={onClose}
						className={
							onConfirm
								? "flex-1 rounded-2xl bg-page px-4 py-3.5 text-lg font-medium text-ink-dim active:bg-hairline"
								: "flex-1 rounded-2xl bg-page px-4 py-3.5 text-lg font-semibold text-ink active:bg-hairline"
						}
					>
						{onConfirm ? "Cancel" : "Close"}
					</button>
					{onConfirm && (
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
					)}
				</div>
			</div>
		</div>
	);
}
