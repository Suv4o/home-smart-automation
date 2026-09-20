import { useEffect } from "react";
import { useLiveState } from "./hooks/useLiveState.ts";
import { useWakeLock } from "./hooks/useWakeLock.ts";
import { HouseScene } from "./components/HouseScene.tsx";
import { ControlSheet } from "./components/controls/ControlSheet.tsx";
import { handleTotal } from "./components/controls/sheet.ts";
import { StatStrip } from "./components/StatStrip.tsx";
import { StatusBanner, StatusNotices } from "./components/StatusBanner.tsx";
import { skyPalette } from "./components/scene/palette.ts";

export default function App() {
	const { state, connection } = useLiveState();
	useWakeLock();

	// Theme the whole page from the sky, so the chrome and the illustration agree.
	//
	// The chrome takes its colours from the *same* interpolated palette the scene
	// uses rather than from a fixed per-phase block. Dawn is the case that proved
	// this matters: at 58% daylight the illustration is already bright while a
	// hard-coded dusk block kept the banner and stat strip night-dark, and the two
	// halves of the screen visibly disagreed. `data-phase` is still set, for the
	// few rules that want a hard switch.
	const phase = state?.sky.phase ?? "night";
	const daylight = state?.sky.daylight ?? 0;
	useEffect(() => {
		const root = document.documentElement;
		root.dataset["phase"] = phase;
		const p = skyPalette(daylight);
		// Keep the installed app's own chrome on the same clock as the page. iOS
		// tints the status-bar area from this, and index.html can only declare one
		// value - night navy - which is wrong for most of the day.
		document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p.page);
		for (const [name, value] of [
			["page", p.page],
			["surface", p.surface],
			["ink", p.ink],
			["ink-dim", p.inkDim],
			["muted", p.muted],
			["hairline", p.hairline],
			["good", p.flowGood],
			["warning", p.flowWarning],
			["critical", p.flowCritical],
			["battery", p.flowBattery],
		] as const) {
			root.style.setProperty(`--color-${name}`, value);
		}
	}, [phase, daylight]);

	if (!state) {
		return (
			<div className="flex h-full items-center justify-center text-2xl text-muted">
				{connection === "offline" ? "can't reach the daemon" : "connecting…"}
			</div>
		);
	}

	return (
		/*
		 * index.html asks for `viewport-fit=cover` and a translucent status bar, so
		 * iOS runs the page edge to edge - underneath the clock and signal icons at
		 * the top, and the home indicator at the bottom. That is the right choice
		 * for an illustration that should reach the corners, but it means the insets
		 * are ours to apply. Without these the header collides with the status bar.
		 *
		 * Every one of them is 0px on Android, on the kiosk tablet and in a desktop
		 * browser, so this changes nothing anywhere else. The sheet is `fixed` and
		 * so is not affected by this padding - it handles its own insets.
		 */
		<div
			className="flex h-full flex-col bg-page"
			style={{
				paddingTop: "env(safe-area-inset-top, 0px)",
				paddingLeft: "env(safe-area-inset-left, 0px)",
				paddingRight: "env(safe-area-inset-right, 0px)",
			}}
		>
			<StatusBanner state={state} connection={connection} />
			{/*
			  * Stacked in portrait; side by side on a phone in landscape.
			  *
			  * The illustration's frame is 535x580 - taller than it is wide. Stacked
			  * in landscape it was handed a 612x120 slot, and `meet` scales to the
			  * limiting dimension, so the house drew at 111x120 with ~500px of empty
			  * gutter either side. Moving the four figures into a column down the
			  * right gives the scene a squarer box and roughly 2.7x the size, without
			  * shrinking a single glyph.
			  */}
			<div className="flex min-h-0 flex-1 flex-col landscape-phone:flex-row">
				{/* `relative` so the notices can float over the scene instead of taking
				    layout space above it - see StatusNotices for why that matters. */}
				<main className="relative min-h-0 min-w-0 flex-1">
					<StatusNotices state={state} connection={connection} />
					<HouseScene state={state} />
				</main>
				<StatStrip state={state} />
			</div>
			{/* Reserves the strip of screen the collapsed handle occupies. The sheet
			    itself is fixed, so opening it slides over the scene instead of
			    shrinking it. */}
			<div style={{ height: handleTotal() }} aria-hidden />
			<ControlSheet state={state} onDone={() => undefined} />
		</div>
	);
}
