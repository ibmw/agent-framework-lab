import type {
  ReplaceTicketDraftRequest,
  ShopDocumentKind,
  SuggestedDocumentSchema,
  SupportChannel,
  TicketAuthor,
  TicketContentSchema,
  TicketMessageSchema,
  TicketOriginKind,
  TicketShopResourcesSchema,
  TicketStatus,
} from "@agent-lab/contracts";
import { slugify, uniqueId } from "./entryIds";
import {
  labelOf,
  SHOP_DOCUMENT_KIND,
  SUPPORT_CHANNEL,
  TICKET_AUTHOR,
  TICKET_ORIGIN_KIND,
  TICKET_STATUS,
} from "./enumLabels";
import { pythonStrip } from "./pythonText";

/**
 * Status is never carried by colour alone: every badge pairs its tone with a written label,
 * matching the design brief's accessibility constraint. The words themselves live in
 * `enumLabels.ts`, where the contract's own union holds them to its members.
 */
export function statusLabel(status: TicketStatus): string {
  return labelOf(TICKET_STATUS, status);
}

export function channelLabel(channel: SupportChannel): string {
  return labelOf(SUPPORT_CHANNEL, channel);
}

export function originLabel(kind: TicketOriginKind): string {
  return labelOf(TICKET_ORIGIN_KIND, kind);
}

export function authorLabel(author: TicketAuthor): string {
  return labelOf(TICKET_AUTHOR, author);
}

export function documentKindLabel(kind: ShopDocumentKind): string {
  return labelOf(SHOP_DOCUMENT_KIND, kind);
}

/** Which origins name a resource, mirroring the backend's own rule. */
export function originNeedsProduct(kind: TicketOriginKind): boolean {
  return kind === "product_page";
}

export function originNeedsOrder(kind: TicketOriginKind): boolean {
  return kind === "order_page";
}

/**
 * Move the origin to another page, dropping the reference the new kind cannot carry.
 *
 * The backend refuses an order-page origin that also names a product, so the editor never
 * builds one: switching the kind clears whatever no longer belongs to it.
 */
export function retargetOrigin(
  kind: TicketOriginKind,
  current: TicketContentSchema["origin"],
): TicketContentSchema["origin"] {
  return {
    kind,
    product_handle: originNeedsProduct(kind) ? current.product_handle : null,
    order_id: originNeedsOrder(kind) ? current.order_id : null,
  };
}

/**
 * The draft a client sends carries the prose a ticket authors and *selections* for
 * everything else; the customer is fixed at creation and deliberately absent from the wire,
 * as are the derived thread facts the response computes.
 */
export function toTicketRequest(content: TicketContentSchema): ReplaceTicketDraftRequest {
  return {
    payload: {
      reference: content.reference,
      // Stripped as Python strips it: `require_label` refuses a padded subject.
      subject: pythonStrip(content.subject),
      channel: content.channel,
      status: content.status,
      origin: content.origin,
      tags: content.tags,
      history: content.history,
      trigger: content.trigger,
      linked_order_ids: content.linked_order_ids,
      suggested_documents: content.suggested_documents,
    },
  };
}

/**
 * How a typed tag is spelled when stored: the slug the lab will accept, or nothing.
 *
 * `slugify` rather than a lowercase-and-hyphenate of its own, because the rule a tag has to
 * satisfy is `_require_slug` in `domain/ticket.py` — `^[a-z0-9]+(?:-[a-z0-9]+)*$` — and a
 * respelling that folded case and whitespace but kept an apostrophe or a `!` would preview
 * "Saved as `refund!`", take the chip, and be refused at save. The preview has to be the truth
 * or it is worse than no preview.
 *
 * A `pattern` on the field was the alternative and is the weaker one here: `ChipListField`'s
 * Add is a plain button with no form to submit, so constraint validation would mark the box
 * red and still let the chip through — the trap this branch's own design-direction section
 * calls out, that a pattern is not a refusal.
 *
 * The empty fallback means a tag of pure punctuation adds nothing, the way an empty field
 * adds nothing, rather than inventing the word "entry" as an identifier would.
 */
export function normalizeTag(tag: string): string {
  return slugify(tag, "");
}

/**
 * The title the shop draft gives a product, or `null` when the draft no longer holds the handle.
 *
 * `null` is the honest answer rather than the handle standing in for a title: a handle the shop
 * cannot resolve is a publish-gate error, and the editor says so instead of naming it as if it
 * were still in the catalog.
 */
