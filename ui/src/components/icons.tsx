/**
 * The icon set, in one place so the stat strip and the control sheet can't drift
 * into two different house styles.
 *
 * All are stroked line glyphs on the same 24x24 grid at the same weight, and all
 * take their colour from `currentColor`, so they inherit whatever text tone they
 * sit in and theme with the rest of the page automatically.
 *
 * They are decoration, never information: every icon here sits beside a written
 * label, so nothing is lost if a glyph doesn't read at a glance.
 */
const BASE = {
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.9,
	strokeLinecap: "round",
	strokeLinejoin: "round",
	"aria-hidden": true,
	focusable: false,
} as const;

type Props = { size?: number };

/** A photovoltaic panel rather than a sun - this is generation, not weather. */
export const SolarIcon = ({ size = 18 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M3.2 14.5 5.6 6h12.8l2.4 8.5H3.2Z" />
		<path d="M4.4 10.5h15.2M10.4 6 9.2 14.5M13.6 6l1.2 8.5" />
		<path d="M12 14.5V20M9 20h6" />
	</svg>
);

/** The house load. */
export const HomeIcon = ({ size = 18 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M3 11.2 12 4l9 7.2" />
		<path d="M5.6 9.6V20h12.8V9.6" />
	</svg>
);

/** The pole, echoing the powerline drawn in the scene. */
export const GridIcon = ({ size = 18 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M12 3.5V20" />
		<path d="M5.5 7.5h13M7.5 12h9" />
		<path d="M6.6 7.5v2M17.4 7.5v2M8.6 12v1.8M15.4 12v1.8" />
	</svg>
);

/** The car. Shared with the control sheet. */
export const CarIcon = ({ size = 18 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M5 17h14M4 17v-4l2-5h12l2 5v4M7.5 17v2M16.5 17v2" />
		<circle cx="8" cy="13.5" r="1.1" />
		<circle cx="16" cy="13.5" r="1.1" />
	</svg>
);

/** Charge now. */
export const BoltIcon = ({ size = 24 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10.5H12z" />
	</svg>
);

/** Pause charging. */
export const PauseIcon = ({ size = 24 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M9 4v16M15 4v16" />
	</svg>
);

/** Back to the automatic schedule. */
export const AutoIcon = ({ size = 24 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
	</svg>
);

/** Opens the explanation of the current decision. */
export const InfoIcon = ({ size = 22 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5.5" />
		<path d="M12 7.6h.01" />
	</svg>
);

/**
 * A bolt struck through: not charging.
 *
 * Not simply the bolt in a duller colour - that would leave the difference
 * between charging and not resting on hue alone, which is the one thing this
 * dashboard never does.
 */
export const BoltOffIcon = ({ size = 30 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10.5H12z" />
		<path d="M3.5 3.5 20.5 20.5" />
	</svg>
);

/** A plug with nothing in it: the charger is live, the cable is not connected. */
export const PlugIcon = ({ size = 30 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M9 3v6M15 3v6" />
		<path d="M6 9h12v2.6A6 6 0 0 1 12 17.6 6 6 0 0 1 6 11.6V9Z" />
		<path d="M12 17.6V21" />
	</svg>
);

/** A safety rule is holding the charge off. */
export const AlertIcon = ({ size = 30 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<path d="M12 3.8 2.6 20h18.8L12 3.8Z" />
		<path d="M12 10.2v4.2M12 17.6h.01" />
	</svg>
);

/** Shackle down and closed: the car is locked. */
export const LockedIcon = ({ size = 24 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
		<path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3" />
	</svg>
);

/** Shackle sprung open: the car is unlocked. */
export const UnlockedIcon = ({ size = 24 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
		<path d="M8 10.5V7.2a4 4 0 0 1 7.6-1.7" />
	</svg>
);

/** A padlock with a question mark: we have not been told either way. */
export const LockUnknownIcon = ({ size = 24 }: Props) => (
	<svg {...BASE} width={size} height={size}>
		<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
		<path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3" />
		<path d="M10.6 14.6a1.5 1.5 0 1 1 1.9 1.6v.9M12 18.9h.01" />
	</svg>
);

/**
 * Weather glyphs, keyed by the icon name the provider's WMO mapping returns.
 * Coarse on purpose - at a glance from across a room, "light" versus "moderate"
 * drizzle is noise.
 */
export function WeatherIcon({ icon, size = 26 }: { icon: string; size?: number }) {
	const cloud = "M7.5 18h9.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-9.9-1.2A3.7 3.7 0 0 0 7.5 18Z";
	switch (icon) {
		case "sun":
			return (
				<svg {...BASE} width={size} height={size}>
					<circle cx="12" cy="12" r="4.4" />
					<path d="M12 2.6v2.2M12 19.2v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
				</svg>
			);
		case "cloud-sun":
			return (
				<svg {...BASE} width={size} height={size}>
					<circle cx="8.5" cy="8" r="3.1" />
					<path d="M8.5 2.4v1.4M3.9 3.9l1 1M2.4 8.5h1.4M13.1 3.9l-1 1" />
					<path d={cloud} />
				</svg>
			);
		case "fog":
			return (
				<svg {...BASE} width={size} height={size}>
					<path d="M4 9h16M3 13h18M5 17h14M7 21h10" />
				</svg>
			);
		case "drizzle":
		case "rain":
			return (
				<svg {...BASE} width={size} height={size}>
					<path d="M7.5 15h9.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-9.9-1.2A3.7 3.7 0 0 0 7.5 15Z" />
					<path d={icon === "rain" ? "M8.5 18.5l-1 3M12 18.5l-1 3M15.5 18.5l-1 3" : "M9.5 18.5l-.6 1.8M14 18.5l-.6 1.8"} />
				</svg>
			);
		case "snow":
			return (
				<svg {...BASE} width={size} height={size}>
					<path d="M7.5 15h9.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-9.9-1.2A3.7 3.7 0 0 0 7.5 15Z" />
					<path d="M9 19h.01M12 20.5h.01M15 19h.01" />
				</svg>
			);
		case "storm":
			return (
				<svg {...BASE} width={size} height={size}>
					<path d="M7.5 14h9.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-9.9-1.2A3.7 3.7 0 0 0 7.5 14Z" />
					<path d="M12.8 16.4l-2.6 3.4h3l-1 2.6" />
				</svg>
			);
		default:
			return (
				<svg {...BASE} width={size} height={size}>
					<path d={cloud} />
				</svg>
			);
	}
}
