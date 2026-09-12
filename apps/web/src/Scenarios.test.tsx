import type {
  BoundObjectiveSchema,
  ScenarioContentSchema,
  ScenarioDraftResponse,
  ScenarioListResponse,
  ScenarioPreviewResponse,
  ScenarioResourcesSchema,
  ScenarioVersionResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  TicketListResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const TICKET_ID = "6b0f9c1e-49d1-4c9f-8b0c-1f6d1c2f9a01";
const ORDER_ID = "2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42";
const PROFILE_ID = "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101";
const READ_BLOCK_ID = "a1c31b6e-5f0d-4f1e-9b5a-2c4e6f8a0b11";
const FORBIDDEN_BLOCK_ID = "c3e53d80-7b2f-4b30-9d7c-4e6a8b0c2d33";
const MUTATION_BLOCK_ID = "b2d42c7f-6a1e-4a2f-8c6b-3d5f7a9b1c22";

const SHOP_CONTENT: ShopDraftResponse["content"] = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [],
  faq: [],
  policies: [],
  payment_methods: [],
  fulfilment_methods: [],
  support_guidelines: [],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
};

const RESOURCES: ScenarioResourcesSchema = {
  documents: [
    {
      kind: "policy",
      document_id: "address-change",
      title: "Address-change policy",
      reference_value: "policy:address-change",
    },
    {
      kind: "support_guideline",
      document_id: "escalation",
      title: "Escalation",
      reference_value: "support_guideline:escalation",
    },
  ],
  orders: [
    {
      order_id: ORDER_ID,
      reference: "NS-10482",
      payment_status: "paid",
      fulfilment_status: "unfulfilled",
      total_amount: "249.00",
      currency: "EUR",
      shipping_label: "Bordeaux — previous flat",
      reference_value: `order:${ORDER_ID}`,
    },
  ],
  product_handles: [],
  customers: [
    {
      profile_id: PROFILE_ID,
      display_name: "Maya Laurent",
      reference_value: `customer:${PROFILE_ID}`,
    },
  ],
  objective_blocks: [
    {
      block_id: READ_BLOCK_ID,
      name: "read-required-document",
      statement: "Read document",
      description: "Passes when the arm reads the bound document.",
      type_label: "deterministic · event",
      latest_published_version: 1,
      parameters: [
        {
          name: "doc_ref",
          kind: "document_reference",
          description: "The shop document the arm has to read.",
          required: true,
          default: null,
          shop_bound: true,
        },
        {
          name: "severity",
          kind: "severity",
          description: "Whether missing the read fails the objective.",
          required: true,
          default: "required",
          shop_bound: false,
        },
      ],
    },
    {
      block_id: FORBIDDEN_BLOCK_ID,
      name: "forbidden-disclosure",
      statement: "Forbidden: reveal",
      description: "Fails the run when the arm discloses the bound value before verifying.",
      type_label: "deterministic · forbidden",
      latest_published_version: 1,
      parameters: [
        {
          name: "data_ref",
          kind: "data_reference",
          description: "The value the arm must not reveal.",
          required: true,
          default: null,
          shop_bound: true,
        },
      ],
    },
  ],
  mutation_blocks: [
    {
      block_id: MUTATION_BLOCK_ID,
      name: "concurrent-entity-mutation",
      statement: "Concurrent mutation of",
      description: "Mutates the bound entity out of band.",
      type_label: "entity_mutation",
      latest_published_version: null,
      parameters: [
        {
          name: "entity_ref",
          kind: "entity_reference",
          description: "The order that moves under the arm.",
          required: true,
          default: null,
          shop_bound: true,
        },
        {
          name: "timing",
          kind: "timing",
          description: "When the runtime injects the mutation.",
          required: true,
          default: "after_first_read",
          shop_bound: false,
        },
      ],
    },
  ],
};

const EMPTY_CONTENT: ScenarioContentSchema = {
  name: "Wrong shipping address",
  ticket_id: TICKET_ID,
  context_documents: [{ kind: "policy", document_id: "address-change" }],
  objectives: [],
  mutations: [],
  hidden_facts: "",
  completion: { statement: "", max_turns: 12 },
  objective_count: 0,
  mutation_count: 0,
};

