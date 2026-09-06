import { power } from "../lib/format.ts";
import type { DashboardState } from "../lib/types.ts";
import { FlowTrace, toneColor } from "./scene/FlowTrace.tsx";
import { anchor } from "./scene/iso.ts";
import { CAR, LABEL_AT, project, ROUTES } from "./scene/layout.ts";
import { type Palette, skyPalette } from "./scene/palette.ts";
import {
	Battery,
	Charger,
	GridConnection,
	Ground,
	HouseVolume,
	Roof,
	SolarPanels,
	Window,
} from "./scene/parts/Buildings.tsx";
import { Foliage, Moon, SunRays } from "./scene/parts/Nature.tsx";
import { TeslaCar } from "./scene/parts/TeslaCar.tsx";

/** World units are ~380 wide once projected; this frames them with air around. */
const VIEW = "-280 -324 535 580";

/**
 * The scene: an isometric house with the energy actually moving through it.
 *
 * Everything is projected from world coordinates (see `layout.ts`), so the wires
 * stay attached to the things they connect. Colour says what kind of energy is
 * moving - green for free, amber for grid import, blue for the battery, red when
 * a safety rule is blocking - but colour never carries it alone: metered and
 * blocked wires are dashed where free ones are solid, and every live wire is
 * labelled with its kW.
 */
export function HouseScene({ state }: { state: DashboardState }) {
	const { energy, charger, car, sky, decision } = state;
	const p: Palette = skyPalette(sky.daylight);
	const night = 1 - sky.daylight;

	const solarW = energy?.solarW ?? 0;
	const gridW = energy?.gridW ?? 0;
	const batteryW = energy?.batteryW ?? 0;
	// Only a car that is really drawing counts as charging. A live plug with
	// nothing on the end of it is "waiting", not a charge in progress.
	const charging = state.chargeState === "charging";
	const waitingForCar = state.chargeState === "waiting";
	const carW = charging ? Math.max(charger?.powerW ?? 0, 0) || state.limits.carPowerW : 0;

	const importing = gridW > 0;
	const blocked = decision?.action === "off" && /main-switch/.test(decision.reason);
	const solarIntensity = Math.min(1, solarW / 4000);

	const gridTone = blocked ? "critical" : importing ? "warning" : "good";
	const carTone = blocked ? "critical" : charging ? "good" : waitingForCar ? "waiting" : "idle";

	const solarLabel = anchor(LABEL_AT.solar);
	const gridLabel = anchor(LABEL_AT.grid);
	const battLabel = anchor(LABEL_AT.battery);
	const carAt = anchor(CAR);

	return (
		<svg viewBox={VIEW} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img"
			aria-label="Isometric illustration of the house showing where energy is flowing">
			<style>{`@keyframes trace-run { from { offset-distance: 0% } to { offset-distance: 100% } }`}</style>

			{sky.phase === "night" ? <Moon phase={sky.moonPhase} fraction={sky.moonFraction} /> : <SunRays intensity={solarIntensity} />}

			<Ground p={p} />
			<Foliage p={p} behind />
			<HouseVolume p={p} />
			<Roof p={p} />
			<SolarPanels p={p} lit={solarIntensity} />
			<Window p={p} night={night} />
			<GridConnection p={p} tone={Math.abs(gridW) >= 50 ? toneColor(p, gridTone, p.muted) : p.muted} />
			<Battery p={p} soc={energy?.batterySoc ?? 0} low={(energy?.batterySoc ?? 100) <= state.limits.batteryStopPct + 5} />
			<Charger p={p} active={charging} />

			{/* Wires sit above the buildings they run across, below the foreground. */}
			<FlowTrace id="solar" points={project(ROUTES.solarToJunction)} watts={solarW} tone="good" p={p} />
			<FlowTrace id="grid" points={project(ROUTES.gridToJunction)} watts={gridW} tone={gridTone}
				// Route runs grid -> junction, so "forward" is importing.
				forward={importing} p={p} />
			<FlowTrace id="batt" points={project(ROUTES.junctionToBattery)} watts={batteryW} tone="battery"
				// Route runs junction -> battery, so "forward" is charging it.
				forward={batteryW > 0} p={p} />
			<FlowTrace id="car" points={project(ROUTES.junctionToCar)} watts={carW} tone={carTone} p={p} />

			<TeslaCar p={p} soc={car?.soc ?? null} charging={Boolean(charger?.on)} />
			<Foliage p={p} behind={false} />

			{/* Values. Solar is labelled at the panels with an arrow rather than
			    piped down from the sun. */}
			{solarW >= 50 && <Value x={solarLabel.x} y={solarLabel.y} text={power(solarW)} colour={p.flowGood} p={p} />}
			{Math.abs(gridW) >= 50 && (
				<Value x={gridLabel.x} y={gridLabel.y} text={power(gridW)} colour={toneColor(p, gridTone, p.muted)} p={p} />
			)}
			{Math.abs(batteryW) >= 50 && (
				<Value x={battLabel.x} y={battLabel.y} text={power(batteryW)} colour={p.flowBattery} p={p} />
			)}
			{waitingForCar && <Note x={carAt.x} y={carAt.y + 46} text="waiting for the car to be plugged in" p={p} warn />}
		</svg>
	);
}

