import type { ShopLogoSchema, ShopMark } from "@agent-lab/contracts";
import { logoColours, SHOP_MARK_PATHS, shopInitials } from "../lib/shopLogo";

/** The four sizes the frames draw: the panel, the bar and the index row, the editor preview. */
type BadgeSize = 26 | 30 | 46;

const METRICS: Record<BadgeSize, { box: string; glyph: number }> = {
  26: { box: "h-[26px] w-[26px] rounded-[7px] text-[10.5px]", glyph: 15 },
  30: { box: "h-[30px] w-[30px] rounded-lg text-[11.5px]", glyph: 17 },
  46: { box: "h-[46px] w-[46px] rounded-[11px] text-[15px]", glyph: 24 },
};

/** One of the twenty-eight marks, stroked in the current colour as the prototype draws it. */
export function ShopMarkGlyph({ mark, size }: { mark: ShopMark; size: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
      data-mark={mark}
    >
      {SHOP_MARK_PATHS[mark].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * A shop's badge: its logo, or its initials on `lab-ink` when it has none (ADR 0070).
 *
 * Hidden from a reader everywhere it is drawn: the shop's name is beside it, and a badge that
 * announced itself would say the name twice — or, for a mark, say "compass" where the reader
 * wanted the shop.
 */
export function ShopBadge({
  name,
  logo,
  size,
}: {
  name: string;
  logo: ShopLogoSchema | null;
  size: BadgeSize;
}) {
  const metrics = METRICS[size];
  const colours = logoColours(logo);
  return (
    <span
      aria-hidden="true"
      data-shop-badge=""
      className={`flex flex-none items-center justify-center font-bold tracking-[0.02em] ${metrics.box}`}
      style={{ backgroundColor: colours.background, color: colours.mark }}
    >
      {logo === null ? shopInitials(name) : <ShopMarkGlyph mark={logo.mark} size={metrics.glyph} />}
    </span>
  );
}
