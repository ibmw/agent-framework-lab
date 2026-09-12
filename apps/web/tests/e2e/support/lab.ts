import { type APIRequestContext, expect } from "@playwright/test";

/**
 * The whole chain, built once through the public API, so a browser can be put on any surface a
 * tour describes.
 *
 * The bench and the results screen do not exist until a shop, a customer, an order, a ticket,
 * both block libraries, a published recipe, a support identity and two published agent
 * configurations exist — that is the dependency order ADR 0044 measured, and it is what the
 * anchor sweep has to stand on. Driving it through the UI is what `experiment-start.spec.ts`
 * does, deliberately and slowly, because the UI is what that journey is about. Here the chain is
 * scaffolding rather than subject, so it is built at the HTTP boundary in one pass.
 *
 * Every reference is suffixed so the suite's shared database can hold this alongside whatever
 * the other journeys are creating at the same time.
 */

export interface BuiltLab {
  shopId: string;
  scenarioId: string;
  experimentId: string;
}

async function json(
  request: APIRequestContext,
  method: "post" | "put",
  url: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const response = await request[method](url, { data });
  // Named rather than left to a downstream `undefined`: a gate that refused says why, and that
  // sentence is the whole value of failing here instead of three steps later.
  expect(response.ok(), `${method.toUpperCase()} ${url} → ${await response.text()}`).toBe(true);
  return response.status() === 204 ? {} : ((await response.json()) as Record<string, unknown>);
}

