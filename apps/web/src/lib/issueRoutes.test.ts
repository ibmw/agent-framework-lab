/// <reference types="node" />
// This suite reads the backend's own source for its cases, which is the one thing in `src`
// that needs Node's filesystem. `tsconfig.app.json` pins `types` to jest-dom, so the
// reference is declared here rather than opening `node` to every module in the application.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DefinitionIssueSchema, ProductViewSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import { groupFindings, shopIssueEntries } from "./issueRoutes";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

/**
 * The gate's vocabulary, read out of the backend that writes it.
 *
 * The map below turns a finding's `path` into the surface that resolves it, and the one way it
 * can quietly stop being true is the domain raising a finding at a path nobody added a row
 * for. A sweep over the codes this application already handles would never catch that — it
 * would be the frontend checking its own homework — so the cases come from
 * `apps/api/src/capability_lab`, the way ADR 0023 parameterizes the tool sweep over the
 * contract registry rather than over a list kept beside it.
 *
 * `code` is a free string in the published contract (`DefinitionIssueSchema`), so there is no
 * generated enum to read and the source is the registry. The reading is deliberately shallow:
 * the first argument of every `issue_error`/`issue_warning` call is the code and the third is
 * the path, and each is read only where it is written as a plain literal.
 *
 * **What that leaves out, exactly.** Seven call sites in `domain/scenario.py` compose their
 * *code* from a prefix (`f"{code_prefix}_order_missing_from_shop"`,
 * `f"{noun}_block_unpublished"`), so those codes are not in `GATE_CODES` at all; none of them
 * is the shop's, so no assertion below is weakened by their absence, but the figure this
 * sweep reports is "every code written as a literal" rather than "every code". And a *path*
 * composed from an identifier or an f-string is read as none — that is most of the shop's
 * own, which are built from a handle or a SKU, so those rows are spelled out in
 * `SHOP_GATE_MAP` and held to the identifier the domain builds them from instead.
 */
function domainRoot(): string {
  // Found by walking up rather than by a relative hop, so this keeps working whether the
  // suite is run from `apps/web` or from the repository root.
  let at = process.cwd();
  for (;;) {
    const candidate = join(at, "apps", "api", "src", "capability_lab");
    if (existsSync(candidate)) {
      return candidate;
    }
    const up = dirname(at);
    if (up === at) {
      throw new Error("the backend this sweep reads its cases from is not in this checkout");
    }
    at = up;
  }
}

const DOMAIN_ROOT = domainRoot();

const GATE_CALL = /\b(?:issue_error|issue_warning|_error|_warning)\(/g;

/** One call's arguments, as source text, split at the commas that are not inside anything. */
function argumentsOf(source: string, from: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = from;
  for (let at = from; at < source.length; at += 1) {
    const character = source[at];
    if (quote !== null) {
      if (character === "\\") {
        at += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        args.push(source.slice(start, at));
        return args;
      }
      depth -= 1;
    } else if (character === "," && depth === 0) {
      args.push(source.slice(start, at));
      start = at + 1;
    }
  }
  return args;
}

/** A plain `"…"` literal, or none where the argument is composed. */
function literal(argument: string | undefined): string | null {
  const match = /^\s*"([^"\\]*)"\s*$/.exec(argument ?? "");
  return match === null ? match : match[1];
}

interface GateCode {
  code: string;
  /** The module that raises it, relative to `capability_lab`. */
  module: string;
  /** The path it writes, where that is a literal rather than composed from an identifier. */
  path: string | null;
  /** The path argument as the domain writes it, literal or not — `variant_path`, `f"…"`. */
  pathSource: string;
}

function pythonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__pycache__" ? [] : pythonFiles(full);
    }
    return entry.name.endsWith(".py") ? [full] : [];
  });
}

function gateCodes(): GateCode[] {
  const found: GateCode[] = [];
  for (const file of pythonFiles(DOMAIN_ROOT)) {
    const source = readFileSync(file, "utf8");
    const module = file.slice(DOMAIN_ROOT.length + 1);
    for (const call of source.matchAll(GATE_CALL)) {
      const args = argumentsOf(source, (call.index ?? 0) + call[0].length);
      const code = literal(args[0]);
      if (code !== null) {
        found.push({
          code,
          module,
          path: literal(args[2]),
          pathSource: (args[2] ?? "").trim(),
        });
      }
    }
  }
  return found;
}

const GATE_CODES = gateCodes();
const SHOP_MODULE = join("domain", "shop.py");
const SHOP_GATES = GATE_CODES.filter((gate) => gate.module === SHOP_MODULE);
const SHOP_CODES = [...new Set(SHOP_GATES.map((gate) => gate.code))].sort();

