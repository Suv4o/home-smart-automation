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
