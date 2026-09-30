import { describe, expect, it } from "vitest";
import contentDomain from "../../../api/src/capability_lab/domain/content.py?raw";
import shopDomain from "../../../api/src/capability_lab/domain/shop.py?raw";
import { SLUG_MAX_LENGTH } from "./entryIds";
import { EXPERIMENT_LABEL_MAX_LENGTH } from "./experimentStart";
import { isVariantSku } from "./fieldRules";

/**
 * Every identifier the operator can type stops where the lab would refuse it.
 *
 * Swept rather than listed: every `DerivedIdField` in the workspace, and every other input that
 * asks for an identifier by its pattern, is found in the source and must carry a `maxLength`
 * naming the cap its backend rule enforces. A new field without one fails here — and a new
 * `DerivedIdField` fails `tsc` first, since the prop is required — and a new consumer that is
 * not in the table fails until someone reads which rule it is sent to.
 */

const sources = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The caps, by the name a call site passes them under, read off the backend below. */
const CAPS: Record<string, number> = {
  SLUG_MAX_LENGTH,
  EXPERIMENT_LABEL_MAX_LENGTH,
};

/**
 * Each consumer, by file and label, the rule its value is sent to, and the cap that rule
 * enforces. The rule is named so a reader can check the row; the cap is what is asserted.
 */
const CONSUMERS: readonly { file: string; label: string; rule: string; cap: string }[] = [
  {
    file: "DocumentsPage.tsx",
    label: "Slug",
    rule: "FAQ entry / policy ID, require_slug",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ExperimentSetupPage.tsx",
    label: "Name",
    rule: "experiment label, require_label",
    cap: "EXPERIMENT_LABEL_MAX_LENGTH",
  },
  {
    file: "OrdersPage.tsx",
    label: "Reference",
    rule: "order reference, require_business_reference",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ProductEditorPage.tsx",
    label: "Handle",
    rule: "product handle, require_slug",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ProductEditorPage.tsx",
    label: "Key",
    rule: "attribute key, require_slug",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ProductEditorPage.tsx",
    label: "New variant SKU",
    rule: "variant SKU, ProductVariant",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ProductEditorPage.tsx",
    label: "Option key",
    rule: "option key, require_slug",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ShopMethodCards.tsx",
    label: "ID",
    rule: "payment / fulfilment method ID, require_slug",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ShopSetupPages.tsx",
    label: "ID",
    rule: "tone-of-voice ID, require_slug",
    cap: "SLUG_MAX_LENGTH",
  },
  {
    file: "ShopSetupPages.tsx",
    label: "Slug",
    rule: "shop slug, require_slug",
    cap: "SLUG_MAX_LENGTH",
  },
  { file: "ShopsPage.tsx", label: "Slug", rule: "shop slug, require_slug", cap: "SLUG_MAX_LENGTH" },
  {
    file: "TicketsPage.tsx",
    label: "Reference",
    rule: "ticket reference, require_business_reference",
    cap: "SLUG_MAX_LENGTH",
  },
];

/** The JSX opening of every `<tag`, up to the `>` or `/>` that closes it, braces balanced. */
function openings(source: string, tag: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(new RegExp(`<${tag}\\b`, "g"))) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0) break;
    }
    found.push(source.slice(match.index, end + 1));
  }
  return found;
}

function capOf(opening: string): string | null {
  return /\bmaxLength=\{(\w+)\}/.exec(opening)?.[1] ?? null;
}

const fields = Object.entries(sources).flatMap(([path, source]) =>
  openings(source, "DerivedIdField").map((opening) => ({
    file: path.split("/").at(-1) ?? path,
    label: /\blabel="([^"]+)"/.exec(opening)?.[1] ?? "(no literal label)",
    cap: capOf(opening),
  })),
);

describe("an identifier the operator types", () => {
  it("reads every page and component, and no test", () => {
    const paths = Object.keys(sources);
    expect(paths).toContain("../App.tsx");
    expect(paths.some((path) => path.startsWith("../shell/"))).toBe(true);
    expect(paths.some((path) => path.startsWith("../routes/"))).toBe(true);
    expect(paths.some((path) => path.startsWith("../components/"))).toBe(true);
    expect(paths.filter((path) => path.endsWith(".test.tsx"))).toEqual([]);
  });

  it("finds the fields it sweeps", () => {
    // A sweep that silently found nothing would pass on nothing.
    expect(fields.length).toBe(CONSUMERS.length);
  });

  it("is a field the table names, with the cap of the rule it is sent to", () => {
    const key = (entry: { file: string; label: string; cap: string | null }) =>
      `${entry.file} · ${entry.label} · ${entry.cap}`;
    expect(fields.map(key).sort()).toEqual(CONSUMERS.map(key).sort());
  });

  it("asks every other identifier input for the same cap", () => {
    const patterned = Object.entries(sources).flatMap(([path, source]) =>
      openings(source, "input")
        .filter((opening) => /pattern=\{(KEBAB_PATTERN|REFERENCE_PATTERN)\}/.test(opening))
        .map((opening) => ({ file: path.split("/").at(-1), cap: capOf(opening) })),
    );
    expect(patterned.length).toBeGreaterThan(0);
    for (const entry of patterned) {
      expect(entry, entry.file).toEqual({ file: entry.file, cap: "SLUG_MAX_LENGTH" });
    }
  });
});

describe("the caps", () => {
  it("are the backend's: 64 on every slug, identifier, reference and SKU, 200 on a label", () => {
    expect(contentDomain).toMatch(new RegExp(`^MAX_SLUG_LENGTH = ${CAPS.SLUG_MAX_LENGTH}$`, "m"));
    expect(contentDomain).toMatch(
      new RegExp(`^MAX_LABEL_LENGTH = ${CAPS.EXPERIMENT_LABEL_MAX_LENGTH}$`, "m"),
    );
    for (const rule of ["require_slug", "require_identifier", "require_business_reference"]) {
      const body = contentDomain.split(`def ${rule}(`)[1]?.split("\ndef ")[0] ?? "";
      expect(body, rule).toContain("if len(value) > MAX_SLUG_LENGTH:");
    }
    expect(shopDomain).toContain("if len(self.sku) > MAX_SLUG_LENGTH:");
  });
});

describe("a variant's SKU, renamed on its row", () => {
  it("is misshapen past the cap, as `ProductVariant` would refuse it", () => {
    expect(isVariantSku("X".repeat(SLUG_MAX_LENGTH))).toBe(true);
    expect(isVariantSku("X".repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
