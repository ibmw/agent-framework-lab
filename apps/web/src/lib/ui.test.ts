import { describe, expect, it } from "vitest";
import themeSource from "../styles.css?raw";
import {
  type ButtonVerb,
  blockedButtonClasses,
  buttonIcon,
  buttonVariantClasses,
  type FilterChipKind,
  fieldControlClasses,
  fieldRowClasses,
  fieldRowControlClasses,
  fieldRowHintClasses,
  fieldRowLabelClasses,
  fieldRowLabelTextClasses,
  filterChipCountClasses,
  filterChipIcon,
  filterChipRowClasses,
  filterChipStateClasses,
  focusRingClasses,
  iconLeadingClasses,
  searchFieldClasses,
  searchFieldIconClasses,
  searchFieldRowClasses,
  searchFieldWrapClasses,
  textAreaClasses,
} from "./ui";

/**
 * The button layer is a table, and these are the rules every row of it obeys.
 *
 * Written over `buttonVariantClasses` rather than over the named exports, because that record
 * is what the named exports are read off: a variant added without a hover or without a focus
 * ring fails here rather than shipping on one page nobody looked at.
 */
const variants = Object.entries(buttonVariantClasses);

describe("button variants", () => {
  it("offers every weight the workspace draws", () => {
    expect(Object.keys(buttonVariantClasses).sort()).toEqual([
      "accent",
      "destructive",
      "destructiveOutline",
      "destructiveSubtle",
      "ink",
      "outline",
      "subtle",
      "warning",
    ]);
  });

  it.each(variants)("%s reacts to a pointer", (_name, classes) => {
    expect(classes).toMatch(/(^|\s)hover:/);
  });

  /**
   * Matched against the utilities themselves rather than against `focusRingClasses`, because
   * `"anything".includes("")` is true: a check that only asked whether each variant contained
   * the constant would pass for every variant the moment the constant was emptied, which is
   * precisely the regression this pair of tests exists to catch.
   */
  it("spells the ring out: two pine pixels, offset, on focus-visible", () => {
    expect(focusRingClasses).toContain("focus-visible:outline-2");
    expect(focusRingClasses).toContain("focus-visible:outline-offset-2");
    expect(focusRingClasses).toContain("focus-visible:outline-lab-primary");
  });

  it.each(variants)("%s draws a ring for a keyboard reader", (_name, classes) => {
    expect(classes).toMatch(/(^|\s)focus-visible:outline-2(\s|$)/);
    expect(classes).toMatch(/(^|\s)focus-visible:outline-offset-2(\s|$)/);
    expect(classes).toMatch(/(^|\s)focus-visible:outline-lab-primary(\s|$)/);
  });

  it.each(variants)("%s says what a disabled press means", (_name, classes) => {
    expect(classes).toContain("disabled:cursor-not-allowed");
  });

  it.each(variants)("%s leaves room beside the label for a glyph", (_name, classes) => {
    expect(classes).toMatch(/(^|\s)gap-/);
  });

  /**
   * Pine is the primary action and the warm red is reserved for destruction. The clay accent
   * is not redefined — it still paints the trace bars, the review stars and the emphasis on a
   * ticket — so the check is that no button but the deliberate warning reaches for it.
   */
  it("paints the primary action pine and nothing else", () => {
    expect(buttonVariantClasses.accent).toContain("bg-lab-primary");
    expect(buttonVariantClasses.accent).toContain("hover:bg-lab-primary-hover");
    const clay = variants.filter(([, classes]) => /bg-lab-accent(?!-soft)/.test(classes));
    expect(clay.map(([name]) => name)).toEqual(["warning"]);
  });

  it("keeps the warm red for what destroys something", () => {
    const red = variants.filter(([, classes]) => classes.includes("lab-error"));
    expect(red.map(([name]) => name).sort()).toEqual([
      "destructive",
      "destructiveOutline",
      "destructiveSubtle",
    ]);
  });
});

/**
 * The blocked weight, minted with the create pages of PLAN-UX Slice 12 and adopted by four
 * more primary actions in Slice 22.
 *
 * It is not a row of `buttonVariantClasses`, so the table's rules above do not reach it and
 * these are written out. What it must be is the prototype's dashed, quiet slab
 * (`Workspace.dc.html`:2933) at the shape of the primary action it replaces — and what it
 * must *not* have is a hover or a focus ring, because it is drawn only on a control that is
 * always `disabled` and neither would ever be seen.
 */