/**
 * A wattage, sitting on its own pill so it stays readable wherever it lands on
 * the illustration.
 *
 * The earlier version used a `paint-order` stroke halo in the page colour, which
 * failed at dawn: the page is dark there while the house behind the label is
 * light, so the halo muddied the text instead of separating it. A filled pill in
 * the surface colour is opaque, so it works over roof, wall, lawn or sky alike.
 * The colour chip identifies which wire the number belongs to; the number itself
 * stays in ink, never in the wire colour.
 */
function Value({ x, y, text, colour, p }: { x: number; y: number; text: string; colour: string; p: Palette }) {
	// Ubuntu bold at 16px with tabular figures is close enough to 8.7px/char that
	// the pill never crops - measuring in the DOM would cost a layout per frame.
	const textW = text.length * 8.7;
	const w = 12 + 8 + 6 + textW + 12;
	const h = 26;

	return (
		<g transform={`translate(${x} ${y})`}>
			<rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={p.surface} stroke={p.hairline} strokeWidth={1} />
			<circle cx={-w / 2 + 12 + 4} cy={0} r={4} fill={colour} />
			<text x={-w / 2 + 12 + 8 + 6} y={5} fill={p.ink} style={{ fontSize: 16, fontWeight: 700 }}>
				{text}
			</text>
		</g>
	);
}

/**
 * A caption on its own pill.
 *
 * Plain muted text was disappearing into the cream lawn in daylight - readable
 * on the dark surface, close to invisible on the bright one, and it also crossed
 * the lawn's edge line. Sitting it on the surface colour makes it legible over
 * whatever it happens to land on, in either palette.
 */
function Note({ x, y, text, p, warn = false }: { x: number; y: number; text: string; p: Palette; warn?: boolean }) {
	const textW = text.length * 6.7;
	const padL = warn ? 11 : 13;
	const iconW = warn ? 13 + 6 : 0; // glyph plus the gap after it
	const w = padL + iconW + textW + 13;
	const left = -w / 2;

	return (
		<g transform={`translate(${x} ${y})`}>
			<rect x={left} y={-11} width={w} height={22} rx={11} fill={p.surface} stroke={p.hairline} strokeWidth={1} />

			{warn && (
				// Drawn in place rather than reusing the shared icon set: those are
				// sized for page chrome, and this has to sit on the scene's own
				// coordinate grid so it scales with the illustration.
				<g transform={`translate(${left + padL + 6.5} 0)`} stroke={p.flowWarning} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
					<path d="M0,-5.4 L6,5 L-6,5 Z" />
					<path d="M0,-1.8 v2.6" />
					<path d="M0,3.3 h0.01" />
				</g>
			)}

			<text x={left + padL + iconW} y={4} fill={p.inkDim} style={{ fontSize: 12.5 }}>
				{text}
			</text>
		</g>
	);
}
