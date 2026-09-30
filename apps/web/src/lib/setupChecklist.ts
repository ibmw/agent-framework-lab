import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import type { Currency } from "./currencies";
import { variantCurrencyUnsupportedRule } from "./fieldRules";
import type { ShopDraft } from "./productKeys";

/**
 * One line of the setup checklist (`Workspace.dc.html` :2156): a thing a publishable shop has,
 * whether the gate says this shop has it, and a note.
 *
 * `findings` are the gate's own findings the line answers for, whole — severity, message and
 * path — so a line that is still to do says what the gate says in its words, and the panel
 * that used to list every finding flat loses none of them by grouping them here.
 */
export interface ChecklistLine {
  label: string;
  done: boolean;
  /** What the draft on screen holds towards it, said while it is done. */
  note: string;
  findings: DefinitionIssueSchema[];
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The shop-wide lines, each owning the publish-gate codes `validate_shop` raises for its
 * absence, in the order the workspace's rail reaches them.
 *
 * Every shop-level code `domain/shop.py` raises is claimed by exactly one line here, and every
 * other code — a product's or a variant's — belongs to the last line, "No blocking findings";
 * `setupChecklist.test.ts` holds both against the domain's source. A code the gate grows later
 * falls to the last line until it is given one, so it is never dropped.
 */
const SHOP_LINES: readonly {
  label: string;
  codes: readonly string[];
  note: (content: ShopDraft) => string;
}[] = [
  {
    label: "At least one product",
    codes: ["shop_without_product"],
    note: (content) => `${counted(content.products.length, "product", "products")} in the draft`,
  },
  {
    label: "A payment method enabled",
    codes: ["shop_without_payment_method"],
    note: (content) =>
      `${counted(
        content.payment_methods.filter((method) => method.enabled).length,
        "method",
        "methods",
      )} enabled`,
  },
  {
    label: "A fulfilment method",
    codes: ["shop_without_fulfilment_method"],
    note: (content) => `${counted(content.fulfilment_methods.length, "method", "methods")} offered`,
  },
  {
    label: "A policy",
    codes: ["shop_without_policy"],
    note: (content) => `${counted(content.policies.length, "policy", "policies")} authored`,
  },
  {
    label: "A tone of voice default",
    codes: ["shop_without_tone_of_voice", "tone_of_voice_without_default"],
    note: (content) =>
      content.tone_of_voice_guidelines.find((guideline) => guideline.is_default)?.name ??
      "None set in the draft",
  },
  {
    label: "An FAQ",
    codes: ["shop_without_faq"],
    note: (content) => `${counted(content.faq.length, "answer", "answers")} authored`,
  },
  {
    label: "Support guidelines",
    codes: ["shop_without_support_guideline"],
    note: (content) =>
      `${counted(content.support_guidelines.length, "guideline", "guidelines")} authored`,
  },
];

/** The codes a shop-wide line answers for: everything else is "No blocking findings"'. */
export const CHECKLIST_SHOP_CODES: readonly string[] = SHOP_LINES.flatMap((line) => line.codes);

/**
 * The checklist for a shop draft, read off the gate's findings.
 *
 * Whether a line is done is the gate's answer, and the gate answers for the *saved* draft; the
 * notes are counted off the draft on screen, which is the one the operator is editing. The
 * panel says so while the two can differ (`dirty`).
 *
 * A shop-wide line is done when the gate raises none of its codes, whatever their severity
 * (ADR 0071): each names a thing the shop has, and a shop with no FAQ does not have one because
 * the gate only warns about it. Its "!" says the thing is missing, not that publication is
 * refused; the finding under it says the severity in the gate's words.
 *
 * The last line is the prototype's "No blocking findings": every finding no shop-wide line
 * owns — a product's, a variant's — whatever its severity. It is done while none of them is an
 * error, because its label is about what blocks; its warnings are still listed under it.
 */
export function setupChecklist(
  content: ShopDraft,
  issues: readonly DefinitionIssueSchema[],
): { lines: ChecklistLine[]; rest: ChecklistLine } {
  const lines = SHOP_LINES.map((line) => {
    const findings = issues.filter((issue) => line.codes.includes(issue.code));
    return { label: line.label, done: findings.length === 0, note: line.note(content), findings };
  });
  const findings = issues.filter((issue) => !CHECKLIST_SHOP_CODES.includes(issue.code));
  const errors = findings.filter((issue) => issue.severity === "error").length;
  const warnings = findings.length - errors;
  return {
    lines,
    rest: {
      label: "No blocking findings",
      done: errors === 0,
      note:
        findings.length === 0
          ? "Nothing else in the draft is refused."
          : [
              errors > 0 ? counted(errors, "error", "errors") : null,
              warnings > 0 ? counted(warnings, "warning", "warnings") : null,
            ]
              .filter(Boolean)
              .join(" · "),
      findings,
    },
  };
}

/**
 * `variant_currency_unsupported`, said as the operator unticks a currency: each variant of the
 * draft on screen priced in a currency the shop does not sell in, keyed by that currency.
 *
 * The gate raises it on the saved draft only; this is the same rule evaluated on the draft on
 * screen, in the gate's own sentence, so the currency's chip says it before the save rather
 * than the checklist after it.
 */
export function unsoldCurrencyFindings(content: ShopDraft): Partial<Record<Currency, string[]>> {
  const findings: Partial<Record<Currency, string[]>> = {};
  for (const product of content.products) {
    for (const variant of product.variants) {
      const currency = variant.price?.currency;
      if (currency === undefined || content.identity.currencies.includes(currency)) {
        continue;
      }
      findings[currency] = [
        ...(findings[currency] ?? []),
        variantCurrencyUnsupportedRule(variant.sku, currency),
      ];
    }
  }
  return findings;
}