describe("the blocked primary action", () => {
  it("is dashed, quiet, and says a press will not work", () => {
    expect(blockedButtonClasses).toContain("border-dashed");
    expect(blockedButtonClasses).toContain("border-[#d4d8db]");
    expect(blockedButtonClasses).toContain("bg-[#fafbfb]");
    expect(blockedButtonClasses).toContain("text-[#9aa2a8]");
    expect(blockedButtonClasses).toContain("cursor-not-allowed");
  });

  it("keeps the shape of the action it stands in for", () => {
    // Same height, radius, padding, type and glyph gap as the accent button, so a form does
    // not resize when its Create becomes pressable.
    for (const utility of ["min-h-10", "rounded-lg", "px-4", "text-sm", "font-semibold", "gap-2"]) {
      expect(blockedButtonClasses, utility).toContain(utility);
      expect(buttonVariantClasses.accent, utility).toContain(utility);
    }
  });

  it("claims no state it can never show", () => {
    expect(blockedButtonClasses).not.toMatch(/(^|\s)hover:/);
    expect(blockedButtonClasses).not.toContain("focus-visible:");
    // And it is not in the table, so the sweep above is not quietly passing over it.
    expect(Object.values(buttonVariantClasses)).not.toContain(blockedButtonClasses);
  });
});

