import type {
  ShopLogoBackground,
  ShopLogoViewSchema,
  ShopMark,
  ShopMarkColour,
} from "@agent-lab/contracts";

/**
 * A shop's logo, as the workspace draws it (ADR 0070).
 *
 * The lab holds a mark or the monogram, a background and a mark colour, all closed sets; this
 * module holds how each one is drawn and when a pair is hard to read. The palette and the
 * contrast rule are the ones `domain/shop.py` holds — `shopLogo.test.ts` reads the palette out
 * of that file and asserts both sides warn about the same pairs.
 */

/**
 * The twenty-eight marks, in the prototype's order and with its own path data
 * (`tmp/design-frames/Workspace.dc.html`, `SHOP_ICONS`), drawn on a 24px box at a 1.7 stroke.
 */
export const SHOP_MARK_PATHS = {
  storefront: [
    "M4.5 9.2 6 4.8h12l1.5 4.4a3 3 0 0 1-5.7 1.3 3 3 0 0 1-5.6 0 3 3 0 0 1-5.7-1.3",
    "M6 11.5V19h12v-7.5",
    "M10 19v-4.2h4V19",
  ],
  compass: [
    "M12 3.8a8.2 8.2 0 1 1 0 16.4 8.2 8.2 0 0 1 0-16.4",
    "M15.4 8.6l-1.9 4.9-4.9 1.9 1.9-4.9z",
  ],
  anchor: [
    "M12 8.4V20",
    "M12 4.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8",
    "M8.4 11.4h7.2",
    "M4.6 14.6a7.4 7.4 0 0 0 14.8 0",
    "M4.6 14.6h2.6",
    "M19.4 14.6h-2.6",
  ],
  mountain: ["M3.4 18.6 9.6 7l3.5 6.3 2-2.6 5.5 7.9z", "M9.6 7l3.5 6.3"],
  leaf: [
    "M19 5c0 8-4.6 11.4-9.4 11.4A4.6 4.6 0 0 1 5 11.8C5 7.6 10.8 5 19 5",
    "M5.5 19.2C8.3 15 12 12.6 16.4 11.2",
  ],
  wave: [
    "M3.6 9.4c2.1-2.2 4.2-2.2 6.3 0s4.2 2.2 6.3 0 4.2-2.2 4.2-2.2",
    "M3.6 14.8c2.1-2.2 4.2-2.2 6.3 0s4.2 2.2 6.3 0 4.2-2.2 4.2-2.2",
  ],
  spark: ["M12 3.6l2.1 5.6 5.6 2.1-5.6 2.1L12 19l-2.1-5.6L4.3 11.3l5.6-2.1z"],
  bolt: ["M13.4 3.6 6.2 13.4h4.6L10.6 20.4l7.2-9.8h-4.6z"],
  cube: ["M12 3.8l7.4 3.9v8.6L12 20.2l-7.4-3.9V7.7z", "M4.6 7.7 12 11.6l7.4-3.9", "M12 11.6v8.6"],
  bag: ["M5.6 8h12.8l1 11.4H4.6z", "M9 8V6.6a3 3 0 0 1 6 0V8"],
  tag: [
    "M4.6 11.4V5.4a.8.8 0 0 1 .8-.8h6l8.2 8.2a1 1 0 0 1 0 1.4l-5.6 5.6a1 1 0 0 1-1.4 0z",
    "M8.4 8.4h.01",
  ],
  shirt: ["M9 4.4 5 6.6l1.4 3.6 1.8-.7v9.9h7.6V9.5l1.8.7L19 6.6l-4-2.2", "M9 4.4a3 3 0 0 0 6 0"],
  shoe: [
    "M3.6 16.8v-5.4l3.4.9 3.1-3.9 2.4 2.4 5.1 1.7a3 3 0 0 1 2 2.8v1.5z",
    "M3.6 16.8h17.8v2.4H3.6z",
  ],
  gem: [
    "M7.4 4.8h9.2l3.4 4.6L12 19.6 4 9.4z",
    "M4 9.4h16",
    "M9.5 9.4 12 19.6l2.5-10.2",
    "M7.4 4.8 9.5 9.4l2.5-4.6 2.5 4.6 2.1-4.6",
  ],
  cup: [
    "M5.4 6.6h11v5.8a5.5 5.5 0 0 1-11 0z",
    "M16.4 8h1.6a2.4 2.4 0 0 1 0 4.8h-1.6",
    "M4.4 19.6h13",
  ],
  bread: [
    "M4.6 12.4c0-3.5 3.3-6.2 7.4-6.2s7.4 2.7 7.4 6.2v4.6a.8.8 0 0 1-.8.8H5.4a.8.8 0 0 1-.8-.8z",
    "M9 9.2v8.6",
    "M13.4 9.2v8.6",
  ],
  bottle: [
    "M10 3.6h4v3l1.8 2.6v10.4a.8.8 0 0 1-.8.8H9a.8.8 0 0 1-.8-.8V9.2L10 6.6z",
    "M8.2 12.8h7.6",
  ],
  pill: ["M13.6 4.9a4.4 4.4 0 0 1 6.2 6.2l-8.7 8.7a4.4 4.4 0 0 1-6.2-6.2z", "M8.4 8.5l7.1 7.1"],
  heart: [
    "M12 19.6C7.3 16.4 4.2 13.7 4.2 10.4a3.9 3.9 0 0 1 7.8-1.2 3.9 3.9 0 0 1 7.8 1.2c0 3.3-3.1 6-7.8 9.2",
  ],
  scissors: [
    "M7 5.4 17.6 18",
    "M17 5.4 6.4 18",
    "M6.2 17.4a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6",
    "M17.8 17.4a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6",
  ],
  tools: [
    "M6.4 4.8 10 8.4l-1.8 1.8L4.6 6.6a3.4 3.4 0 0 0 4.6 4.3l7.6 7.6a1.8 1.8 0 0 0 2.6-2.6L11.8 8.3a3.4 3.4 0 0 0-4.3-4.6z",
  ],
  book: [
    "M5 5.2h5.2A1.8 1.8 0 0 1 12 7v12a2.4 2.4 0 0 0-2.4-1.6H5z",
    "M19 5.2h-5.2A1.8 1.8 0 0 0 12 7v12a2.4 2.4 0 0 1 2.4-1.6H19z",
  ],
  ticket: [
    "M4.6 8.4a1 1 0 0 1 1-1h12.8a1 1 0 0 1 1 1v2a2 2 0 0 0 0 3.2v2a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-3.2z",
    "M11.6 8.4v7.2",
  ],
  camera: [
    "M4.6 9.2h3l1.4-2.2h6l1.4 2.2h3v8.6a.8.8 0 0 1-.8.8H5.4a.8.8 0 0 1-.8-.8z",
    "M12 10.8a3 3 0 1 1 0 6 3 3 0 0 1 0-6",
  ],
  paw: [
    "M12 13.6c2.4 0 4.2 1.7 4.2 3.5S14.6 20 12 20s-4.2-1.1-4.2-2.9 1.8-3.5 4.2-3.5",
    "M7.4 8.6a1.7 2.1 0 1 1 0 4.2 1.7 2.1 0 0 1 0-4.2",
    "M16.6 8.6a1.7 2.1 0 1 1 0 4.2 1.7 2.1 0 0 1 0-4.2",
    "M10.3 5.2a1.6 2 0 1 1 0 4 1.6 2 0 0 1 0-4",
    "M13.7 5.2a1.6 2 0 1 1 0 4 1.6 2 0 0 1 0-4",
  ],
  home: ["M4.4 11.4 12 4.8l7.6 6.6", "M6.6 10.2V19h10.8v-8.8", "M10.2 19v-4.6h3.6V19"],
  truck: [
    "M3.6 7.4h9.6v8.4H3.6z",
    "M13.2 10.4h3.4l2.8 2.8v2.6h-6.2z",
    "M7.2 15.8a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8",
    "M16.4 15.8a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8",
  ],
  globe: [
    "M12 3.8a8.2 8.2 0 1 1 0 16.4 8.2 8.2 0 0 1 0-16.4",
    "M3.8 12h16.4",
    "M12 3.8c2.1 2.2 3.2 5 3.2 8.2s-1.1 6-3.2 8.2c-2.1-2.2-3.2-5-3.2-8.2S9.9 6 12 3.8",
  ],
} as const satisfies Record<ShopMark, readonly string[]>;

