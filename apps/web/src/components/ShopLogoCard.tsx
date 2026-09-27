import type { ShopLogoBackground, ShopLogoSchema, ShopMark } from "@agent-lab/contracts";
import { useId, useState } from "react";
import {
  DEFAULT_LOGO_BACKGROUND,
  logoPreviewNote,
  markName,
  SHOP_LOGO_BACKGROUNDS,
  SHOP_MARKS,
} from "../lib/shopLogo";
import { FieldGroup, FieldRows } from "./FieldHint";
import { ShopBadge, ShopMarkGlyph } from "./ShopBadge";
import { Card } from "./WorkspaceChrome";

// A tile is a native radio drawn as a box: the input is visually hidden and the label carries
// the look, so the group is a real radio group with arrow keys and one tab stop.
const tileClasses =
  "flex h-11 cursor-pointer items-center justify-center rounded-[9px] border border-admin-quiet-border bg-white text-[12.5px] font-[650] text-admin-muted hover:border-admin-faint hover:text-admin-ink has-checked:border-lab-primary has-checked:bg-admin-chip has-checked:font-bold has-checked:text-lab-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-lab-primary";

const swatchClasses =
  "block h-9 w-9 cursor-pointer rounded-[9px] shadow-[0_0_0_1px_rgb(22_51_45_/_14%)] hover:shadow-[0_0_0_2px_rgb(22_51_45_/_34%)] has-checked:shadow-[0_0_0_2px_#ffffff,0_0_0_4px_var(--color-lab-primary)] has-focus-visible:outline-2 has-focus-visible:outline-offset-[5px] has-focus-visible:outline-lab-primary";

/**
 * The Logo card of the create page and of Shop details (`Workspace.dc.html` :256, :2033), on
 * ADR 0070's payload: a mark and a background, or none. The prototype's *Mark colour* row is
 * not drawn: the lab derives it from the background, so there is nothing to choose and
 * nothing to refuse.
 */
export function ShopLogoCard({
  name,
  logo,
  onChange,
}: {
  /** The shop's name as typed, for the initials the preview draws without a logo. */
  name: string;
  logo: ShopLogoSchema | null;
  onChange: (logo: ShopLogoSchema | null) => void;
}) {
  const group = useId();
  const noteId = `${group}-note`;

  // The last background chosen here, so None and back to a mark gives the operator the colour
  // they had rather than Pine again. It starts at the logo the card opened on.
  const [lastBackground, setLastBackground] = useState<ShopLogoBackground>(
    logo?.background ?? DEFAULT_LOGO_BACKGROUND,
  );

  function pickMark(mark: ShopMark | null) {
    onChange(mark === null ? null : { mark, background: logo?.background ?? lastBackground });
  }

  function pickBackground(background: ShopLogoBackground) {
    if (logo !== null) {
      setLastBackground(background);
      onChange({ ...logo, background });
    }
  }

  return (
    <Card title="Logo">
      <p className="text-[13px] text-admin-muted">
        How the shop is recognised in the switcher and the shop list. Publishing freezes it with the
        rest of the shop.
      </p>
      <FieldRows>
        <FieldGroup
          label="Mark"
          hint="An icon, or none — then the badge is the first letters of the name."
        >
          <div className="mb-[13px] flex items-center gap-3.5">
            <ShopBadge name={name.trim() === "" ? "New shop" : name} logo={logo} size={46} />
            <p id={noteId} className="min-w-0 text-[13px] leading-normal text-admin-muted">
              {logoPreviewNote(logo)}
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-[7px]">
            <label className={tileClasses} title="None — initials">
              <input
                type="radio"
                className="sr-only"
                name={`${group}-mark`}
                checked={logo === null}
                aria-describedby={noteId}
                onChange={() => pickMark(null)}
              />
              <span aria-hidden="true">Aa</span>
              <span className="sr-only">None — initials</span>
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
        {logo === null ? null : (
          <FieldGroup
            label="Background"
            hint="Pick one distinct from your other shops. The mark is drawn in white or ink, whichever reads better on it."
          >
            <div className="flex flex-wrap gap-2">
              {SHOP_LOGO_BACKGROUNDS.map((background) => (
                <label
                  key={background.value}
                  className={swatchClasses}
                  style={{ backgroundColor: background.hex }}
                  title={background.name}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${group}-background`}
                    checked={logo.background === background.value}
                    onChange={() => pickBackground(background.value)}
                  />
                  <span className="sr-only">{background.name}</span>
                </label>
              ))}
            </div>
          </FieldGroup>
        )}
      </FieldRows>
    </Card>
  );
}
