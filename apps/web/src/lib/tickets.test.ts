import type { TicketContentSchema, TicketShopResourcesSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  appendMessage,
  initials,
  productTitle,
  removeMessage,
  retargetOrigin,
  toTicketRequest,
  unresolvedDocuments,
} from "./tickets";

const ORDER_ID = "9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f";
const HISTORY_AT = "2026-08-21T09:14:00.000000Z";
const TRIGGER_AT = "2026-08-21T13:40:00.000000Z";

const CONTENT: TicketContentSchema = {
  reference: "T-204",
  subject: "Wrong address concern",
  customer_profile_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  channel: "chat",
  status: "open",
  origin: { kind: "order_page", product_handle: null, order_id: ORDER_ID },
  tags: ["address-change"],
  history: [
    {
      id: "payment-question",
      author: "customer",
      body: "Did my payment go through?",
      sent_at: HISTORY_AT,
    },
  ],
  trigger: {
    id: "trigger",
    author: "customer",
    body: "I just noticed this is going to my old address.",
    sent_at: TRIGGER_AT,
  },
  linked_order_ids: [ORDER_ID],
  suggested_documents: [{ kind: "policy", document_id: "address-change" }],
  opened_at: TRIGGER_AT,
  message_count: 2,
};

describe("toTicketRequest", () => {
  it("sends the authored content without the derived thread facts", () => {
    const { payload } = toTicketRequest(CONTENT);

    expect(payload).not.toHaveProperty("opened_at");
    expect(payload).not.toHaveProperty("message_count");
    expect(payload.trigger?.body).toBe("I just noticed this is going to my old address.");
  });

  it("never sends the customer, which is fixed at creation", () => {
    expect(toTicketRequest(CONTENT).payload).not.toHaveProperty("customer_profile_id");
  });
});

describe("retargetOrigin", () => {
  it("drops the reference the new page cannot carry", () => {
    expect(retargetOrigin("product_page", CONTENT.origin)).toEqual({
      kind: "product_page",
      product_handle: null,
      order_id: null,
    });
  });

  it("keeps an order when the origin stays on the order page", () => {
    expect(retargetOrigin("order_page", CONTENT.origin).order_id).toBe(ORDER_ID);
  });

  it("clears both references for an origin that names nothing", () => {
    expect(retargetOrigin("checkout", CONTENT.origin)).toEqual({
      kind: "checkout",
      product_handle: null,
      order_id: null,
    });
  });
});