const PRODUCTS: ProductViewSchema[] = [
  {
    handle: "alpine-shell-jacket",
    title: "Alpine Shell Jacket",
    description: "",
    status: "active",
    category: "Jackets",
    options: [],
    variants: [],
    attributes: [],
    media: [],
    reviews: [],
    ratings: { average_rating: null, review_count: 0 },
  },
  {
    handle: "unnamed",
    title: "",
    description: "",
    status: "draft",
    category: "",
    options: [],
    variants: [],
    attributes: [],
    media: [],
    reviews: [],
    ratings: { average_rating: null, review_count: 0 },
  },
];

const PRODUCT_EDITOR = `/shops/${SHOP_ID}/products/alpine-shell-jacket`;

/**
 * Every code `validate_shop` raises, the path it writes it at, and where *Open* lands.
 *
 * Exhaustive by assertion rather than by type: the first case below holds these keys against
 * the codes read out of `domain/shop.py`, so a rule added to the shop's gate fails here by
 * name until somebody decides which surface answers it.
 */
const SHOP_GATE_MAP: Record<string, { path: string; entry: string; to: string }> = {
  shop_without_product: {
    path: "products",
    entry: "Catalog",
    to: `/shops/${SHOP_ID}/products`,
  },
  product_without_variant: {
    path: "products.alpine-shell-jacket",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  product_without_description: {
    path: "products.alpine-shell-jacket",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  product_without_media: {
    path: "products.alpine-shell-jacket",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  duplicate_variant_options: {
    path: "products.alpine-shell-jacket",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  variant_without_price: {
    path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  variant_currency_unsupported: {
    path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  variant_missing_option: {
    path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  variant_unknown_option: {
    path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  variant_unknown_option_value: {
    path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  variant_in_stock_without_inventory: {
    path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
    entry: "Alpine Shell Jacket",
    to: PRODUCT_EDITOR,
  },
  shop_without_tone_of_voice: {
    path: "tone_of_voice_guidelines",
    entry: "Tone of voice",
    to: `/shops/${SHOP_ID}/setup/tone`,
  },
  tone_of_voice_without_default: {
    path: "tone_of_voice_guidelines",
    entry: "Tone of voice",
    to: `/shops/${SHOP_ID}/setup/tone`,
  },
  shop_without_payment_method: {
    path: "payment_methods",
    entry: "Payment methods",
    to: `/shops/${SHOP_ID}/setup/identity`,
  },
  shop_without_fulfilment_method: {
    path: "fulfilment_methods",
    entry: "Fulfilment methods",
    to: `/shops/${SHOP_ID}/setup/identity`,
  },
  shop_without_policy: {
    path: "policies",
    entry: "Policies",
    to: `/shops/${SHOP_ID}/setup/policies`,
  },
  shop_without_faq: {
    path: "faq",
    entry: "FAQ",
    to: `/shops/${SHOP_ID}/setup/policies`,
  },
  shop_without_support_guideline: {
    path: "support_guidelines",
    entry: "Support guidelines",
    to: `/shops/${SHOP_ID}/setup/support`,
  },
};

function issue(path: string, severity: DefinitionIssueSchema["severity"] = "error") {
  return { severity, code: "code", message: "something is wrong", path };
}

describe("the gate vocabulary this sweep is over", () => {
  it("is read out of the backend, and is not empty", () => {
    // A parameterized sweep that became empty reports as passing, which is the one way
    // everything below could stop proving anything unnoticed (ADR 0023).
    expect(GATE_CODES.length).toBeGreaterThan(50);
    expect(new Set(GATE_CODES.map((gate) => gate.module)).size).toBeGreaterThan(5);
    expect(SHOP_CODES.length).toBeGreaterThan(10);
    // And the reading works: two codes read from two different modules, spelled as the
    // domain spells them. A refactor that moved the gate would fail here rather than
    // silently sweeping nothing.
    expect(SHOP_CODES).toContain("variant_without_price");
    expect(GATE_CODES.map((gate) => gate.code)).toContain("scenario_without_objective");
  });
});

describe("the path-to-route map", () => {
  const entryOf = shopIssueEntries(SHOP_ID, PRODUCTS);

  it("answers every code the shop's publish gate raises, and invents none", () => {
    expect(Object.keys(SHOP_GATE_MAP).sort()).toEqual(SHOP_CODES);
  });

  it.each(SHOP_CODES)("lands %s on the surface that resolves it", (code) => {
    const expected = SHOP_GATE_MAP[code];
    const entry = entryOf(expected.path);
    expect(entry, `${code} at ${expected.path} resolves nowhere`).not.toBeNull();
    expect(entry?.label).toBe(expected.entry);
    expect(entry?.to).toBe(expected.to);
  });

  /**
   * The paths above are the domain's, not this table's guesses.
   *
   * Holding the *codes* against the domain and then resolving each row's own path would pass a
   * gate that moved `shop_without_faq` from `faq` to `content.faq` while the overview silently
   * lost that group's Open — which is exactly the failure this sweep exists to catch. So a
   * literal path is compared to the domain's, and a composed one is held to the two
   * identifiers `_validate_product` builds its paths in (`path` for the product,
   * `variant_path` for one of its variants), because a third would be a shape this map has
   * never seen.
   */
  const SHOP_PATH_SOURCES = ["path", "variant_path"];

  it("reads the shop's own paths rather than guessing at them", () => {
    const literals = SHOP_GATES.filter((gate) => gate.path !== null);
    const composed = SHOP_GATES.filter((gate) => gate.path === null);
    expect(literals.length, "no shop gate writes a literal path any more").toBeGreaterThan(0);
    expect(composed.length, "no shop gate composes a path any more").toBeGreaterThan(0);

    for (const gate of literals) {
      expect(gate.path, `${gate.code} is raised at a path the map does not expect`).toBe(
        SHOP_GATE_MAP[gate.code].path,
      );
    }
    for (const gate of composed) {
      expect(
        SHOP_PATH_SOURCES,
        `${gate.code} composes its path from ${gate.pathSource}, which this map has not seen`,
      ).toContain(gate.pathSource);
      // And the row's own path is of the shape that identifier builds.
      expect(SHOP_GATE_MAP[gate.code].path).toMatch(
        gate.pathSource === "variant_path"
          ? /^products\.[^.]+\.variants\.[^.]+$/
          : /^products\.[^.]+$/,
      );
    }
  });

  it("claims no path another definition's gate writes", () => {
    // The map is the shop's. A ticket, an order or a scenario renders its findings on its own
    // editor, where there is no Open to give — and a root one of them happened to share with
    // the shop would send a reader to a shop surface about a finding that is not the shop's.
    const foreign = GATE_CODES.filter((gate) => gate.module !== SHOP_MODULE && gate.path !== null);
    expect(foreign.length).toBeGreaterThan(20);
    for (const gate of foreign) {
      expect(
        entryOf(gate.path ?? ""),
        `${gate.code} (${gate.module}) reaches a shop surface`,
      ).toBeNull();
    }
  });

  it("groups a product's findings on the product, whichever depth raised them", () => {
    const groups = groupFindings(
      [
        issue("products.alpine-shell-jacket.variants.NS-ASJ-CH-XL"),
        issue("products.alpine-shell-jacket"),
        issue("policies"),
      ],
      entryOf,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].entry?.label).toBe("Alpine Shell Jacket");
    expect(groups[0].entry?.to).toBe(PRODUCT_EDITOR);
    expect(groups[0].errors).toBe(2);
    expect(groups[1].entry?.label).toBe("Policies");
  });

  it("calls an unnamed product what every other surface calls it", () => {
    expect(entryOf("products.unnamed")?.label).toBe("Untitled product");
  });

  it("keeps a finding whose path it does not recognise, and offers it no Open", () => {
    const groups = groupFindings([issue("identity.slug"), issue("policies")], entryOf);

    expect(groups).toHaveLength(2);
    expect(groups[0].entry).toBeNull();
    expect(groups[0].issues[0].path).toBe("identity.slug");
    expect(groups[1].entry?.label).toBe("Policies");
  });

  it("resolves a handle the draft no longer holds to nothing rather than to a dead editor", () => {
    expect(entryOf("products.removed-yesterday")).toBeNull();
  });

  it("counts each severity in the group it belongs to", () => {
    const groups = groupFindings(
      [
        issue("products.alpine-shell-jacket"),
        issue("products.alpine-shell-jacket", "warning"),
        issue("faq", "warning"),
      ],
      entryOf,
    );

    expect(groups[0]).toMatchObject({ errors: 1, warnings: 1 });
    expect(groups[1]).toMatchObject({ errors: 0, warnings: 1 });
  });

  it("leaves findings ungrouped where the caller can say nothing about where they are fixed", () => {
    const groups = groupFindings([issue("rubric"), issue("model.provider")]);

    expect(groups.map((group) => group.entry)).toEqual([null, null]);
    expect(groups).toHaveLength(2);
  });
});
