import type { DefinitionIssueSchema, ProductViewSchema } from "@agent-lab/contracts";
import { productTitle } from "./shop";

/**
 * The entry a group of publish-gate findings is about, and the editor that resolves them.
 *
 * `form-decisions.md` 11.2 chose findings grouped by the entry that is wrong with one *Open
 * editor* per group, and that needs two things the gate's own finding does not carry: a name
 * for the entry an operator would recognise, and an address. Both are derived here from the
 * `path` the gate writes, because the path is the only thing in a `DefinitionIssueSchema` that
 * says *where* rather than *what*.
 */
export interface IssueEntry {
  /** What the group is keyed by: the path prefix every finding about this entry shares. */
  key: string;
  /** What the entry is called on the surface that edits it. */
  label: string;
  /** Where *Open* lands, as an absolute address. */
  to: string;
}

/** Findings about one entry, in the order the gate wrote them. */
export interface IssueGroup {
  key: string;
  /** The entry these findings are about, or none where the path names nothing addressable. */
  entry: IssueEntry | null;
  issues: DefinitionIssueSchema[];
  errors: number;
  warnings: number;
}

/**
 * Group findings by the entry each one is about, keeping the gate's own order.
 *
 * `entryOf` is what turns a path into an entry, and it is the caller's because only the caller
 * knows which definition these findings belong to: the shop's overview passes
 * `shopIssueEntries`, and an editor's Publish gate card passes nothing, because the entry that
 * is wrong is a row of the page the reader is already standing on and an *Open* there would
 * link a surface to itself.
 *
 * A path no resolver recognises is not dropped: it becomes a group of its own with no entry,
 * which is rendered as the bare finding the gate wrote. Silence is what a map can afford to be
 * wrong about; swallowing a finding is not.
 */
export function groupFindings(
  issues: readonly DefinitionIssueSchema[],
  entryOf?: (path: string) => IssueEntry | null,
): IssueGroup[] {
  const groups: IssueGroup[] = [];
  const byKey = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const entry = entryOf?.(issue.path) ?? null;
    const key = entry?.key ?? `path:${issue.path}`;
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, entry, issues: [], errors: 0, warnings: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.issues.push(issue);
    if (issue.severity === "error") {
      group.errors += 1;
    } else {
      group.warnings += 1;
    }
  }
  return groups;
}

/**
 * The shop sections a finding's path can name, and the surface that edits each.
 *
 * Every path `validate_shop` writes is either one of these seven roots or a product's, and the
 * sweep in `issueRoutes.test.ts` holds that claim against the domain rather than against this
 * table: it reads the codes `domain/shop.py` raises and fails when one of them is not here.
 *
 * Two roots share a surface, because Shop details is one page holding both method lists. The
 * label is the entry's rather than the page's for exactly that reason — "Payment methods" is
 * what is wrong, and Shop details is only where it is fixed.
 */
const SHOP_SECTIONS: Readonly<Record<string, { label: string; path: string }>> = {
  products: { label: "Catalog", path: "products" },
  tone_of_voice_guidelines: { label: "Tone of voice", path: "setup/tone" },
  payment_methods: { label: "Payment methods", path: "setup/identity" },
  fulfilment_methods: { label: "Fulfilment methods", path: "setup/identity" },
  policies: { label: "Policies", path: "setup/policies" },
  faq: { label: "FAQ", path: "setup/policies" },
  support_guidelines: { label: "Support guidelines", path: "setup/support" },
};

/**
 * Resolve a shop finding's path to the entry it is about.
 *
 * A product's findings are grouped on the product and not on the variant that raised them:
 * `products.alpine-shell-jacket.variants.CH-XL` and `products.alpine-shell-jacket` are one
 * entry, because the product editor is where both are answered and a reader looking at "Alpine
 * Shell Jacket · 2 errors" is being told about a product. That prefix rule is
 * `issuesForProduct`'s, read the other way round.
 *
 * `products` alone — the shop with no product at all — is the catalog rather than a product,
 * which is the whole of *where the path names one, the entry in view*: a path that names an
 * entry opens on it, and a path that names only the section opens on the section.
 *
 * A handle the draft no longer holds resolves to nothing rather than to a product editor that
 * would draw "Product not found": the draft this reads is the same one the gate validated, so
 * this can only happen to a reader whose findings are older than their draft.
 */
export function shopIssueEntries(
  shopId: string,
  products: readonly ProductViewSchema[],
): (path: string) => IssueEntry | null {
  const base = `/shops/${shopId}`;
  return (path: string) => {
    const [root, handle] = path.split(".");
    if (root === "products" && handle !== undefined) {
      const product = products.find((candidate) => candidate.handle === handle);
      if (product === undefined) {
        return null;
      }
      return {
        key: `products.${handle}`,
        label: productTitle(product),
        to: `${base}/products/${encodeURIComponent(handle)}`,
      };
    }
    const section = SHOP_SECTIONS[root];
    if (section === undefined) {
      return null;
    }
    return { key: root, label: section.label, to: `${base}/${section.path}` };
  };
}
