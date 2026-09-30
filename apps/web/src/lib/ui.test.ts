import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import themeSource from "../styles.css?raw";
import { writeTimestampFormat } from "./preferences";
import {
  addFormClasses,
  type ButtonVerb,
  blockedButtonClasses,
  buttonIcon,
  buttonVariantClasses,
  chipClasses,
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
  formatAbsoluteTimestamp,
  formatFixtureTimestamp,
  formatTimestamp,
  iconLeadingClasses,
  idControlClasses,
  itemClasses,
  itemEditButtonClasses,
  itemIconButtonClasses,
  itemRemoveButtonClasses,
  readOnlyValueClasses,
  searchFieldClasses,
  searchFieldIconClasses,
  searchFieldRowClasses,
  searchFieldWrapClasses,
  textAreaClasses,
  validationMessageClasses,
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

  // A press in flight is `aria-disabled`, not `disabled`, so it keeps focus (ADR 0065); it
  // must still look unavailable, exactly as a natively disabled one does.
  it.each(variants)("%s fades a press in flight as it fades a disabled one", (_name, classes) => {
    for (const state of ["disabled", "aria-disabled"]) {
      expect(classes).toMatch(new RegExp(`(^|\\s)${state}:opacity-55(\\s|$)`));
      expect(classes).toMatch(new RegExp(`(^|\\s)${state}:cursor-not-allowed(\\s|$)`));
    }
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
 * The blocked weight, minted with the create pages and worn by every refused primary action since
 * ADR 0063.
 *
 * It is not a row of `buttonVariantClasses`, so the table's rules above do not reach it and
 * these are written out. What it must be is the prototype's dashed, quiet slab
 * (`Workspace.dc.html`:2933) at the shape of the primary action it replaces — and what it
 * must *not* have is a hover, because a press on it does nothing — and since ADR 0063 it is
 * reachable, so it carries the focus ring.
 */
describe("the blocked primary action", () => {
  it("is dashed, quiet, and says a press will not work", () => {
    expect(blockedButtonClasses).toContain("border-dashed");
    expect(blockedButtonClasses).toContain("border-admin-quiet-border");
    expect(blockedButtonClasses).toContain("bg-[#fafbfb]");
    expect(blockedButtonClasses).toContain("text-admin-faint");
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

  it("shows where a keyboard reader landed, and no hover that promises a press", () => {
    // Reachable since ADR 0063: a refused action is `aria-disabled`, stays in the tab order,
    // and so needs the ring every other control has.
    for (const utility of focusRingClasses.split(" ")) {
      expect(blockedButtonClasses, utility).toContain(utility);
    }
    expect(blockedButtonClasses).not.toMatch(/(^|\s)hover:/);
    // And it is not in the table, so the sweep above is not quietly passing over it.
    expect(Object.values(buttonVariantClasses)).not.toContain(blockedButtonClasses);
  });
});

describe("the chip", () => {
  const tones = Object.entries(chipClasses);

  it("offers the two tones the bench and the timeline draw", () => {
    expect(Object.keys(chipClasses).sort()).toEqual(["mark", "quiet"]);
  });

  it.each(tones)(
    "%s promises no press: no hover, no pointer, no ring, no transition",
    (_, classes) => {
      expect(classes).not.toMatch(/(^|\s)hover:/);
      expect(classes).not.toMatch(/(^|\s)focus(-visible)?:/);
      expect(classes).not.toMatch(/(^|\s)(disabled|aria-disabled):/);
      expect(classes).not.toContain("cursor-pointer");
      expect(classes).not.toMatch(/(^|\s)transition/);
      expect(classes).toContain("cursor-default");
    },
  );

  it.each(tones)("%s is not a button weight wearing another name", (_, classes) => {
    expect(Object.values(buttonVariantClasses)).not.toContain(classes);
    for (const variant of Object.values(buttonVariantClasses)) {
      expect(classes).not.toContain(variant);
    }
    // The ring every button carries is the part a chip must never borrow.
    for (const utility of focusRingClasses.split(" ")) {
      expect(classes.split(" "), utility).not.toContain(utility);
    }
  });

  it("is a small bordered label at the handoff's 7px chip radius", () => {
    for (const classes of Object.values(chipClasses)) {
      expect(classes).toContain("rounded-[7px]");
      expect(classes).toContain("border");
      expect(classes).toContain("text-[10px]");
    }
  });
});

describe("the validation message", () => {
  it("is the handoff's 13px 600 #9d3028", () => {
    expect(validationMessageClasses.split(" ").sort()).toEqual(
      ["font-semibold", "text-[13px]", "text-lab-error"].sort(),
    );
    expect(themeSource).toMatch(/--color-lab-error:\s*#9d3028;/);
  });
});

/**
 * The item of a list edited in the form below it (ADR 0072, ADR 0074), moved here from Shop
 * details' method cards so every list draws the methods handoff's values from one place.
 */
describe("the list item", () => {
  it("draws the handoff's box, and the pine border and ground only while the form holds it", () => {
    const shape = ["rounded-[9px]", "border", "px-3.5", "py-[11px]", "gap-[11px]", "flex-wrap"];
    for (const editing of [false, true]) {
      expect(itemClasses(editing).split(" ")).toEqual(expect.arrayContaining(shape));
    }
    expect(itemClasses(false)).toContain("border-admin-border bg-[#fafbfb]");
    expect(itemClasses(false)).not.toMatch(/#8fc3a5|#f1f8f3/);
    expect(itemClasses(true)).toContain("border-[#8fc3a5] bg-[#f1f8f3]");
    expect(itemClasses(true)).not.toContain("bg-[#fafbfb]");
  });

  it("gives the pencil and the trash one 30px bordered box with the workspace's ring", () => {
    for (const classes of [itemEditButtonClasses, itemRemoveButtonClasses]) {
      expect(classes.startsWith(itemIconButtonClasses)).toBe(true);
    }
    expect(itemIconButtonClasses).toContain("h-[30px] w-[30px]");
    expect(itemIconButtonClasses).toContain("border-admin-quiet-border");
    expect(itemIconButtonClasses).toContain(focusRingClasses);
  });

  it("warms the trash to the error ink on hover, and never while it is held", () => {
    expect(itemEditButtonClasses).toContain("hover:bg-[#f6f7f8] hover:text-admin-ink");
    expect(itemRemoveButtonClasses).toContain(
      "enabled:hover:border-[#c98676] enabled:hover:text-lab-error",
    );
    expect(itemRemoveButtonClasses).not.toMatch(/(^|\s)hover:/);
    expect(itemRemoveButtonClasses).toContain("disabled:cursor-not-allowed disabled:opacity-55");
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
   * The row where the page has decided the answer and is showing it rather than asking. It
   * has to stand in the control column at the control's height, and it must not read as
   * something to type in — which is the whole distinction, so the two halves are asserted
   * together (`Workspace.dc.html`:3325).
   */
  it("shows a decided value at the control's height and on no field border", () => {
    expect(readOnlyValueClasses).toContain("min-h-[44px]");
    expect(readOnlyValueClasses).toContain("rounded-[9px]");
    expect(readOnlyValueClasses).toContain("px-3.5");
    // The card's border on the canvas, not the field's border on the surface: a reader must
    // not take it for a control, and a focus ring it can never show would say it was one.
    expect(readOnlyValueClasses).toContain("border-admin-border");
    expect(readOnlyValueClasses).not.toContain("admin-field-border");
    expect(readOnlyValueClasses).not.toContain("bg-admin-surface");
    expect(readOnlyValueClasses).not.toContain("focus");
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
 * Who decides how wide a field is (ADR 0069).
 *
 * The shared surface declares no width and every consumer states one. Tailwind emits its
 * utilities in a fixed order rather than the order a caller writes them, so a width on the
 * shared string and a width at the call site do not compose: whichever the stylesheet emits
 * later wins, and `w-full` is emitted after `w-20`, `w-32` and `w-48`. The order line's
 * quantity and the shipping fee said `w-20` and `w-32` and filled their cell for as long as they
 * existed. Pinned from both sides: the shared strings carry no width, and no consumer is left
 * without one — which is what stops the lifted `w-full` from reappearing as a field that
 * silently shrinks to its intrinsic size.
 */
const WIDTH = /(^|\s)w-\S+/;
const CONTROLS = ["fieldControlClasses", "textAreaClasses", "idControlClasses"] as const;

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** A source with its comments and its import clauses removed, so only expressions remain. */
function codeOf(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/^\s*\/\/.*$/gm, "")
    .replaceAll(/import\s+(?:type\s+)?\{[^}]*\}\s*from\s*"[^"]*";/g, "");
}

/**
 * Every place a module composes one of the two controls into a class, as `file: classes`, and
 * every place it uses one bare — which a width cannot be added to without composing it.
 */
function consumersOf(files: Record<string, string>) {
  const composed: string[] = [];
  const bare: string[] = [];
  for (const [path, source] of Object.entries(files)) {
    const code = codeOf(source);
    for (const name of CONTROLS) {
      for (const match of code.matchAll(new RegExp(`\\$\\{${name}\\}([^\`]*)\``, "g"))) {
        composed.push(`${path}: ${match[1].trim()}`);
      }
      const uses = code.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
      const templated = code.match(new RegExp(`\\$\\{${name}\\}`, "g"))?.length ?? 0;
      for (let index = templated; index < uses; index += 1) {
        bare.push(path);
      }
    }
  }
  return { composed, bare };
}

describe("the width of a field", () => {
  const consumers = Object.fromEntries(
    Object.entries(sources).filter(([path]) => !path.includes(".test.") && path !== "./ui.ts"),
  );
  const { composed, bare } = consumersOf(consumers);

  it("found the workspace's field consumers to sweep", () => {
    // Asserted first: a glob or a pattern that matched nothing would make the cases below pass.
    expect(Object.keys(consumers).length).toBeGreaterThan(50);
    expect(composed.length).toBeGreaterThan(150);
    expect(composed.some((entry) => entry.includes("OrderEditorPage.tsx: w-32"))).toBe(true);
  });

  it("is declared by neither shared control", () => {
    for (const classes of [fieldControlClasses, textAreaClasses, idControlClasses]) {
      expect(classes).not.toMatch(WIDTH);
    }
  });

  it("gives an identifier the control's box in the monospace face, at one size", () => {
    // One font size only: a second one composed after the control's would lose to it.
    expect(idControlClasses.match(/\btext-\[[\d.]+px\]/g)).toEqual(["text-[13.5px]"]);
    expect(idControlClasses).toContain("font-mono");
    expect(idControlClasses.replace("font-mono text-[13.5px]", "text-[14.5px]")).toBe(
      fieldControlClasses,
    );
  });

  it("is stated by every consumer that composes one", () => {
    expect(composed.filter((entry) => !WIDTH.test(entry.split(": ")[1] ?? ""))).toEqual([]);
  });

  it("is never left to a control used bare", () => {
    expect(bare).toEqual([]);
  });

  it("reads a bare use and a composed one apart, and ignores a comment or an import", () => {
    // Synthetic, because every consumer in the workspace is already composed: the sweep has to
    // be shown catching the two ways a width goes missing before its silence means anything.
    // A consumer's placeholder, built rather than written so this file holds no literal one.
    const slot = (name: string) => ["$", "{", name, "}"].join("");
    const { composed: found, bare: loose } = consumersOf({
      "a.tsx": [
        'import { fieldControlClasses, textAreaClasses } from "../lib/ui";',
        "// `fieldControlClasses` is explained here and consumed nowhere on this line.",
        `const one = <input className={\`${slot("fieldControlClasses")} w-20\`} />;`,
        `const two = <input className={\`${slot("fieldControlClasses")} font-mono\`} />;`,
        "const three = <textarea className={textAreaClasses} />;",
      ].join("\n"),
    });
    expect(found).toEqual(["a.tsx: w-20", "a.tsx: font-mono"]);
    expect(found.filter((entry) => !WIDTH.test(entry.split(": ")[1] ?? ""))).toEqual([
      "a.tsx: font-mono",
    ]);
    expect(loose).toEqual(["a.tsx"]);
  });

  it("is narrow where the prototype draws it narrow", () => {
    // The order's totals draw the shipping fee as a figure; :2650 draws the tag input as the
    // rest of its strip at a 130px floor. An order line's quantity was the third, narrow in its
    // table's column; it left the table for the form below the list (ADR 0074), where the
    // methods handoff draws every field at the grid's full width.
    expect(composed).toContain("../routes/OrderEditorPage.tsx: w-32");
    expect(composed).not.toContain("../routes/OrderEditorPage.tsx: w-20");
    expect(composed).toContain("../routes/ExperimentResultsPage.tsx: w-auto min-w-[130px] flex-1");
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
  open: "ExternalLink",
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
 * All seven of the handoff's *Assets* list. The page glyph was the one held back while
 * nothing drew it and it arrived with the Documents table (PLAN-UX Slice 16) — see the
 * type's own note in `ui.ts`.
 */
const CHIP_VOCABULARY: Record<FilterChipKind, string> = {
  all: "Box",
  published: "CircleCheck",
  draft: "CircleDashed",
  attention: "TriangleAlert",
  referenced: "Link",
  unfulfilled: "Clock",
  document: "File",
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

/**
 * How a timestamp is written is a browser preference with twenty consumers (ADR 0058), so
 * these are asserted over the formatters rather than over one page: a reading that changed
 * here would change every listing in the workspace at once.
 *
 * The clock is fixed, because a relative reading is a statement about the distance between two
 * instants and one of them is `Date.now()`.
 */
const NOW = new Date("2026-09-21T12:00:00+00:00");

describe("how a timestamp is written", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("reads relative until an operator says otherwise", () => {
    // The prototype's own default: a lab is read most often while something in it is running.
    expect(formatTimestamp("2026-09-21T11:48:00+00:00")).toBe("12 minutes ago");
  });

  it("quotes a date once the preference says absolute", () => {
    writeTimestampFormat("absolute");

    expect(formatTimestamp("2026-09-19T14:07:00+00:00")).toBe(
      formatAbsoluteTimestamp("2026-09-19T14:07:00+00:00"),
    );
    expect(formatTimestamp("2026-09-19T14:07:00+00:00")).toMatch(
      /^\d{1,2} \w{3,4} 2026, \d{2}:\d{2}$/,
    );
  });

  it("names the largest unit that fits, and nothing under a minute", () => {
    expect(formatTimestamp("2026-09-21T11:59:31+00:00")).toBe("just now");
    expect(formatTimestamp("2026-09-21T11:05:00+00:00")).toBe("55 minutes ago");
    expect(formatTimestamp("2026-09-21T07:00:00+00:00")).toBe("5 hours ago");
    expect(formatTimestamp("2026-09-18T12:00:00+00:00")).toBe("3 days ago");
    expect(formatTimestamp("2026-07-21T12:00:00+00:00")).toBe("2 months ago");
    expect(formatTimestamp("2024-09-21T12:00:00+00:00")).toBe("2 years ago");
  });

  it("counts a day as a day rather than as yesterday, so a column reads down", () => {
    // `numeric: "auto"` would spell this "yesterday" and the row under it "2 days ago", which
    // is friendlier to read alone and impossible to compare in a table.
    expect(formatTimestamp("2026-09-20T12:00:00+00:00")).toBe("1 day ago");
  });

  it("says which side of now an instant is on", () => {
    expect(formatTimestamp("2026-09-23T12:00:00+00:00")).toBe("in 2 days");
  });

  it("leaves an instant it cannot read exactly as it was given", () => {
    writeTimestampFormat("absolute");
    expect(formatTimestamp("not a date")).toBe("not a date");
    writeTimestampFormat("relative");
    expect(formatTimestamp("not a date")).toBe("not a date");
  });

  /**
   * An order's `placed_at` and a frozen address's `selected_at` are fields of a canonical
   * document that an author typed. *Ago* is measured from the reader's wall clock, and a
   * fiction has none (ADR 0058).
   */
  it("keeps an authored instant a date whichever way the preference is set", () => {
    const placed = "2026-08-21T09:30:00+00:00";
    const quoted = formatAbsoluteTimestamp(placed);

    expect(formatFixtureTimestamp(placed)).toBe(quoted);
    writeTimestampFormat("relative");
    expect(formatFixtureTimestamp(placed)).toBe(quoted);
    // And the preference does still reach the instants the lab's own clock wrote.
    expect(formatTimestamp(placed)).not.toBe(quoted);
  });
});

/**
 * The add form a list grows by (PLAN-UX Slice 33): *Tone of voice*'s, spelled once here and
 * drawn by every list's add form rather than copied into each page that has one.
 */
const FORM_OPENING_ON_THE_RULE =
  /<form\b(?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*?className=\{?["`][^"`]*\bborder-t border-admin-border pt-3\b/;

describe("the add form", () => {
  const consumers = Object.entries(sources).filter(
    ([path]) => !path.includes(".test.") && path !== "./ui.ts",
  );

  it("opens on a rule, so the saved entries above it end where the blank form begins", () => {
    expect(addFormClasses.split(" ").sort()).toEqual(
      ["grid", "gap-2", "border-t", "border-admin-border", "pt-3"].sort(),
    );
  });

  it("is declared nowhere else", () => {
    expect(
      consumers
        .filter(([, source]) => /\bconst addFormClasses\b/.test(codeOf(source)))
        .map(([path]) => path),
    ).toEqual([]);
  });

  it("is spelled by hand on no form, and the lists' add forms draw with it", () => {
    // A form that opens on the rule: a card's totals or a list may open on the same rule, and
    // are not add forms.
    const spelled = consumers
      .filter(([, source]) =>
        // A string or a template literal, wherever the attribute sits in the tag: the tag runs
        // to the first `>` outside an attribute's braces (two levels deep, as an arrow handler's).
        FORM_OPENING_ON_THE_RULE.test(codeOf(source)),
      )
      .map(([path]) => path);
    expect(spelled).toEqual([]);
    // The sweep sees the spellings it is for, and not a child of a form.
    for (const form of [
      '<form className="grid gap-2 border-t border-admin-border pt-3">',
      "<form onSubmit={(event) => save(event)} className={`grid border-t border-admin-border pt-3`}>",
    ]) {
      expect(FORM_OPENING_ON_THE_RULE.test(form), form).toBe(true);
    }
    expect(
      FORM_OPENING_ON_THE_RULE.test(
        '<form onSubmit={add}><div className="grid gap-2 border-t border-admin-border pt-3">',
      ),
    ).toBe(false);
    const drawing = consumers.filter(([, source]) => /\baddFormClasses\b/.test(codeOf(source)));
    expect(drawing.length).toBeGreaterThan(5);
  });
});
