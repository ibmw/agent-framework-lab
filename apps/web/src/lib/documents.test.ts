import type { ShopContentSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  appendDocument,
  DOCUMENT_KINDS,
  documentAt,
  documentIds,
  documentKindFromSlug,
  documentKindShape,
  documentsOfKindAt,
  documentTitle,
  findDocument,
  removeDocument,
  replaceDocument,
  shopDocuments,
  UNTITLED_DOCUMENT,
  wordCount,
} from "./documents";
import { SHOP_DOCUMENT_KIND } from "./enumLabels";
import { toPayload } from "./shop";

const CONTENT: ShopContentSchema = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [],
  // Deliberately in an order no sort would produce, and with one id held by two collections.
  policies: [
    { id: "returns-policy", title: "Returns policy", kind: "returns", body: "Thirty days." },
    { id: "shipping", title: "Shipping and delivery", kind: "shipping", body: "Two to five." },
  ],
  faq: [
    { id: "shipping", question: "When will it arrive?", answer: "Two to five working days." },
    { id: "refunds", question: "How long does a refund take?", answer: "Five working days." },
  ],
  payment_methods: [],
  fulfilment_methods: [],
  support_guidelines: [
    { id: "returns-desk", title: "Returns without a receipt", body: "Offer a credit note." },
    { id: "escalation", title: "When to escalate", body: "Above 200 EUR, tier 2." },
  ],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
};

/**
 * The canonical rendering a fingerprint is taken over, as far as a browser can stand in for it.
 *
 * `application/canonical_json.py` sorts object keys and leaves arrays in the order they were
 * given, then hashes the bytes — so two payloads with the same entries in the same order have
 * the same fingerprint, and one whose list was reordered does not, however identical it looks
 * on screen. This renders with sorted keys for the same reason, which makes byte equality here
 * the honest client-side statement of "the fingerprint has not moved".
 */
function canonical(content: ShopContentSchema): string {
  return JSON.stringify(toPayload(content), (_key, value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : 1,
    );
    return Object.fromEntries(entries);
  });
}

describe("the shop's three document collections, read as one list", () => {
  it("projects the three in the chips' order, each in its own payload order", () => {
    expect(shopDocuments(CONTENT).map((document) => `${document.kind}:${document.id}`)).toEqual([
      "policy:returns-policy",
      "policy:shipping",
      "support_guideline:returns-desk",
      "support_guideline:escalation",
      "faq_entry:shipping",
      "faq_entry:refunds",
    ]);
  });

  it("carries an FAQ entry's question and answer under the one pair of names", () => {
    expect(findDocument(CONTENT, "faq_entry", "shipping")).toEqual({
      kind: "faq_entry",
      id: "shipping",
      title: "When will it arrive?",
      body: "Two to five working days.",
      policyKind: null,
    });
  });

  it("keeps a policy's own subject and gives the other two collections none", () => {
    expect(findDocument(CONTENT, "policy", "returns-policy")?.policyKind).toBe("returns");
    expect(findDocument(CONTENT, "support_guideline", "returns-desk")?.policyKind).toBeNull();
  });

  it("tells two documents apart by their kind, because one id may be in two collections", () => {
    // The whole reason a document is addressed by a pair: `shipping` is a policy *and* an FAQ
    // entry here, and `ContextDocumentSchema` names both halves for the same reason.
    expect(findDocument(CONTENT, "policy", "shipping")?.title).toBe("Shipping and delivery");
    expect(findDocument(CONTENT, "faq_entry", "shipping")?.title).toBe("When will it arrive?");
    expect(documentIds(CONTENT, "policy")).toEqual(["returns-policy", "shipping"]);
    expect(documentIds(CONTENT, "faq_entry")).toEqual(["shipping", "refunds"]);
  });

  it("finds nothing for a kind the address does not name", () => {
    expect(documentKindFromSlug("guidelines")).toBe("support_guideline");
    expect(documentKindFromSlug("memos")).toBeNull();
    expect(findDocument(CONTENT, "policy", "nothing-here")).toBeUndefined();
  });
});

