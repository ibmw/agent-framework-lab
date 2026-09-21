import type {
  FaqEntrySchema,
  PolicySchema,
  ShopContentSchema,
  ShopDocumentKind,
  SupportGuidelineSchema,
} from "@agent-lab/contracts";

/**
 * The shop's three document collections, read as one list (PLAN-UX Slice 16).
 *
 * `content.policies`, `content.support_guidelines` and `content.faq` are three lists in the
 * shop's canonical document and stay three lists: this module is a **projection** and not a
 * merge. Every read here composes the three in a fixed order and every write goes back into
 * the one list the document came from, at the position it already held — which is why nothing
 * in the payload, and therefore nothing in its fingerprint, moves when the Documents table
 * merely draws it (`docs/PLAN-UX.md`, *Deliberately not here*: "Slice 16 is a table over three
 * lists, not a new canonical shape").
 *
 * The three shapes differ in their field names — a policy has a title and a body, an FAQ entry
 * a question and an answer — and a policy carries a `PolicyKind` the other two do not. One row
 * shape is what lets the table draw them together; `documentOf` and the three writers below
 * are the only places that know which field is called what.
 */

/** A document as the table and its editor read it, whichever list it came out of. */
export interface ShopDocument {
  /** Which collection it lives in. Half of its identity; the id alone is not unique. */
  kind: ShopDocumentKind;
  id: string;
  /** The policy's title, the guideline's title, or the FAQ entry's question. */
  title: string;
  /** The policy's or guideline's body, or the FAQ entry's answer. */
  body: string;
  /**
   * A policy's own subject — Returns, Shipping — which the other two collections have no
   * field for. `null` says the collection has none, never that a policy's is unset.
   */
  policyKind: PolicySchema["kind"] | null;
}

/** What a document with no title yet is called, so no heading and no link is empty. */
export const UNTITLED_DOCUMENT = "Untitled document";

export function documentTitle(document: ShopDocument): string {
  return document.title === "" ? UNTITLED_DOCUMENT : document.title;
}

/**
 * One kind of document: where it lives in the payload, and the two words the screen uses.
 *
 * `chip` and `column` are not a third vocabulary for `ShopDocumentKind`. `SHOP_DOCUMENT_KIND`
 * in `lib/enumLabels.ts` spells each kind for the middle of a sentence — "suggested policy" —
 * and these are that same word as a heading: plural on the filter chip that selects the
 * collection, singular and capitalised in the Kind column that names one row. Both are the
 * prototype's own (`Workspace.dc.html`:1538 for the chips, :1550 for the cell), and
 * `documents.test.ts` holds them to the enum's word so the two cannot drift into two
 * vocabularies.
 *
 * `slug` is the segment the editor is addressed by and the value the table's `kind` query
 * carries. It is the chip's word lower-cased rather than the wire spelling, because it is read
 * by an operator in the address bar and `support_guideline` is not a word anybody writes.
 */
export interface DocumentKindShape {
  kind: ShopDocumentKind;
  slug: string;
  chip: string;
  column: string;
}

/**
 * The three, in the order the table draws them and the chips offer them.
 *
 * Policies, Guidelines, FAQ — the prototype's chip order, which is also the order its
 * `DOCUMENTS` fixture is written in. The order matters because it is the order of the
 * projected list and therefore of the table.
 */
export const DOCUMENT_KINDS = [
  { kind: "policy", slug: "policies", chip: "Policies", column: "Policy" },
  { kind: "support_guideline", slug: "guidelines", chip: "Guidelines", column: "Guideline" },
  { kind: "faq_entry", slug: "faq", chip: "FAQ", column: "FAQ" },
] as const satisfies readonly DocumentKindShape[];

export type DocumentKindSlug = (typeof DOCUMENT_KINDS)[number]["slug"];

export function documentKindShape(kind: ShopDocumentKind): DocumentKindShape {
  /* v8 ignore next -- the table is keyed by the union, so the lookup holds */
  return DOCUMENT_KINDS.find((entry) => entry.kind === kind) ?? DOCUMENT_KINDS[0];
}

/** The address segment for a kind. */
export function documentKindSlug(kind: ShopDocumentKind): string {
  return documentKindShape(kind).slug;
}

/**
 * The kind an address segment names, or none.
 *
 * Returns `null` rather than throwing, because the segment comes off the URL: a typed or
 * stale address is a document that cannot be found, which is a state the editor draws.
 */
export function documentKindFromSlug(slug: string): ShopDocumentKind | null {
  return DOCUMENT_KINDS.find((entry) => entry.slug === slug)?.kind ?? null;
}

function policyDocument(entry: PolicySchema): ShopDocument {
  return {
    kind: "policy",
    id: entry.id,
    title: entry.title,
    body: entry.body,
    policyKind: entry.kind,
  };
}

function guidelineDocument(entry: SupportGuidelineSchema): ShopDocument {
  return {
    kind: "support_guideline",
    id: entry.id,
    title: entry.title,
    body: entry.body,
    policyKind: null,
  };
}

