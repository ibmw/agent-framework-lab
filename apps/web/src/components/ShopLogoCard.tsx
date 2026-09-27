import type { ShopLogoViewSchema, ShopMark } from "@agent-lab/contracts";
import { useId } from "react";
import {
  DEFAULT_LOGO_BACKGROUND,
  isLowContrast,
  LOW_CONTRAST_WARNING,
  logoPreviewNote,
  MONOGRAM_NAME,
  markColourFor,
  markName,
  SHOP_LOGO_BACKGROUNDS,
  SHOP_MARK_COLOURS,
  SHOP_MARKS,
  shopInitials,
} from "../lib/shopLogo";
import { FieldGroup, FieldRows } from "./FieldHint";
import { ShopBadge, ShopMarkGlyph } from "./ShopBadge";
import { Card } from "./WorkspaceChrome";

// A tile is a native radio drawn as a box: the input is visually hidden and the label carries
// the look, so the group is a real radio group with arrow keys and one tab stop.
const tileClasses =
  "flex h-11 cursor-pointer items-center justify-center rounded-[9px] border border-admin-quiet-border bg-white text-[12.5px] font-[650] text-admin-muted hover:border-admin-faint hover:text-admin-ink has-checked:border-lab-primary has-checked:bg-admin-chip has-checked:font-bold has-checked:text-lab-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-lab-primary";

// A swatch is the prototype's 36px square: a hairline ring at rest, a pine ring off a white
// gap when checked, and the focus outline further out when checked than at rest.
const swatchClasses =
  "block h-9 w-9 cursor-pointer rounded-[9px] shadow-[0_0_0_1px_rgb(22_51_45_/_14%)] hover:shadow-[0_0_0_2px_rgb(22_51_45_/_34%)] has-checked:shadow-[0_0_0_2px_#ffffff,0_0_0_4px_var(--color-lab-primary)] has-checked:hover:shadow-[0_0_0_2px_#ffffff,0_0_0_5px_var(--color-lab-primary-hover)] has-focus-visible:outline-2 has-focus-visible:outline-offset-[3px] has-checked:has-focus-visible:outline-offset-[5px] has-focus-visible:outline-lab-primary";

/**
 * The Logo card of the create page and of Shop details (`Workspace.dc.html` :256, :2033), on
 * ADR 0070's payload: a mark or the monogram, a background, and a mark colour.
 *
 * A shop without a logo opens on the monogram with no background and no colour checked, and
 * is drawn as the lab draws it — white on `lab-ink`. The first background, colour or icon
 * picked gives it a logo; the pickers never take one away. A pair under 3:1 is warned about
 * under *Mark colour* and saved all the same.
 */
export function ShopLogoCard({
  name,
  logo,
  onChange,
}: {
  /** The shop's name as typed, for the initials the monogram draws. */
  name: string;
  logo: ShopLogoViewSchema | null;
  onChange: (logo: ShopLogoViewSchema | null) => void;
}) {
  const group = useId();
  const noteId = `${group}-note`;
  const shownName = name.trim() === "" ? "New shop" : name;

  /** The logo a first pick starts: the monogram on Pine, in the colour that reads on it. */
  function started(patch: Partial<ShopLogoViewSchema>): ShopLogoViewSchema {
    const background = patch.background ?? DEFAULT_LOGO_BACKGROUND;
    return { mark: null, background, mark_colour: markColourFor(background), ...patch };
  }

  function pick(patch: Partial<ShopLogoViewSchema>) {
    onChange(logo === null ? started(patch) : { ...logo, ...patch });
  }

  // No guard is needed for the monogram on a shop without a logo: its radio is already
  // checked there, and a checked radio fires no change, so choosing it again starts nothing.
  function pickMark(mark: ShopMark | null) {
    pick({ mark });
  }

  const lowContrast = logo !== null && isLowContrast(logo.background, logo.mark_colour);

  return (
    <Card title="Logo">
      <p className="text-[13px] text-admin-muted">
        How the shop is recognised in the switcher and the shop list. Publishing freezes it with the
        rest of the shop.
      </p>
      <FieldRows>
        <FieldGroup
          label="Mark"
          hint="An icon, or the first letters of the name. A monogram follows the name if you rename the shop; an icon does not."
        >
          <div className="mb-[13px] flex items-center gap-3.5">
            <ShopBadge name={shownName} logo={logo} size={46} />
            <p id={noteId} className="min-w-0 text-[13px] leading-normal text-admin-muted">
              {logoPreviewNote(logo)}
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-[7px]">
            <label className={tileClasses} title={MONOGRAM_NAME}>
              <input
                type="radio"
                className="sr-only"
                name={`${group}-mark`}
                checked={logo === null || logo.mark === null}
                aria-describedby={noteId}
                onChange={() => pickMark(null)}
              />
              <span aria-hidden="true">{shopInitials(shownName)}</span>
              <span className="sr-only">{MONOGRAM_NAME}</span>
            </label>
            {SHOP_MARKS.map((mark) => (
              <label key={mark} className={tileClasses} title={markName(mark)}>
                <input
                  type="radio"
                  className="sr-only"
                  name={`${group}-mark`}
                  checked={logo?.mark === mark}
                  aria-describedby={noteId}
                  onChange={() => pickMark(mark)}
                />
                <ShopMarkGlyph mark={mark} size={20} />
                <span className="sr-only">{markName(mark)}</span>
              </label>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup
          label="Background"
          hint="Pick something distinct from your other shops — this is what tells them apart at a glance."
        >
          <div className="flex flex-wrap gap-2">
            {SHOP_LOGO_BACKGROUNDS.map((background) => (
              <Swatch
                key={background.value}
                group={`${group}-background`}
                name={background.name}
                hex={background.hex}
                checked={logo?.background === background.value}
                onPick={() => pick({ background: background.value })}
              />
            ))}
          </div>
        </FieldGroup>
        <FieldGroup
          label="Mark colour"
          hint="What the icon or the letters are drawn in."
          extra={lowContrast ? LOW_CONTRAST_WARNING : null}
          extraTone="warning"
        >
          <div className="flex flex-wrap gap-2">
            {SHOP_MARK_COLOURS.map((colour) => (
              <Swatch
                key={colour.value}
                group={`${group}-mark-colour`}
                name={colour.name}
                hex={colour.hex}
                checked={logo?.mark_colour === colour.value}
                onPick={() => pick({ mark_colour: colour.value })}
              />
            ))}
          </div>
        </FieldGroup>
      </FieldRows>
    </Card>
  );
}

/** One colour of a swatch row: a native radio, named by the colour, drawn as the colour. */
function Swatch({
  group,
  name,
  hex,
  checked,
  onPick,
}: {
  group: string;
  name: string;
  hex: string;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <label className={swatchClasses} style={{ backgroundColor: hex }} title={name}>
      <input type="radio" className="sr-only" name={group} checked={checked} onChange={onPick} />
      <span className="sr-only">{name}</span>
    </label>
  );
}