async function read(request: APIRequestContext, url: string): Promise<Record<string, unknown>> {
  const response = await request.get(url);
  expect(response.ok(), `GET ${url} → ${await response.text()}`).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

export async function buildLab(request: APIRequestContext): Promise<BuiltLab> {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const reference = unique.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // -- the shop ------------------------------------------------------------
  const shopId = String(
    (
      await json(request, "post", "/api/v1/shops", {
        identity: {
          name: `Northstar ${unique}`,
          slug: `northstar-${unique}`,
          locale: "en-GB",
          currencies: ["EUR"],
          channels: ["chat"],
        },
      })
    ).shop_id,
  );
  const draft = (await read(request, `/api/v1/shops/${shopId}/draft`)).content as Record<
    string,
    unknown
  >;
  delete draft.default_tone_of_voice_id;
  await json(request, "put", `/api/v1/shops/${shopId}/draft`, {
    payload: {
      ...draft,
      products: [
        {
          handle: "alpine-shell-jacket",
          title: "Alpine Shell Jacket",
          description: "A three-layer shell.",
          status: "active",
          category: "Outerwear",
          options: [{ key: "color", name: "Color", values: ["Ocean Blue"] }],
          variants: [
            {
              sku: "NS-ASJ-OB-M",
              option_values: [{ key: "color", value: "Ocean Blue" }],
              availability: "in_stock",
              stock_quantity: 12,
              price: { amount: "249.00", currency: "EUR" },
            },
          ],
          media: [],
          attributes: [],
          reviews: [],
        },
      ],
      policies: [
        {
          id: "address-change",
          title: "Address-change policy",
          kind: "shipping",
          body: "A shipping address can change before dispatch.",
        },
      ],
      faq: [
        {
          id: "delivery",
          question: "When does my order ship?",
          answer: "Within two working days.",
        },
      ],
      payment_methods: [{ id: "card", name: "Card · synthetic", kind: "card", enabled: true }],
      fulfilment_methods: [
        {
          id: "standard",
          name: "Standard 3-5 days",
          carrier: "Nordic Post",
          min_transit_days: 3,
          max_transit_days: 5,
        },
      ],
      support_guidelines: [
        { id: "escalation", title: "Escalation", body: "Escalate refunds above 500 EUR." },
      ],
      tone_of_voice_guidelines: [
        {
          id: "warm-precise",
          name: "Warm and precise",
          guidance: "Be concise, warm, and specific.",
          is_default: true,
        },
      ],
    },
  });

  // -- the customer, the order, the ticket ---------------------------------
  const profileId = String(
    (
      await json(request, "post", "/api/v1/customer-profiles", {
        identity: {
          given_name: "Maya",
          family_name: "Laurent",
          email: `maya.${unique}@example.org`,
          locale: "fr-FR",
          phone: null,
        },
        customer_since: "2024-03-14",
        shop_id: shopId,
      })
    ).profile_id,
  );
  const addresses = [
    {
      id: "home",
      label: "Home",
      recipient: "Maya Laurent",
      line1: "18 rue des Écoles",
      line2: null,
      postal_code: "69005",
      city: "Lyon",
      region: null,
      country: "FR",
      is_default: true,
    },
    {
      id: "bordeaux-previous-flat",
      label: "Bordeaux — previous flat",
      recipient: "Maya Laurent",
      line1: "42 cours de la Marne",
      line2: null,
      postal_code: "33800",
      city: "Bordeaux",
      region: null,
      country: "FR",
      is_default: false,
    },
  ];
  await json(request, "put", `/api/v1/customer-profiles/${profileId}/draft`, {
    payload: {
      identity: {
        given_name: "Maya",
        family_name: "Laurent",
        email: `maya.${unique}@example.org`,
        locale: "fr-FR",
        phone: null,
      },
      account: {
        customer_since: "2024-03-14",
        status: "active",
        loyalty_tier: "silver",
        marketing_opt_in: true,
        notes: "",
      },
      persona: { summary: "Direct and mildly anxious.", traits: ["direct"] },
      addresses,
      background: [],
      hidden_facts: [],
    },
  });

  const orderId = String(
    (
      await json(request, "post", `/api/v1/shops/${shopId}/orders`, {
        reference: `NS-${reference}`,
        customer_profile_id: profileId,
        placed_at: "2026-08-20T14:55:00Z",
      })
    ).order_id,
  );
  await json(request, "put", `/api/v1/shops/${shopId}/orders/${orderId}`, {
    reference: `NS-${reference}`,
    placed_at: "2026-08-20T14:55:00Z",
    lines: [{ sku: "NS-ASJ-OB-M", quantity: 1 }],
    payment: { status: "paid", method_id: "card", paid_at: "2026-08-21T13:12:00Z" },
    fulfilment: { status: "unfulfilled", method_id: "standard", shipped_at: null },
    shipping_fee_amount: "0.00",
    shipping_address_id: "bordeaux-previous-flat",
    events: [],
  });

  const ticketId = String(
    (
      await json(request, "post", `/api/v1/shops/${shopId}/tickets`, {
        reference: `T-${reference}`,
        subject: "Wrong address concern",
        customer_profile_id: profileId,
        channel: "chat",
      })
    ).ticket_id,
  );
  await json(request, "put", `/api/v1/shops/${shopId}/tickets/${ticketId}/draft`, {
    payload: {
      reference: `T-${reference}`,
      subject: "Wrong address concern",
      channel: "chat",
      status: "open",
      origin: { kind: "order_page", product_handle: null, order_id: orderId },
      tags: ["address-change"],
      history: [],
      trigger: {
        id: "trigger",
        author: "customer",
        body: "This is going to my old address. Can you change it before it ships?",
        sent_at: "2026-08-21T13:40:00Z",
      },
      linked_order_ids: [orderId],
      suggested_documents: [{ kind: "policy", document_id: "address-change" }],
    },
  });

  // -- the two libraries ---------------------------------------------------
  const objectiveId = String(
    (
      await json(request, "post", "/api/v1/objective-blocks", {
        name: `read-required-document-${unique}`,
      })
    ).block_id,
  );
  await json(request, "put", `/api/v1/objective-blocks/${objectiveId}/draft`, {
    payload: {
      name: `read-required-document-${unique}`,
      statement: "Read document",
      description: "Passes when the arm reads the bound document through its tool.",
      assessment: "deterministic",
      evidence: "event",
      parameters: [
        {
          name: "doc_ref",
          kind: "document_reference",
          description: "The shop document the arm has to read.",
          required: true,
          default: null,
        },
        {
          name: "severity",
          kind: "severity",
          description: "Whether missing the read fails the objective.",
          required: true,
          default: "required",
        },
      ],
    },
  });

  const mutationId = String(
    (
      await json(request, "post", "/api/v1/mutation-blocks", {
        name: `concurrent-entity-mutation-${unique}`,
      })
    ).block_id,
  );
  await json(request, "put", `/api/v1/mutation-blocks/${mutationId}/draft`, {
    payload: {
      name: `concurrent-entity-mutation-${unique}`,
      statement: "Concurrent mutation of",
      description: "Mutates the bound entity out of band.",
      effect: "entity_mutation",
      parameters: [
        {
          name: "entity_ref",
          kind: "entity_reference",
          description: "The order that moves under the arm.",
          required: true,
          default: null,
        },
        {
          name: "timing",
          kind: "timing",
          description: "When the runtime injects the mutation.",
          required: true,
          default: "after_first_read",
        },
      ],
    },
  });

  // -- publish everything the recipe pins ----------------------------------
  for (const url of [
    `/api/v1/shops/${shopId}/versions`,
    `/api/v1/customer-profiles/${profileId}/versions`,
    `/api/v1/shops/${shopId}/tickets/${ticketId}/versions`,
    `/api/v1/objective-blocks/${objectiveId}/versions`,
    `/api/v1/mutation-blocks/${mutationId}/versions`,
  ]) {
    await json(request, "post", url, {});
  }

  // -- the recipe ----------------------------------------------------------
  const scenarioId = String(
    (
      await json(request, "post", `/api/v1/shops/${shopId}/scenarios`, {
        name: "Wrong shipping address",
        ticket_id: ticketId,
      })
    ).scenario_id,
  );
  await json(request, "put", `/api/v1/shops/${shopId}/scenarios/${scenarioId}/draft`, {
    payload: {
      name: "Wrong shipping address",
      context_documents: [{ kind: "policy", document_id: "address-change" }],
      objectives: [
        {
          id: "read-address-change-policy",
          block_id: objectiveId,
          severity: "required",
          bindings: [{ parameter: "doc_ref", value: "policy:address-change" }],
        },
      ],
      mutations: [
        {
          id: "order-moves-under-the-arm",
          block_id: mutationId,
          bindings: [
            { parameter: "entity_ref", value: `order:${orderId}` },
            { parameter: "timing", value: "after_first_read" },
          ],
        },
      ],
      hidden_facts: "Maya confirms the Lyon address only if asked.",
      completion: { statement: "The order ships to the confirmed address.", max_turns: 12 },
    },
  });
  const scenarioVersion = Number(
    (await json(request, "post", `/api/v1/shops/${shopId}/scenarios/${scenarioId}/versions`, {}))
      .version,
  );

  // -- the arms ------------------------------------------------------------
  const identityId = String(
    (
      await json(request, "post", "/api/v1/support-identities", {
        role: {
          name: `Northstar tier 1 ${unique}`,
          title: "Customer support representative",
          description: "Handles order and delivery questions before escalation.",
        },
      })
    ).identity_id,
  );
  await json(request, "put", `/api/v1/support-identities/${identityId}/draft`, {
    payload: {
      role: {
        name: `Northstar tier 1 ${unique}`,
        title: "Customer support representative",
        description: "Handles order and delivery questions before escalation.",
      },
      permissions: ["read_orders", "read_policies", "change_shipping_address"],
      guidance: [
        {
          id: "confirm-before-changing",
          title: "Confirm before changing an order",
          body: "Read the current shipping address back before proposing any change.",
        },
      ],
      escalation: { escalate_to: "Tier 2 support", conditions: [] },
    },
  });
  await json(request, "post", `/api/v1/support-identities/${identityId}/versions`, {});

  const arms: { configuration_id: string; version: number }[] = [];
  for (const name of ["Frontline A", "Frontline B"]) {
    const created = await json(request, "post", "/api/v1/agent-configurations", {
      name: `${name} ${unique}`,
      support_identity_id: identityId,
    });
    const configurationId = String(created.configuration_id);
    await json(request, "put", `/api/v1/agent-configurations/${configurationId}/draft`, {
      payload: {
        ...(created.content as Record<string, unknown>),
        prompt:
          "You are {{support_identity.role}} for {{shop.name}}.\n\n" +
          "Write in the shop's tone of voice: {{shop.tone_of_voice}}.",
      },
    });
    const published = await json(
      request,
      "post",
      `/api/v1/agent-configurations/${configurationId}/versions`,
      {},
    );
    arms.push({ configuration_id: configurationId, version: Number(published.version) });
  }

  // -- the experiment ------------------------------------------------------
  const experimentId = String(
    (
      await json(request, "post", `/api/v1/shops/${shopId}/experiments`, {
        label: `Tour sweep ${unique}`,
        scenario_id: scenarioId,
        scenario_version: scenarioVersion,
        seed: 20260825,
        arms,
      })
    ).experiment_id,
  );

  return { shopId, scenarioId, experimentId };
}
