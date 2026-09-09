import { useEffect } from "react";
import { useLiveState } from "./hooks/useLiveState.ts";
import { useWakeLock } from "./hooks/useWakeLock.ts";
import { HouseScene } from "./components/HouseScene.tsx";
import { ControlSheet } from "./components/controls/ControlSheet.tsx";
import { HANDLE_PX } from "./components/controls/sheet.ts";
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
		<div className="flex h-full flex-col bg-page">
			<StatusBanner state={state} connection={connection} />
			{/* `relative` so the notices can float over the scene instead of taking
			    layout space above it - see StatusNotices for why that matters. */}
			<main className="relative min-h-0 flex-1">
				<StatusNotices state={state} connection={connection} />
				<HouseScene state={state} />
			</main>
			<StatStrip state={state} />
			{/* Reserves the strip of screen the collapsed handle occupies. The sheet
			    itself is fixed, so opening it slides over the scene instead of
			    shrinking it. */}
			<div style={{ height: HANDLE_PX }} aria-hidden />
			<ControlSheet state={state} onDone={() => undefined} />
		</div>
	);
}