function faqDocument(entry: FaqEntrySchema): ShopDocument {
  return {
    kind: "faq_entry",
    id: entry.id,
    title: entry.question,
    body: entry.answer,
    policyKind: null,
  };
}

/**
 * The three lists as one, in the chips' own order and each collection in its payload order.
 *
 * Nothing is sorted and nothing is de-duplicated: two collections may hold the same id, which
 * is exactly why a document is addressed by its kind *and* its id.
 */
export function shopDocuments(content: ShopContentSchema): ShopDocument[] {
  return [
    ...content.policies.map(policyDocument),
    ...content.support_guidelines.map(guidelineDocument),
    ...content.faq.map(faqDocument),
  ];
}

/** The ids one collection already holds, for a slug that has to be free of them. */
export function documentIds(content: ShopContentSchema, kind: ShopDocumentKind): string[] {
  return shopDocuments(content)
    .filter((document) => document.kind === kind)
    .map((document) => document.id);
}

export function findDocument(
  content: ShopContentSchema,
  kind: ShopDocumentKind,
  id: string,
): ShopDocument | undefined {
  return shopDocuments(content).find((document) => document.kind === kind && document.id === id);
}

/**
 * The document written back into the collection it came from, in the slot it already held.
 *
 * `map` rather than a filter and a push: the position in the list is part of what the shop's
 * canonical document says, so an edit that reordered a collection would move the fingerprint
 * without changing a single word. The two collections this document is not in are handed back
 * by reference.
 */
export function replaceDocument(
  content: ShopContentSchema,
  document: ShopDocument,
): ShopContentSchema {
  const { id, title, body } = document;
  switch (document.kind) {
    case "policy":
      return {
        ...content,
        policies: content.policies.map((entry) =>
          entry.id === id ? { id, title, kind: document.policyKind ?? entry.kind, body } : entry,
        ),
      };
    case "support_guideline":
      return {
        ...content,
        support_guidelines: content.support_guidelines.map((entry) =>
          entry.id === id ? { id, title, body } : entry,
        ),
      };
    default:
      return {
        ...content,
        faq: content.faq.map((entry) =>
          entry.id === id ? { id, question: title, answer: body } : entry,
        ),
      };
  }
}

/**
 * The subject a new policy starts on.
 *
 * The same default the page's own add form carried before this slice, so a policy created
 * through the new create page starts where one created through the old form did.
 */
export const DEFAULT_POLICY_KIND: PolicySchema["kind"] = "returns";

/** A new document at the end of its own collection, leaving the other two untouched. */
export function appendDocument(
  content: ShopContentSchema,
  document: ShopDocument,
): ShopContentSchema {
  const { id, title, body } = document;
  switch (document.kind) {
    case "policy":
      return {
        ...content,
        policies: [
          ...content.policies,
          { id, title, kind: document.policyKind ?? DEFAULT_POLICY_KIND, body },
        ],
      };
    case "support_guideline":
      return {
        ...content,
        support_guidelines: [...content.support_guidelines, { id, title, body }],
      };
    default:
      return { ...content, faq: [...content.faq, { id, question: title, answer: body }] };
  }
}

/** The document taken out of its own collection, leaving the other two untouched. */
export function removeDocument(
  content: ShopContentSchema,
  kind: ShopDocumentKind,
  id: string,
): ShopContentSchema {
  switch (kind) {
    case "policy":
      return { ...content, policies: content.policies.filter((entry) => entry.id !== id) };
    case "support_guideline":
      return {
        ...content,
        support_guidelines: content.support_guidelines.filter((entry) => entry.id !== id),
      };
    default:
      return { ...content, faq: content.faq.filter((entry) => entry.id !== id) };
  }
}

/** How many words the body holds, as the editor reports it under the field. */
export function wordCount(body: string): number {
  const words = body.trim();
  return words === "" ? 0 : words.split(/\s+/u).length;
}

/**
 * Where the table lives, which is also where *Policies & FAQ* points on the rail.
 *
 * The route did not move with the table: the rail's four setup entries are ADR 0054's and
 * this is one of them. What changed is what the address draws.
 */
export function documentsAt(shopId: string): string {
  return `/shops/${shopId}/setup/policies`;
}

/** The table, filtered to one kind — what `/setup/support` redirects to (ADR 0054). */
export function documentsOfKindAt(shopId: string, kind: ShopDocumentKind): string {
  return `${documentsAt(shopId)}?kind=${documentKindSlug(kind)}`;
}

/** One document's editor: its kind and its slug, which together name it (ADR 0057). */
export function documentAt(shopId: string, kind: ShopDocumentKind, id: string): string {
  return `/shops/${shopId}/setup/documents/${documentKindSlug(kind)}/${encodeURIComponent(id)}`;
}

/** Where creating one is asked. */
export function newDocumentAt(shopId: string): string {
  return `/shops/${shopId}/setup/documents/new`;
}