export function productTitle(resources: TicketShopResourcesSchema, handle: string): string | null {
  return resources.products.find((product) => product.handle === handle)?.title ?? null;
}

/**
 * The suggestions the shop draft no longer holds, in the order the ticket keeps them.
 *
 * A document is named by its kind and its slug together (ADR 0057), so a policy and an FAQ
 * entry sharing a slug are two documents, and removing one resolves nothing about the other.
 */
export function unresolvedDocuments(
  suggested: readonly SuggestedDocumentSchema[],
  resources: TicketShopResourcesSchema,
): SuggestedDocumentSchema[] {
  return suggested.filter(
    (entry) =>
      !resources.documents.some(
        (document) => document.kind === entry.kind && document.document_id === entry.document_id,
      ),
  );
}

/**
 * The canonical instant the lab stores: ADR 0007's UTC form with six fractional digits.
 *
 * A browser's `toISOString()` writes three. Thread order is decided by comparing these
 * strings on both sides of the wire, and `"…00.000Z" > "…00.000000Z"` — so the *same*
 * moment authored here would sort as newer than one read back from the lab, and a message
 * at exactly the trigger's instant would silently take its place. Normalizing first makes
 * the comparison mean the moment rather than the punctuation.
 */
export function canonicalInstant(isoInstant: string): string {
  return isoInstant.replace(/\.(\d{3})Z$/, ".$1000Z");
}

/** Either the thread with the message in it, or why the thread cannot take it. */
export type MessageAddition =
  | { ok: true; content: TicketContentSchema }
  | { ok: false; reason: string };

/**
 * Append one authored message to the thread.
 *
 * A message from the customer that arrives strictly after everything else becomes the
 * trigger — the one message every arm receives — and the previous trigger falls back into
 * history. Anything else is prior history.
 *
 * The backend requires the trigger to be *strictly* newer than every history message, so a
 * message at or after the trigger's moment that cannot itself become the trigger is refused
 * here rather than saved into a draft the publish gate would then block. The editor holds
 * only threads the lab would take, the way the order editor holds only quantities it would.
 */
export function appendMessage(
  content: TicketContentSchema,
  author: TicketAuthor,
  body: string,
  authoredAt: string,
): MessageAddition {
  const sentAt = canonicalInstant(authoredAt);
  const taken = [...content.history.map((entry) => entry.id), content.trigger?.id ?? ""];
  const message: TicketMessageSchema = {
    id: uniqueId(slugify(body.slice(0, 40), "message"), taken),
    author,
    body,
    sent_at: sentAt,
  };

  if (author === "customer" && isNewest(content, sentAt)) {
    return {
      ok: true,
      content: {
        ...content,
        history: sortMessages(
          content.trigger === null ? content.history : [...content.history, content.trigger],
        ),
        trigger: message,
      },
    };
  }

  if (content.trigger !== null && sentAt >= content.trigger.sent_at) {
    return {
      ok: false,
      reason:
        "Prior history must be older than the first message every arm receives. Move this " +
        "message earlier, or send it later as the customer to make it the new first message.",
    };
  }

  return {
    ok: true,
    content: { ...content, history: sortMessages([...content.history, message]) },
  };
}

/** Drop one message from the thread, whether it is history or the trigger itself. */
export function removeMessage(
  content: TicketContentSchema,
  messageId: string,
): TicketContentSchema {
  if (content.trigger?.id === messageId) {
    return { ...content, trigger: null };
  }
  return {
    ...content,
    history: content.history.filter((entry) => entry.id !== messageId),
  };
}

function isNewest(content: TicketContentSchema, sentAt: string): boolean {
  const moments = [...content.history, ...(content.trigger ? [content.trigger] : [])].map(
    (entry) => entry.sent_at,
  );
  return moments.every((moment) => moment < sentAt);
}

function sortMessages(messages: TicketMessageSchema[]): TicketMessageSchema[] {
  return [...messages].sort((left, right) =>
    left.sent_at === right.sent_at
      ? left.id.localeCompare(right.id)
      : left.sent_at.localeCompare(right.sent_at),
  );
}

/** A thread timestamp as the frame shows it: the day, then the time of each bubble. */
export function messageDay(instant: string): string {
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime()) ? instant : parsed.toISOString().slice(0, 10);
}

export function messageTime(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    return instant;
  }
  return parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function initials(displayName: string): string {
  const parts = displayName.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