describe("field controls", () => {
  it("focus the fields on pine, not on the old accent", () => {
    for (const classes of [fieldControlClasses, textAreaClasses]) {
      expect(classes).toContain("focus:border-lab-primary");
      expect(classes).toContain("focus:ring-lab-primary/20");
      expect(classes).not.toContain("lab-accent");
    }
  });

  /**
   * What the two class sets genuinely share: the box the handoff draws round both of them.
   * Height, vertical padding and type size are *not* here, because the prototype gives the
   * input and the text area different ones — see the two cases below.
   */
  it("draws both controls on one box: the field border, 9px, 14px of side padding", () => {
    for (const classes of [fieldControlClasses, textAreaClasses]) {
      expect(classes).toContain("border-admin-field-border");
      expect(classes).toContain("rounded-[9px]");
      expect(classes).toContain("px-3.5");
    }
  });

  /**
   * The handoff's `Inputs:` bullet, under *The form pattern*: `min-height:44px;
   * padding:10px 14px; border:1px solid #c9cccf; border-radius:9px; font-size:14.5px`. The two
   * values that belong to the single-line control alone are asserted on it and refused on the
   * text area, so folding them back into the shared string fails here.
   */
  it("gives the single-line control the form pattern's own padding and size", () => {
    // 10px of vertical padding, on Tailwind's 4px step.
    expect(fieldControlClasses).toContain("py-2.5");
    expect(fieldControlClasses).toContain("text-[14.5px]");
    expect(textAreaClasses).not.toContain("py-2.5");
    expect(textAreaClasses).not.toContain("text-[14.5px]");
  });

  /**
   * And the text area takes the prototype's, which the `Inputs:` bullet summarises away: all
   * seven of them are `11px 14px` at 14px on a 1.6 leading (`Workspace.dc.html`:530, 1677,
   * 1724, 1807, 1954, 3205, 3515), identical in every value.
   */
  it("gives the text area the seven the prototype draws, not the input's", () => {
    expect(textAreaClasses).toContain("py-[11px]");
    expect(textAreaClasses).toContain("text-[14px]");
    expect(textAreaClasses).toContain("leading-[1.6]");
  });

  /**
   * The README writes `min-height`, and the distinction is the point: a `<select>`, a date
   * input and a control whose value wraps all have to be able to grow. A fixed `h-…` on either
   * string would clip them, so its absence is asserted rather than assumed — this is what
   * `h-10` used to be.
   */
  it("gives the control a floor of 44px and no ceiling", () => {
    expect(fieldControlClasses).toContain("min-h-[44px]");
    expect(fieldControlClasses).not.toMatch(/(^|\s)h-\S/);
    expect(fieldControlClasses).toContain("box-border");
  });

  /** A multi-line control keeps its own taller floor instead of the 44px one. */
  it("floors the text area on its own height rather than the control's", () => {
    expect(textAreaClasses).toContain("min-h-24");
    expect(textAreaClasses).not.toContain("min-h-[44px]");
    expect(textAreaClasses).not.toMatch(/(^|\s)h-\S/);
  });

  /**
   * The border is the refresh's second token addition and it exists to be *distinct from the
   * card's*. Asserted against `styles.css` because the class name alone cannot say that: a
   * token defined as the card's grey would satisfy every check above and still make every
   * field on the workspace vanish into the card behind it. The card's own value is read rather
   * than written down — what this test owns is the field's value and the inequality, and
   * pinning `admin-border` here would fail a field test for a card change.
   */
  it("defines the field border as its own value, not the card's", () => {
    const read = (name: string) =>
      new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`).exec(themeSource)?.[1];

    expect(read("admin-field-border")).toBe("#c9cccf");
    expect(read("admin-field-border")).not.toBe(read("admin-border"));
    // …and the card border is a token at all, so the line above cannot pass on two undefineds.
    expect(read("admin-border")).toMatch(/^#[0-9a-f]{6}$/);
  });

  /**
   * The regression this slice could cause. `searchFieldClasses` is the prototype's own 38px
   * `#bdc7cf` box (UI-6) and is built separately on purpose; nothing above may reach it, and
   * nothing here may fold it back in. Its own metrics are asserted further down — what is
   * asserted here is the *disjointness*, which is the part a later reader will not expect.
   */
  it("leaves the search box out of the form pattern's metrics", () => {
    expect(searchFieldClasses).not.toContain("min-h-[44px]");
    expect(searchFieldClasses).not.toContain("text-[14.5px]");
    expect(searchFieldClasses).not.toContain("admin-field-border");
    expect(searchFieldClasses).not.toContain("rounded-[9px]");
    // And the other way round: neither form control has any of the search box's five values.
    for (const classes of [fieldControlClasses, textAreaClasses]) {
      expect(classes).not.toContain("min-h-[38px]");
      expect(classes).not.toContain("text-[13px]");
      expect(classes).not.toContain("#bdc7cf");
      expect(classes).not.toContain("pl-9");
    }
  });
});

/**
 * The vocabulary is closed: a page names a verb and the table names the drawing, so the
 * pairing cannot drift per page. This asserts the set itself, in the spirit of
 * `enumLabels.test.ts` — the table is the specification, and a verb removed from it breaks
 * here before it breaks a screen.
 */
const VOCABULARY: Record<ButtonVerb, string> = {
  create: "Plus",
  save: "Check",
  discard: "RotateCcw",
  edit: "Pencil",
  delete: "Trash2",
  makeDefault: "Star",
  start: "Play",
  rerun: "RotateCw",
  fork: "GitBranch",
  publish: "Upload",
  results: "ChartColumn",
};

describe("the button glyph vocabulary", () => {
  it("covers every verb and invents none", () => {
    expect(Object.keys(buttonIcon).sort()).toEqual(Object.keys(VOCABULARY).sort());
  });

  it.each(Object.entries(VOCABULARY))("%s is drawn as %s", (verb, drawing) => {
    const glyph = buttonIcon[verb as ButtonVerb];
    expect(glyph).toBeTypeOf("object");
    expect(glyph.displayName).toBe(drawing);
  });

  it("gives no two verbs the same drawing", () => {
    const drawings = Object.values(buttonIcon);
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  it("sizes every glyph the same way", () => {
    expect(iconLeadingClasses).toContain("flex-none");
    expect(iconLeadingClasses).toMatch(/\bh-\S+\b/);
    expect(iconLeadingClasses).toMatch(/\bw-\S+\b/);
  });
});

/**
 * The filter chip is the second closed vocabulary in this file, and the rules it shares with
 * the first are asserted the same way: over the record the named states are read off.
 */
const chipStates = Object.entries(filterChipStateClasses);

describe("filter chip states", () => {
  it("offers the two the prototype draws and no third", () => {
    expect(Object.keys(filterChipStateClasses).sort()).toEqual(["selected", "unselected"]);
  });

  it.each(chipStates)("%s reacts to a pointer", (_name, classes) => {
    expect(classes).toMatch(/(^|\s)hover:/);
  });

  it.each(chipStates)("%s draws a ring for a keyboard reader", (_name, classes) => {
    expect(classes).toMatch(/(^|\s)focus-visible:outline-2(\s|$)/);
    expect(classes).toMatch(/(^|\s)focus-visible:outline-offset-2(\s|$)/);
    expect(classes).toMatch(/(^|\s)focus-visible:outline-lab-primary(\s|$)/);
  });

  /**
   * The handoff's token table gives the selected chip as `#eaf5ed` on `#b6d9c4` in `#1d6241`,
   * hovering to `#ddeee3`. Asserted against the token names rather than the hexadecimals,
   * because the values live in `styles.css` and a chip that reached for a literal is a chip
   * the theme can no longer move.
   */
  it("paints the selected chip in the refresh's own trio", () => {
    expect(filterChipStateClasses.selected).toContain("bg-admin-chip");
    expect(filterChipStateClasses.selected).toContain("border-admin-chip-border");
    expect(filterChipStateClasses.selected).toContain("text-lab-primary");
    expect(filterChipStateClasses.selected).toContain("hover:bg-admin-chip-hover");
  });

  it("gives the unselected chip a border of its own width, so pressing one moves nothing", () => {
    expect(filterChipStateClasses.unselected).toContain("border-transparent");
    for (const [, classes] of chipStates) {
      expect(classes).toMatch(/(^|\s)border(\s|$)/);
    }
  });

  it("carries the handoff's chip metrics", () => {
    // min-height 34px, padding 0 12px, gap 5px, radius 7px, 13px 700.
    for (const [, classes] of chipStates) {
      expect(classes).toContain("min-h-[34px]");
      expect(classes).toContain("px-3");
      expect(classes).toContain("gap-[5px]");
      expect(classes).toContain("rounded-[7px]");
      expect(classes).toContain("text-[13px]");
      expect(classes).toContain("font-bold");
    }
  });

  it("wraps the row and rules it off from the list below", () => {
    expect(filterChipRowClasses).toContain("flex-wrap");
    expect(filterChipRowClasses).toContain("gap-1.5");
    expect(filterChipRowClasses).toContain("border-b");
  });

  it("keeps the count in one column width and quieter than the label", () => {
    expect(filterChipCountClasses).toContain("tabular-nums");
    expect(filterChipCountClasses).toContain("opacity-75");
  });
});

/**
 * The chip vocabulary, asserted exactly as the button verbs are: the table is the
 * specification, and a kind removed from it breaks here before it breaks a screen.
 *
 * The six are the handoff's *Assets* list less the page glyph, which nothing in this
 * workspace draws — see the type's own note in `ui.ts`. That omission is asserted rather
 * than merely absent, so a seventh kind cannot be added without saying which one it is.
 */
const CHIP_VOCABULARY: Record<FilterChipKind, string> = {
  all: "Box",
  published: "CircleCheck",
  draft: "CircleDashed",
  attention: "TriangleAlert",
  referenced: "Link",
  unfulfilled: "Clock",
};

describe("the filter chip glyph vocabulary", () => {
  it("covers every kind and invents none", () => {
    expect(Object.keys(filterChipIcon).sort()).toEqual(Object.keys(CHIP_VOCABULARY).sort());
  });

  it.each(Object.entries(CHIP_VOCABULARY))("%s is drawn as %s", (kind, drawing) => {
    const glyph = filterChipIcon[kind as FilterChipKind];
    expect(glyph).toBeTypeOf("object");
    expect(glyph.displayName).toBe(drawing);
  });

  it("gives no two kinds the same drawing", () => {
    const drawings = Object.values(filterChipIcon);
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  /**
   * Two vocabularies, not one extended. A chip's check means "the published ones" and a
   * button's means "save", so the drawings are allowed to differ — what may not happen is a
   * page reaching into the wrong table, which is what one merged record would invite.
   */
  it("stays a separate set from the button verbs", () => {
    expect(Object.keys(filterChipIcon)).not.toContain("save");
    expect(Object.keys(buttonIcon)).not.toContain("all");
  });
});

/**
 * The form row, held to the handoff's own numbers.
 *
 * `tmp/design-frames/README.md`'s *The form pattern* section is the source. These are drift
 * guards on utility strings and nothing more: no test in this repository lays the row out, so
 * none of them proves that it wraps. What they prove is that the declaration which makes it
 * wrap is still the declaration the handoff wrote.
 */
describe("the form row", () => {
  it("declares the wrap, and starts both columns at the top", () => {
    expect(fieldRowClasses).toContain("flex-wrap");
    expect(fieldRowClasses).toContain("items-start");
  });

  it("carries the handoff's gaps, padding and dividing rule", () => {
    // column-gap 28px, row-gap 10px, padding 22px 0, border-top 1px #f1f2f3.
    expect(fieldRowClasses).toContain("gap-x-7");
    expect(fieldRowClasses).toContain("gap-y-2.5");
    expect(fieldRowClasses).toContain("py-[22px]");
    expect(fieldRowClasses).toContain("border-t");
    expect(fieldRowClasses).toContain("border-[#f1f2f3]");
  });

  it("declares the width below which the two columns can no longer sit side by side", () => {
    const basis = (classes: string) => {
      const match = /flex-\[\d+_\d+_(\d+)px\]/.exec(classes);
      return Number(match?.[1]);
    };
    // Tailwind's spacing step is 4px, so `gap-x-7` is the handoff's 28px column gap.
    const columnGap = Number(/gap-x-(\d+(?:\.\d+)?)/.exec(fieldRowClasses)?.[1]) * 4;

    expect(basis(fieldRowLabelClasses)).toBe(210);
    expect(basis(fieldRowControlClasses)).toBe(330);
    // Read out of all three utilities rather than restated, so that moving any one of them
    // fails here. 568px is the plan's "below ~540px" as the handoff's own numbers give it.
    expect(basis(fieldRowLabelClasses) + columnGap + basis(fieldRowControlClasses)).toBe(568);
  });

  it("lets both columns shrink, and caps the reading measure of the left one", () => {
    expect(fieldRowLabelClasses).toContain("min-w-0");
    expect(fieldRowControlClasses).toContain("min-w-0");
    expect(fieldRowLabelClasses).toContain("max-w-[36ch]");
  });

  it("sets the label and the hint at the sizes the handoff writes", () => {
    expect(fieldRowLabelTextClasses).toContain("text-[13.5px]");
    expect(fieldRowLabelTextClasses).toContain("font-bold");
    expect(fieldRowLabelTextClasses).toContain("text-admin-ink");
    expect(fieldRowHintClasses).toContain("text-[13px]");
    expect(fieldRowHintClasses).toContain("text-admin-ink-soft");
    expect(fieldRowHintClasses).toContain("[text-wrap:pretty]");
  });
});

/**
 * The search box's metrics, which are the prototype's and not the form pattern's — see the
 * note on the class set itself for why the README's `Inputs:` bullet does not reach a box in
 * a card header. Asserted so that a later slice cannot quietly fold this control into
 * `fieldControlClasses` and lose the 36px the magnifier stands in.
 */
describe("the search field", () => {
  it("carries the metrics the prototype draws on all eleven of them", () => {
    // min-height 38px, padding 8px 12px 8px 36px, radius 8px, 13px, border #bdc7cf.
    expect(searchFieldClasses).toContain("min-h-[38px]");
    expect(searchFieldClasses).toContain("py-2");
    expect(searchFieldClasses).toContain("pr-3");
    expect(searchFieldClasses).toContain("pl-9");
    expect(searchFieldClasses).toContain("rounded-lg");
    expect(searchFieldClasses).toContain("text-[13px]");
    expect(searchFieldClasses).toContain("border-[#bdc7cf]");
  });

  /**
   * The control is a `searchbox`, and what WebKit adds to one is refused. Preflight resets
   * `::-webkit-search-decoration` and nothing else, so without these two the browser draws a
   * clear x the prototype has not got, no keyboard reaches and nothing names — and can
   * overrule the radius above with a native box.
   */
  it("refuses the native search chrome the role would otherwise bring", () => {
    expect(searchFieldClasses).toContain("appearance-none");
    expect(searchFieldClasses).toContain("[&::-webkit-search-cancel-button]:appearance-none");
  });

  /**
   * The glyph is a drawing inside the field's own padding, so it must not eat the click that
   * belongs to the input underneath it, and it must not be the reason a 36px inset exists
   * without anything in it.
   */
  it("insets the magnifier into the padding the field leaves for it", () => {
    expect(searchFieldIconClasses).toContain("absolute");
    expect(searchFieldIconClasses).toContain("left-3");
    expect(searchFieldIconClasses).toContain("h-4");
    expect(searchFieldIconClasses).toContain("w-4");
    expect(searchFieldIconClasses).toContain("pointer-events-none");
  });

  /** The focus pair the README states and the prototype draws: pine border, 3px pine ring. */
  it("answers a keyboard reader with the workspace's own focus pair", () => {
    expect(searchFieldClasses).toContain("focus:border-lab-primary");
    expect(searchFieldClasses).toContain("focus:ring-[3px]");
    expect(searchFieldClasses).toContain("focus:ring-lab-primary/20");
  });

  /** The prototype's `margin-left:auto` and `width:min(300px,34%)`, with a floor under it. */
  it("sits at the right end of its row, at the prototype's width", () => {
    expect(searchFieldWrapClasses).toContain("ml-auto");
    expect(searchFieldWrapClasses).toContain("w-[min(300px,34%)]");
    expect(searchFieldWrapClasses).toContain("min-w-[180px]");
    expect(searchFieldWrapClasses).toContain("relative");
  });

  /** The row it sits in shares the card header's padding and rules off from the chips below. */
  it("wraps its row and rules it off from what is under it", () => {
    expect(searchFieldRowClasses).toContain("flex-wrap");
    expect(searchFieldRowClasses).toContain("px-4");
    expect(searchFieldRowClasses).toContain("py-3");
    expect(searchFieldRowClasses).toContain("border-b");
  });
});