describe("appendMessage", () => {
  function added(result: ReturnType<typeof appendMessage>): TicketContentSchema {
    if (!result.ok) {
      throw new Error(`expected the thread to take the message, got: ${result.reason}`);
    }
    return result.content;
  }

  it("makes the newest customer message the trigger and demotes the previous one", () => {
    const next = added(
      appendMessage(CONTENT, "customer", "It still shows Bordeaux.", "2026-08-21T15:00:00.000Z"),
    );

    expect(next.trigger?.body).toBe("It still shows Bordeaux.");
    expect(next.history.map((entry) => entry.id)).toEqual(["payment-question", "trigger"]);
  });

  it("keeps an older past support reply in history, never as the trigger", () => {
    const next = added(
      appendMessage(
        CONTENT,
        "support_agent",
        "We can still change it.",
        HISTORY_AT.replace("09:14", "09:16"),
      ),
    );

    expect(next.trigger?.id).toBe("trigger");
    expect(next.history).toHaveLength(2);
  });

  it("keeps an older customer message in history so the trigger stays newest", () => {
    const next = added(
      appendMessage(CONTENT, "customer", "Earlier note.", "2026-08-21T08:00:00.000Z"),
    );

    expect(next.trigger?.id).toBe("trigger");
    expect(next.history.map((entry) => entry.sent_at)).toEqual([
      "2026-08-21T08:00:00.000000Z",
      HISTORY_AT,
    ]);
  });

  it("gives a message an identifier no other message in the thread holds", () => {
    const once = added(
      appendMessage(CONTENT, "support_agent", "Noted.", "2026-08-21T09:00:00.000Z"),
    );
    const twice = added(appendMessage(once, "support_agent", "Noted.", "2026-08-21T09:01:00.000Z"));

    const ids = twice.history.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("compares a browser instant against a stored one by its moment, not its digits", () => {
    // `toISOString()` writes three fractional digits and the lab stores six, so the same
    // moment must not sort as newer just because it is spelled shorter.
    const result = appendMessage(CONTENT, "customer", "Same instant.", "2026-08-21T13:40:00.000Z");

    expect(result.ok).toBe(false);
  });

  it("stores an authored moment in the canonical form the lab reads back", () => {
    const next = added(appendMessage(CONTENT, "customer", "Later.", "2026-08-21T15:00:00.000Z"));

    expect(next.trigger?.sent_at).toBe("2026-08-21T15:00:00.000000Z");
  });

  it("refuses history at the trigger's own moment rather than authoring a blocked draft", () => {
    // The backend needs the trigger *strictly* newer than every history message, and the
    // composer's minute-precision input makes an exact tie easy to type.
    const result = appendMessage(CONTENT, "customer", "Same minute.", TRIGGER_AT);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/must be older than the first message/);
  });

  it("refuses a past support reply that would land after the trigger", () => {
    const result = appendMessage(
      CONTENT,
      "support_agent",
      "Already handled.",
      "2026-08-21T15:00:00.000Z",
    );

    expect(result.ok).toBe(false);
  });

  it("takes any moment while the ticket has no first message yet", () => {
    const next = added(
      appendMessage(
        { ...CONTENT, trigger: null },
        "support_agent",
        "Anything goes.",
        "2026-08-22T10:00:00.000Z",
      ),
    );

    expect(next.history).toHaveLength(2);
  });
});

describe("removeMessage", () => {
  it("clears the trigger when the trigger is removed", () => {
    expect(removeMessage(CONTENT, "trigger").trigger).toBeNull();
  });

  it("drops one history entry and leaves the trigger alone", () => {
    const next = removeMessage(CONTENT, "payment-question");

    expect(next.history).toHaveLength(0);
    expect(next.trigger?.id).toBe("trigger");
  });
});

const RESOURCES: TicketShopResourcesSchema = {
  channels: ["chat"],
  product_handles: ["alpine-shell-jacket"],
  products: [{ handle: "alpine-shell-jacket", title: "Alpine Shell Jacket" }],
  orders: [],
  policy_ids: ["shipping"],
  support_guideline_ids: [],
  faq_entry_ids: ["delivery"],
  documents: [
    { kind: "policy", document_id: "shipping", title: "Shipping policy" },
    { kind: "faq_entry", document_id: "delivery", title: "When does it ship?" },
  ],
};

describe("productTitle", () => {
  it("names a product by the title the shop draft gives it", () => {
    expect(productTitle(RESOURCES, "alpine-shell-jacket")).toBe("Alpine Shell Jacket");
  });

  it("has no title for a handle the shop no longer holds", () => {
    expect(productTitle(RESOURCES, "trailhead-cap")).toBeNull();
  });
});

describe("unresolvedDocuments", () => {
  it("keeps the suggestions the shop no longer holds, by kind and slug together", () => {
    // `shipping` is still a policy, but no longer an FAQ entry: the pair is the identity.
    const suggested = [
      { kind: "policy", document_id: "shipping" },
      { kind: "faq_entry", document_id: "shipping" },
      { kind: "faq_entry", document_id: "delivery" },
      { kind: "support_guideline", document_id: "escalation" },
    ] as const;

    expect(unresolvedDocuments(suggested, RESOURCES)).toEqual([
      { kind: "faq_entry", document_id: "shipping" },
      { kind: "support_guideline", document_id: "escalation" },
    ]);
  });
});

describe("initials", () => {
  it("uses at most two initials and never renders an empty avatar", () => {
    expect(initials("Maya Laurent")).toBe("ML");
    expect(initials("Maya")).toBe("M");
    expect(initials("   ")).toBe("?");
  });
});