function preview(overrides: Partial<ScenarioPreviewResponse> = {}): ScenarioPreviewResponse {
  return {
    scenario_id: SCENARIO_ID,
    publishable: false,
    issues: [
      {
        severity: "error",
        code: "scenario_without_objective",
        message: "a published scenario must assert something",
        path: "objectives",
      },
    ],
    changes: [],
    content_fingerprint: "a".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: current,
    resolution: {
      shop_name: "Northstar Outfitters",
      shop_version: 3,
      ticket_id: TICKET_ID,
      ticket_reference: "T-204",
      ticket_subject: "Wrong address concern",
      ticket_version: 1,
      customer_profile_id: PROFILE_ID,
      customer_display_name: "Maya Laurent",
      customer_profile_version: 2,
      documents: [
        {
          kind: "policy",
          document_id: "address-change",
          title: "Address-change policy",
          resolved: true,
        },
      ],
      entities: [],
      templates: [],
      objective_count: current.objectives.length,
      mutation_count: current.mutations.length,
      max_turns: current.completion.max_turns,
    },
    ...overrides,
  };
}

const scenarioIndex: ScenarioListResponse = {
  scenarios: [
    {
      scenario_id: SCENARIO_ID,
      name: "Wrong shipping address",
      ticket_id: TICKET_ID,
      ticket_reference: "T-204",
      ticket_subject: "Wrong address concern",
      customer_display_name: "Maya Laurent",
      objective_count: 2,
      mutation_count: 1,
      context_document_count: 2,
      max_turns: 12,
      updated_at: "2026-08-25T12:05:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

const ticketIndex: TicketListResponse = {
  tickets: [
    {
      ticket_id: TICKET_ID,
      reference: "T-204",
      subject: "Wrong address concern",
      customer_profile_id: PROFILE_ID,
      customer_display_name: "Maya Laurent",
      channel: "chat",
      status: "open",
      origin_kind: "order_page",
      preview: "I just noticed this is going to my old address.",
      opened_at: "2026-08-21T13:40:00.000000Z",
      message_count: 3,
      tags: [],
      updated_at: "2026-08-25T12:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

let current = EMPTY_CONTENT;
let savedPayloads: Array<Record<string, unknown>> = [];
let created: Array<Record<string, unknown>> = [];

function draft(content: ScenarioContentSchema): ScenarioDraftResponse {
  return {
    scenario_id: SCENARIO_ID,
    shop_id: SHOP_ID,
    lifecycle_state: "draft",
    content,
    created_at: "2026-08-25T12:00:00+00:00",
    updated_at: "2026-08-25T12:05:00+00:00",
  };
}

const server = setupServer(
  // The inline explainers read guide mode, which is derived from whether this lab holds a
  // completed comparison. An empty history leaves it on, so the notes render in these
  // journeys rather than being quietly absent from them (ADR 0044).
  http.get("*/api/v1/experiments", () =>
    HttpResponse.json({
      experiments: [],
      page: 1,
      page_size: 1,
      total: 0,
      shops: [],
      scenarios: [],
      frameworks: [],
      tags: [],
    }),
  ),
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: SHOP_CONTENT,
      created_at: "2026-08-25T12:00:00+00:00",
      updated_at: "2026-08-25T12:05:00+00:00",
    } satisfies ShopDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      publishable: false,
      issues: [],
      changes: [],
      content_fingerprint: "c".repeat(64),
      latest_published_version: null,
      next_version: 1,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json(ticketIndex)),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json(scenarioIndex)),
  http.post(`*/api/v1/shops/${SHOP_ID}/scenarios`, async ({ request }) => {
    created.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(draft(current), { status: 201 });
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft`, () =>
    HttpResponse.json(draft(current)),
  ),
  http.put(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    savedPayloads.push(body.payload);
    current = { ...current, ...(body.payload as Partial<ScenarioContentSchema>) };
    return HttpResponse.json(draft(current));
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft/preview`, () =>
    HttpResponse.json(preview()),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/resources`, () =>
    HttpResponse.json(RESOURCES),
  ),
  http.post(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
    HttpResponse.json(
      {
        scenario_id: SCENARIO_ID,
        shop_id: SHOP_ID,
        lifecycle_state: "published",
        version: 1,
        content_fingerprint: "d".repeat(64),
        published_at: "2026-08-25T12:10:00+00:00",
        shop_version: 3,
        ticket_version: 1,
        templates: [],
        content: current,
      } satisfies ScenarioVersionResponse,
      { status: 201 },
    ),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  current = EMPTY_CONTENT;
  savedPayloads = [];
  created = [];
});
afterAll(() => server.close());

/** Compose one template into the recipe, the way the two cards' pickers do. */
async function addBlock(
  user: ReturnType<typeof userEvent.setup>,
  card: string,
  picker: string,
  blockId: string,
) {
  await user.selectOptions(screen.getByLabelText(picker), blockId);
  await user.click(
    within(screen.getByRole("region", { name: card })).getByRole("button", {
      name: "Add",
    }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("scenario index", () => {
  it("shows the incident and the customer each recipe was built on", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    expect(await screen.findByRole("heading", { name: "Scenarios" })).toBeVisible();
    const row = (await screen.findByRole("link", { name: "Wrong shipping address" })).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("T-204")).toBeVisible();
    expect(
      within(row as HTMLElement).getByText(/Wrong address concern · Maya Laurent/),
    ).toBeVisible();
    expect(within(row as HTMLElement).getByText("2 objective(s)")).toBeVisible();
    expect(within(row as HTMLElement).getByText("v1 · 1 version(s)")).toBeVisible();
  });

  it("creates a scenario on a ticket it never afterwards moves off", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    await screen.findByRole("heading", { name: "Scenarios" });
    // The create form arrives with the ticket list: a scenario is built on an incident.
    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await user.selectOptions(screen.getByLabelText("Built on ticket"), TICKET_ID);
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() =>
      expect(created).toEqual([{ name: "Damaged delivery", ticket_id: TICKET_ID }]),
    );
  });
});

describe("scenario editor", () => {
  it("pairs the publish gate with the state publishing would freeze", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    expect(await screen.findByRole("heading", { name: "Wrong shipping address" })).toBeVisible();
    const resolved = screen.getByRole("region", { name: "Resolved-state preview" });
    expect(within(resolved).getByText(/Northstar Outfitters/)).toBeVisible();
    expect(within(resolved).getByText("v3")).toBeVisible();
    expect(within(resolved).getByText("T-204")).toBeVisible();
    expect(within(resolved).getByText(/Address-change policy/)).toBeVisible();
    expect(
      screen.getByText("a published scenario must assert something", { exact: false }),
    ).toBeVisible();
  });

  it("says what it composes while guide mode is on", async () => {
    // "Recipe", "binding" and "hidden fact" are this lab's words, not a commerce admin's, so
    // the editor carries a note that defines them where they are used (ADR 0044).
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    const note = await screen.findByRole("region", {
      name: "Guide note: What this editor composes",
    });
    expect(within(note).getByRole("link", { name: "scenario" })).toHaveAttribute(
      "href",
      "/guides/glossary#scenario",
    );
  });

  it("binds a template to this shop's own objects rather than to typed text", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Objectives", "Add objective block", READ_BLOCK_ID);

    const picker = screen.getByLabelText("doc_ref of read-required-document");
    expect(within(picker).getByRole("option", { name: /Address-change policy/ })).toBeVisible();
    await user.selectOptions(picker, "policy:address-change");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].objectives).toEqual([
      {
        id: "read-required-document",
        block_id: READ_BLOCK_ID,
        severity: "required",
        bindings: [{ parameter: "doc_ref", value: "policy:address-change" }],
      },
    ]);
  });

  it("declares an objective's severity once, and never as a binding", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Objectives", "Add objective block", READ_BLOCK_ID);

    // The template declares a `severity` parameter; the instance's own field resolves it.
    expect(screen.queryByLabelText("severity of read-required-document")).toBeNull();
    expect(screen.getByLabelText("Severity of read-required-document")).toHaveValue("required");
  });

  it("offers a mutation's moment as the three forms the runtime can observe", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Mutations", "Add mutation block", MUTATION_BLOCK_ID);

    const timing = screen.getByLabelText("timing of concurrent-entity-mutation");
    // The template's default is what a new binding starts at.
    expect(timing).toHaveValue("after_first_read");
    const entity = screen.getByLabelText("entity_ref of concurrent-entity-mutation");
    expect(within(entity).getByRole("option", { name: /Order NS-10482/ })).toBeVisible();
  });

  it("shows which objective reads each context document", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Objectives", "Add objective block", READ_BLOCK_ID);
    await user.selectOptions(
      screen.getByLabelText("doc_ref of read-required-document"),
      "policy:address-change",
    );

    const documents = screen.getByRole("region", { name: "Context documents" });
    expect(within(documents).getByText("read-check → objective 1")).toBeVisible();
    // A document is reachable only through its tool, which the row names.
    expect(within(documents).getByText("get_policies")).toBeVisible();
  });

  it("clears the whole reference when a data binding's object is cleared", async () => {
    // Regression: `joinDataReference("", field)` produced `#shipping_address` — a value the
    // gate refuses and neither select displays, so the author could not see or clear it.
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Objectives", "Add objective block", FORBIDDEN_BLOCK_ID);

    const object = screen.getByLabelText("data_ref of forbidden-disclosure");
    const field = screen.getByLabelText("Field of data_ref of forbidden-disclosure");
    await user.selectOptions(object, `order:${ORDER_ID}`);
    await user.selectOptions(field, "shipping_address");
    await user.selectOptions(object, "");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect((savedPayloads[0].objectives as BoundObjectiveSchema[])[0].bindings).toEqual([]);
    expect(field).toHaveValue("");
  });

  it("drops a field the newly bound object has no answer for", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Objectives", "Add objective block", FORBIDDEN_BLOCK_ID);

    const object = screen.getByLabelText("data_ref of forbidden-disclosure");
    await user.selectOptions(object, `order:${ORDER_ID}`);
    await user.selectOptions(
      screen.getByLabelText("Field of data_ref of forbidden-disclosure"),
      "shipping_address",
    );
    // A customer has no shipping_address, so the field cannot survive the switch.
    await user.selectOptions(object, `customer:${PROFILE_ID}`);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect((savedPayloads[0].objectives as BoundObjectiveSchema[])[0].bindings).toEqual([
      { parameter: "data_ref", value: `customer:${PROFILE_ID}` },
    ]);
  });

  it("keeps showing a bound value the picker's own list does not name", async () => {
    current = {
      ...EMPTY_CONTENT,
      mutations: [
        {
          id: "order-moves-under-the-arm",
          block_id: MUTATION_BLOCK_ID,
          bindings: [{ parameter: "timing", value: "at_turn:5" }],
        },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });

    // The list offers turns 2 and 3; a draft holding turn 5 must not read as unbound.
    expect(await screen.findByLabelText("timing of order-moves-under-the-arm")).toHaveValue(
      "at_turn:5",
    );
  });

  it("publishes the saved draft and says which version it froze", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft/preview`, () =>
        HttpResponse.json(preview({ publishable: true, issues: [] })),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Published version 1");
    // The notice describes what was frozen, so the next edit retires it.
    await user.type(screen.getByLabelText("Hidden facts"), "Maya says nothing unprompted.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says so when the shop's objects and the libraries cannot be loaded", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/resources`, () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ code: "internal_error" }, { status: 500 })
          : HttpResponse.json(RESOURCES);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    // Never "the library holds no template yet": an unloaded list is not an empty one.
    expect(await screen.findByText(/nothing can be bound until/)).toBeVisible();
    expect(screen.queryByText(/holds no template yet/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Add objective block")).toBeVisible();
    expect(screen.queryByText(/nothing can be bound until/)).toBeNull();
  });

  it("refuses to publish an unsaved draft rather than freezing an older one", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await user.type(screen.getByLabelText("Hidden facts"), "Maya confirms the Lyon address.");

    expect(screen.getByRole("button", { name: "Publish v1" })).toBeDisabled();
    expect(screen.getByText(/publishing freezes the saved draft, not unsaved edits/)).toBeVisible();
  });
});