export const SHOP_MARKS = Object.keys(SHOP_MARK_PATHS) as ShopMark[];

/** A mark's name, for its tile: the key, capitalised. */
export function markName(mark: ShopMark): string {
  return mark.charAt(0).toUpperCase() + mark.slice(1);
}

/**
 * The backgrounds, in the prototype's order and with its names. A token's hex is frozen once
 * published — a different colour is a new token.
 */
export const SHOP_LOGO_BACKGROUNDS: readonly {
  value: ShopLogoBackground;
  name: string;
  hex: string;
}[] = [
  { value: "clay", name: "Clay", hex: "#c2532d" },
  { value: "pine", name: "Pine", hex: "#1d6241" },
  { value: "indigo", name: "Indigo", hex: "#2f4a7a" },
  { value: "plum", name: "Plum", hex: "#6b3f8c" },
  { value: "forest", name: "Forest", hex: "#16332d" },
  { value: "ochre", name: "Ochre", hex: "#a8802a" },
  { value: "brick", name: "Brick", hex: "#9d3028" },
  { value: "stone", name: "Stone", hex: "#eceef0" },
];

/** The two mark colours, in the prototype's order and with its names. */
export const SHOP_MARK_COLOURS: readonly { value: ShopMarkColour; name: string; hex: string }[] = [
  { value: "white", name: "White", hex: "#ffffff" },
  { value: "ink", name: "Ink", hex: "#16332d" },
];

