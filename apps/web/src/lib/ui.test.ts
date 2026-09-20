import { describe, expect, it } from "vitest";
import {
  type ButtonVerb,
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

describe("field controls", () => {
  it("focus the fields on pine, not on the old accent", () => {
    for (const classes of [fieldControlClasses, textAreaClasses]) {
      expect(classes).toContain("focus:border-lab-primary");
      expect(classes).toContain("focus:ring-lab-primary/20");
      expect(classes).not.toContain("lab-accent");
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