describe("a document written back", () => {
  /**
   * The claim PLAN-UX Slice 16's third bullet makes, held to the byte.
   *
   * The table is a presentation of three lists and not a merge of them, so writing a document
   * back unchanged must leave the shop's canonical document exactly as it was — same
   * collections, same entries, same order. A projection that rebuilt a list by filtering and
   * pushing would pass every assertion about the screen and move the fingerprint of every
   * shop that used it.
   *
   * **One document at a time, and only then all of them.** Folding over the whole projection
   * is not the proof it looks like: rotating each list once fully lands every element back
   * where it started, so a filter-and-push `replaceDocument` passes a reduce over all six. It
   * does not pass this loop — writing `returns-policy` back alone would yield
   * `[shipping, returns-policy]` — which is why the per-document assertion is the one that
   * carries the claim, and every collection in the fixture holds two entries so that no
   * branch is exercised only at a length where the defect is invisible.
   */
  it("leaves the payload byte-identical when one document is written back unchanged", () => {
    const before = canonical(CONTENT);

    for (const document of shopDocuments(CONTENT)) {
      const after = replaceDocument(CONTENT, document);
      expect(canonical(after), `${document.kind}:${document.id}`).toBe(before);
      expect(toPayload(after), `${document.kind}:${document.id}`).toStrictEqual(toPayload(CONTENT));
    }
  });

  it("leaves it byte-identical after every document is written back, which a session is", () => {
    const after = shopDocuments(CONTENT).reduce(
      (content, document) => replaceDocument(content, document),
      CONTENT,
    );

    expect(canonical(after)).toBe(canonical(CONTENT));
    expect(toPayload(after)).toStrictEqual(toPayload(CONTENT));
  });

  it("changes one entry in its slot and hands the other two collections back untouched", () => {
    const edited = replaceDocument(CONTENT, {
      kind: "policy",
      id: "returns-policy",
      title: "Returns policy",
      body: "Sixty days.",
      policyKind: "returns",
    });

    expect(edited.policies).toStrictEqual([
      { id: "returns-policy", title: "Returns policy", kind: "returns", body: "Sixty days." },
      { id: "shipping", title: "Shipping and delivery", kind: "shipping", body: "Two to five." },
    ]);
    expect(edited.faq).toBe(CONTENT.faq);
    expect(edited.support_guidelines).toBe(CONTENT.support_guidelines);
  });

  it("appends and removes inside one collection only", () => {
    const added = appendDocument(CONTENT, {
      kind: "support_guideline",
      id: "goodwill",
      title: "Goodwill and exceptions",
      body: "",
      policyKind: null,
    });
    expect(added.support_guidelines.map((entry) => entry.id)).toEqual([
      "returns-desk",
      "escalation",
      "goodwill",
    ]);
    expect(added.policies).toBe(CONTENT.policies);

    const removed = removeDocument(added, "support_guideline", "goodwill");
    expect(canonical(removed)).toBe(canonical(CONTENT));
  });

  it("gives a new policy the subject the old add form defaulted to", () => {
    const added = appendDocument(CONTENT, {
      kind: "policy",
      id: "warranty",
      title: "Warranty",
      body: "",
      policyKind: null,
    });
    expect(added.policies[2]).toStrictEqual({
      id: "warranty",
      title: "Warranty",
      kind: "returns",
      body: "",
    });
  });
});

/** The column's word as the chip says it; an initialism is drawn with no plural at all. */
function pluralOf(word: string): string {
  if (word === word.toUpperCase()) {
    return word;
  }
  return word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
}

describe("the two words a kind wears", () => {
  /**
   * Not a third vocabulary. `SHOP_DOCUMENT_KIND` holds the one word for each kind and these
   * are that word as a heading — plural on the chip, singular and capitalised in the column —
   * so a kind renamed in `enumLabels.ts` and not here fails before it reaches a screen.
   */
  it("says the same word the enum says, as a chip and as a column", () => {
    for (const entry of DOCUMENT_KINDS) {
      const word = SHOP_DOCUMENT_KIND[entry.kind].label;
      expect(entry.column.toLowerCase(), entry.kind).toBe(word.toLowerCase());
      expect(entry.chip, entry.kind).toBe(pluralOf(entry.column));
      expect(entry.slug).toBe(entry.chip.toLowerCase());
    }
  });

  it("names every kind the contract has, and invents none", () => {
    expect(DOCUMENT_KINDS.map((entry) => entry.kind).sort()).toEqual(
      Object.keys(SHOP_DOCUMENT_KIND).sort(),
    );
    expect(documentKindShape("faq_entry").column).toBe("FAQ");
  });
});

describe("where a document is addressed", () => {
  it("names the kind and the slug, and escapes the slug", () => {
    expect(documentAt("s1", "support_guideline", "returns-desk")).toBe(
      "/shops/s1/setup/documents/guidelines/returns-desk",
    );
    expect(documentAt("s1", "faq_entry", "a b")).toBe("/shops/s1/setup/documents/faq/a%20b");
  });

  it("carries the filter the retired guidelines page redirects to", () => {
    expect(documentsOfKindAt("s1", "support_guideline")).toBe(
      "/shops/s1/setup/policies?kind=guidelines",
    );
  });
});

describe("what the editor reads off a document", () => {
  it("stands a name in for an untitled document, so no heading is empty", () => {
    expect(documentTitle({ kind: "policy", id: "x", title: "", body: "", policyKind: null })).toBe(
      UNTITLED_DOCUMENT,
    );
  });

  it("counts the words that are in the box and none that are not", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   \n  ")).toBe(0);
    expect(wordCount("Thirty days.\n\nNo receipt needed.")).toBe(5);
  });
});