/** WCAG 2.2 SC 1.4.11: a graphical object against its adjacent colour. */
export const MIN_MARK_CONTRAST = 3;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((index) =>
    channel(Number.parseInt(hex.slice(index, index + 2), 16)),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

export function backgroundHex(background: ShopLogoBackground): string {
  const entry = SHOP_LOGO_BACKGROUNDS.find((candidate) => candidate.value === background);
  if (entry === undefined) {
    throw new Error(`Unknown logo background ${background}`);
  }
  return entry.hex;
}

export function markColourHex(colour: ShopMarkColour): string {
  const entry = SHOP_MARK_COLOURS.find((candidate) => candidate.value === colour);
  if (entry === undefined) {
    throw new Error(`Unknown mark colour ${colour}`);
  }
  return entry.hex;
}

/**
 * The mark colour of the higher contrast against `background`: what a logo takes when its
 * background is chosen before its colour.
 */
export function markColourFor(background: ShopLogoBackground): ShopMarkColour {
  const ground = backgroundHex(background);
  return contrastRatio(ground, markColourHex("white")) >=
    contrastRatio(ground, markColourHex("ink"))
    ? "white"
    : "ink";
}

/** Whether the pair falls under 3:1: the editor warns about it, and saves it all the same. */
export function isLowContrast(background: ShopLogoBackground, colour: ShopMarkColour): boolean {
  return contrastRatio(backgroundHex(background), markColourHex(colour)) < MIN_MARK_CONTRAST;
}

/** The prototype's sentence under *Mark colour* for a pair under 3:1. */
export const LOW_CONTRAST_WARNING = "Hard to read against that background. Try the other one.";

/** What a badge paints: the ground and the ink, for a logo or for the initials without one. */
export function logoColours(logo: ShopLogoViewSchema | null): { background: string; mark: string } {
  if (logo === null) {
    return { background: "var(--color-lab-ink)", mark: markColourHex("white") };
  }
  return { background: backgroundHex(logo.background), mark: markColourHex(logo.mark_colour) };
}

/** The monogram: the first letters of the name's first two words. */
export function shopInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

/** The background a logo starts on when a shop without one picks a mark or a colour: Pine. */
export const DEFAULT_LOGO_BACKGROUND: ShopLogoBackground = "pine";

/** The name the prototype gives the first mark tile. */
export const MONOGRAM_NAME = "Monogram — the first letters of the name";

/** What the preview says beside the badge: where the letters come from, or that an icon stays. */
export function logoPreviewNote(logo: ShopLogoViewSchema | null): string {
  if (logo === null) {
    return "Letters taken from the name, on the lab's own ink until you pick a background. They change if the shop is renamed.";
  }
  if (logo.mark === null) {
    return "Letters taken from the name — they change if the shop is renamed.";
  }
  return "This icon stays whatever the shop is called.";
}
