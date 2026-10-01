import type {
  BlockListResponse,
  BoundObjectiveSchema,
  MutationBlockDraftResponse,
  ObjectiveBlockDraftResponse,
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
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CHIP_LABEL_MAX_LENGTH, hiddenFactsTooLongRule, TEXT_MAX_LENGTH } from "./lib/fieldRules";
import { TOURS } from "./lib/tours";
import { renderApp } from "./test/app";
import { expectWayBack } from "./test/header";
import { expectPublicationPill, indexCard } from "./test/indexes";
import { panelCards, panelFields, sidePanel } from "./test/panel";
import {
  describedText,
  expectNotRefused,
  expectRefused,
  submitWithoutPressing,
} from "./test/refused";
import { expectCardOnRows, expectFieldRow } from "./test/rows";
import { bodyRows, railEntry, shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const TICKET_ID = "6b0f9c1e-49d1-4c9f-8b0c-1f6d1c2f9a01";
const ORDER_ID = "2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42";
const PROFILE_ID = "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101";
const READ_BLOCK_ID = "a1c31b6e-5f0d-4f1e-9b5a-2c4e6f8a0b11";
const FORBIDDEN_BLOCK_ID = "c3e53d80-7b2f-4b30-9d7c-4e6a8b0c2d33";
const MUTATION_BLOCK_ID = "b2d42c7f-6a1e-4a2f-8c6b-3d5f7a9b1c22";
/** A template whose author set its severity default to `expected` rather than `required`. */
const EXPECTED_BLOCK_ID = "d4f64e91-8c3a-4c41-9e8d-5f7b9c1d3e44";

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
  logo: null,
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
    {
      block_id: EXPECTED_BLOCK_ID,
      name: "acknowledge-the-delay",
      statement: "Acknowledge the delay",
      description: "Warns when the arm never says the order is late.",
      type_label: "deterministic · event",
      latest_published_version: 1,
      parameters: [
        {
          name: "severity",
          kind: "severity",
          description: "A missed acknowledgement warns rather than fails the run.",
          required: true,
          default: "expected",
          shop_bound: false,
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

/**
 * The two libraries as the **listings** carry them, which is all the create page can read.
 *
 * `BlockSummarySchema` has `parameter_count` and `shop_bound_parameter_count` where
 * `ScenarioBlockOptionSchema` above has the parameters themselves, and the rows here are the
 * same two templates `RESOURCES` describes in full — so a test can compare what the create
 * page composes from the listing against what the editor composes from the resources.
 */
const OBJECTIVE_LIBRARY: BlockListResponse = {
  blocks: [
    {
      block_id: READ_BLOCK_ID,
      name: "read-required-document",
      statement: "Read document",
      type_label: "deterministic · event",
      parameter_count: 2,
      shop_bound_parameter_count: 1,
      updated_at: "2026-08-25T11:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
    {
      block_id: FORBIDDEN_BLOCK_ID,
      name: "forbidden-disclosure",
      statement: "Forbidden: reveal",
      type_label: "deterministic · forbidden",
      parameter_count: 1,
      shop_bound_parameter_count: 1,
      updated_at: "2026-08-25T11:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
    {
      block_id: EXPECTED_BLOCK_ID,
      name: "acknowledge-the-delay",
      statement: "Acknowledge the delay",
      type_label: "deterministic · event",
      // The listing says one parameter and none of this shop's — and says nothing at all
      // about the severity default those counts are hiding, which is the whole point.
      parameter_count: 1,
      shop_bound_parameter_count: 0,
      updated_at: "2026-08-25T11:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

/**
 * The template drafts the create page reads as it composes, keyed the way the API addresses
 * them.
 *
 * Their parameters are `RESOURCES`' own, which is both what the parity test needs and the
 * limit of what it can prove: two endpoints projected from one fixture cannot show that the
 * API's two endpoints agree — `test_blocks.py` is where that lives. What the `toEqual` does
 * show is that the create page threads a draft's parameters through
 * `libraryOption → addObjective` exactly as the editor threads the resources' through the
 * same helper, which is the only place the two surfaces could have diverged.
 *
 * The teeth are in the severity case: its **listing** row carries counts alone, so nothing
 * the create page reads from the listing could produce the answer either surface lands on.
 */
function objectiveDraft(blockId: string): ObjectiveBlockDraftResponse {
  const option = RESOURCES.objective_blocks.find((entry) => entry.block_id === blockId);
  return {
    block_id: blockId,
    lifecycle_state: "draft",
    content: {
      name: option?.name ?? "",
      statement: option?.statement ?? "",
      description: option?.description ?? "",
      assessment: "deterministic",
      evidence: "event",
      parameters: option?.parameters ?? [],
    },
    created_at: "2026-08-25T11:00:00+00:00",
    updated_at: "2026-08-25T11:00:00+00:00",
  };
}

function mutationDraft(blockId: string): MutationBlockDraftResponse {
  const option = RESOURCES.mutation_blocks.find((entry) => entry.block_id === blockId);
  return {
    block_id: blockId,
    lifecycle_state: "draft",
    content: {
      name: option?.name ?? "",
      statement: option?.statement ?? "",
      description: option?.description ?? "",
      effect: "entity_mutation",
      parameters: option?.parameters ?? [],
    },
    created_at: "2026-08-25T11:00:00+00:00",
    updated_at: "2026-08-25T11:00:00+00:00",
  };
}

const MUTATION_LIBRARY: BlockListResponse = {
  blocks: [
    {
      block_id: MUTATION_BLOCK_ID,
      name: "concurrent-entity-mutation",
      statement: "Concurrent mutation of",
      type_label: "entity_mutation",
      parameter_count: 2,
      shop_bound_parameter_count: 1,
      updated_at: "2026-08-25T11:00:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
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
      // The shop the create page reads "shop v3" off, without anybody typing it.
      latest_published_version: 3,
      next_version: 4,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json(ticketIndex)),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json(scenarioIndex)),
  http.post(`*/api/v1/shops/${SHOP_ID}/scenarios`, async ({ request }) => {
    const body = (await request.json()) as { name: string; ticket_id: string };
    created.push(body);
    // What the lab actually makes: the name and the ticket the request carried, and the
    // context documents that ticket suggests, copied in at creation.
    current = { ...EMPTY_CONTENT, name: body.name, ticket_id: body.ticket_id };
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
  http.get("*/api/v1/objective-blocks", () => HttpResponse.json(OBJECTIVE_LIBRARY)),
  http.get("*/api/v1/mutation-blocks", () => HttpResponse.json(MUTATION_LIBRARY)),
  http.get("*/api/v1/objective-blocks/:blockId/draft", ({ params }) =>
    HttpResponse.json(objectiveDraft(String(params.blockId))),
  ),
  http.get("*/api/v1/mutation-blocks/:blockId/draft", ({ params }) =>
    HttpResponse.json(mutationDraft(String(params.blockId))),
  ),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
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

/**
 * A composed instance opened where it stands: its bindings, and an objective's severity, are
 * asked on field rows in the open row and reach the draft on its Save (PLAN-UX Slice 33).
 */
async function openRow(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByRole("button", { name: `Edit ${id}` }));
  return screen.getByRole("form", { name: `Edit ${id}` });
}

async function saveRow(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByRole("button", { name: `Save ${id}` }));
}

/**
 * The page's publication notice, out of the status lines the header now also carries: every
 * editor reports "All changes saved" as a status of its own (PLAN-UX Slice 8).
 */
async function publicationNotice() {
  const lines = await screen.findAllByRole("status");
  return lines.find((line) => line.textContent?.startsWith("Published version"));
}

function renderAt(path: string) {
  return renderApp(path);
}

describe("scenario index", () => {
  // The card's title says what the list is (every scenario here is built on this shop and never moves off it), on the header line opposite the search.
  it("titles its card Built on this shop, opposite the search box", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    const box = await screen.findByRole("searchbox", { name: "Search scenarios" });
    const title = screen.getByRole("heading", { level: 2, name: "Built on this shop" });
    expect(title.parentElement).toContainElement(box);
  });

  it("shows the incident and the customer each scenario was built on", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    expect(await screen.findByRole("heading", { name: "Scenarios" })).toBeVisible();
    const row = (await screen.findByRole("link", { name: "Wrong shipping address" })).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("T-204")).toBeVisible();
    expect(
      within(row as HTMLElement).getByText(/Wrong address concern · Maya Laurent/),
    ).toBeVisible();
    expect(within(row as HTMLElement).getByText("2 objective(s)")).toBeVisible();
    expect(within(row as HTMLElement).getByText("v1 · 1 version")).toBeVisible();
  });

  it("says each scenario's publication in a pill: the version and how many, or Never published", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({
          scenarios: [
            ...scenarioIndex.scenarios,
            {
              ...scenarioIndex.scenarios[0],
              scenario_id: "2c1b0a9f-8e7d-4c6b-9a58-4f3e2d1c0b9a",
              name: "Damaged delivery",
              latest_published_version: null,
              published_version_count: 0,
            },
          ],
        } satisfies ScenarioListResponse),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    const published = (await screen.findByRole("link", { name: "Wrong shipping address" })).closest(
      "tr",
    ) as HTMLElement;
    const never = screen
      .getByRole("link", { name: "Damaged delivery" })
      .closest("tr") as HTMLElement;
    expectPublicationPill(published, "v1 · 1 version", "published");
    expectPublicationPill(never, "Never published", "never published");
  });

  it("says, with no scenario yet, that one is built on a ticket, and links to Tickets", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: [] } satisfies ScenarioListResponse),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    await screen.findByText(/No scenario yet/);
    const card = indexCard("Built on this shop");
    expect(card).toHaveTextContent(/A scenario is built on a ticket/);
    expect(within(card).getByRole("link", { name: "raise one in Tickets" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/tickets`,
    );
  });

  it("counts the scenarios an experiment could run, and filters to the ones never published", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({
          scenarios: [
            ...scenarioIndex.scenarios,
            {
              ...scenarioIndex.scenarios[0],
              scenario_id: "2c1b0a9f-8e7d-4c6b-9a58-4f3e2d1c0b9a",
              name: "Damaged delivery",
              latest_published_version: null,
              published_version_count: 0,
            },
          ],
        } satisfies ScenarioListResponse),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios`);
    await screen.findByRole("link", { name: "Wrong shipping address" });
    const filters = within(screen.getByRole("group", { name: "Filter scenarios" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Runnable 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Never published 1" })).toBeVisible();
    // The index says it in the words every other index says it in, the row and the chip alike.
    expect(
      within(
        screen.getByRole("link", { name: "Damaged delivery" }).closest("tr") as HTMLElement,
      ).getByText("Never published"),
    ).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Never published 1" }));

    expect(screen.getByRole("link", { name: "Damaged delivery" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Wrong shipping address" })).toBeNull();
  });

  it("is created from the index's own header, which carries no create card", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    await screen.findByRole("link", { name: "Wrong shipping address" });
    expect(screen.queryByRole("region", { name: "New scenario" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "New scenario" }));

    expect(await screen.findByRole("heading", { level: 1, name: "New scenario" })).toBeVisible();
    expect(screen.getByText(/creating a scenario/)).toBeVisible();
  });
});

/**
 * Compose one template on the create page, which is a chip rather than a picker: the
 * bindings it will need are the editor's, so there is nothing here to pick them from.
 *
 * It waits for the chip to go down, because composing reads the template's own draft and the
 * chip is not pressed until that answer is in. A bare click passed only while MSW happened
 * to answer inside `userEvent`'s own gaps between actions, which is a flake in every test
 * that composes rather than a property of any of them.
 */
async function compose(user: ReturnType<typeof userEvent.setup>, name: string) {
  const chip = screen.getByRole("button", { name });
  await user.click(chip);
  await waitFor(() => expect(chip).toHaveAttribute("aria-pressed", "true"));
}

describe("the new-scenario page", () => {
  it("refuses the create until there is a name and something to score", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    const create = await screen.findByRole("button", { name: "Create scenario" });
    const unnamed = "Give the scenario a name first.";
    await waitFor(() => expect(create).toHaveAccessibleDescription(unnamed));
    expectRefused(create, unnamed);
    expect(screen.getByText(unnamed)).toBeVisible();

    await user.type(screen.getByLabelText("Name"), "Damaged delivery");

    // The reason moves to what is actually missing next, and is read beside the control
    // rather than only hovered.
    const unscored = "Compose at least one objective — a run needs something to be scored against.";
    expectRefused(create, unscored);
    expect(create).toHaveAccessibleDescription(unscored);
    expect(create).toHaveAttribute("title", unscored);
    expect(screen.getByText(unscored)).toBeVisible();

    await compose(user, "read-required-document");

    expectNotRefused(create);
    expect(screen.queryByText(unscored)).toBeNull();
  });

  it("opens on the shop's one ticket, and says so", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    const ticket = await screen.findByLabelText("Ticket");
    await waitFor(() => expect(ticket).not.toHaveValue(""));
    await waitFor(() =>
      expect(ticket).toHaveAccessibleDescription(
        /This one is the only ticket in the shop, so it is already chosen\./,
      ),
    );
  });

  it("refuses a name this shop already answers to, until the scenario exists", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Wrong shipping address");
    await compose(user, "read-required-document");

    const create = screen.getByRole("button", { name: "Create scenario" });
    expectRefused(
      create,
      "Wrong shipping address is the name of a scenario this shop already holds.",
    );
    expect(create).toHaveAccessibleDescription(
      "Wrong shipping address is the name of a scenario this shop already holds.",
    );
  });

  it("reads the customer and the shop version off the ticket rather than asking", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    // Neither is a control: both follow the incident, and a second authored copy could
    // contradict the thread the scenario is built on.
    await waitFor(() =>
      expect(screen.getByLabelText("Customer")).toHaveTextContent("Maya Laurent"),
    );
    expect(screen.queryByRole("combobox", { name: "Customer" })).toBeNull();
    expect(screen.getByLabelText("Shop version")).toHaveTextContent("v3");
    expect(screen.getByRole("region", { name: "It starts as a draft" })).toHaveTextContent(
      /ticket T-204, Maya Laurent and shop v3/,
    );
  });

  it("offers the bare reference and puts the composed label under the control", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    const ticket = await screen.findByLabelText("Ticket");
    // The option is the reference and nothing else; the subject and the customer are the
    // hint under the select, which is where the prototype draws them.
    expect(within(ticket).getByRole("option", { name: "T-204" })).toBeInTheDocument();
    expect(within(ticket).queryByRole("option", { name: /Wrong address concern/ })).toBeNull();
    await waitFor(() =>
      expect(ticket).toHaveAccessibleDescription(/Wrong address concern · Maya Laurent/),
    );
  });

  it("says what creating freezes and what publishing pins", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    // A frozen thing nobody is told about is a trap, and the two halves happen at different
    // moments: the ticket and its suggested documents at creation, the version at publication.
    expect(await screen.findByLabelText("Ticket")).toHaveAccessibleDescription(
      /a scenario never moves off its ticket.*documents this ticket suggests are copied into it now.*Publishing the scenario is what pins the ticket version/i,
    );
  });

  it("names what each composed template still owes, and where it is bound", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await screen.findByRole("button", { name: "read-required-document" });
    await compose(user, "read-required-document");

    const composed = within(screen.getByRole("list", { name: "Composed objectives" }));
    expect(
      composed.getByText("1 binding to this shop's objects, made in the editor"),
    ).toBeVisible();
    // A saved row's shape, without its Edit: nothing is editable before the first write.
    expect(composed.getByRole("heading", { level: 3 })).toBeVisible();
    expect(composed.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("button", { name: "read-required-document" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("composes a template at the severity its author meant, not at the strictest one", async () => {
    // The one parameter that changes what a run *means*: a failed required objective fails
    // the run, where an expected one warns. `BlockSummarySchema` carries a template's
    // parameters as two counts, so composing from the listing alone would default every
    // objective to `required` — including this one, whose author wrote `expected`. The page
    // reads the template's own draft as it composes it, which is what makes the severity the
    // template's answer rather than the create page's.
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Late delivery");
    await compose(user, "acknowledge-the-delay");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].objectives).toEqual([
      {
        id: "acknowledge-the-delay",
        block_id: EXPECTED_BLOCK_ID,
        severity: "expected",
        bindings: [],
      },
    ]);
  });

  it("refuses hidden facts that, joined one to a line, pass the prose's cap", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await compose(user, "read-required-document");
    const create = screen.getByRole("button", { name: "Create scenario" });
    expectNotRefused(create);

    // Each chip stops at its own cap; it is the join that no field stops. Twenty at the cap
    // with nineteen line breaks between them come to 4019, past the 4000 `require_text` keeps.
    const field = screen.getByLabelText("New hidden fact");
    const count = Math.ceil(TEXT_MAX_LENGTH / (CHIP_LABEL_MAX_LENGTH + 1));
    for (let index = 0; index < count; index += 1) {
      await user.click(field);
      await user.paste(`${index}`.padEnd(CHIP_LABEL_MAX_LENGTH, "x"));
      await user.click(screen.getByRole("button", { name: "Add fact" }));
    }
    const length = count * CHIP_LABEL_MAX_LENGTH + count - 1;
    expect(length).toBeGreaterThan(TEXT_MAX_LENGTH);
    expectRefused(create, hiddenFactsTooLongRule(length));
    await user.click(create);
    await submitWithoutPressing(create);
    expect(created).toEqual([]);

    await user.click(
      screen.getByRole("button", { name: `Remove ${"0".padEnd(CHIP_LABEL_MAX_LENGTH, "x")}` }),
    );
    expectNotRefused(create);
  });

  it("makes the scenario, saves what it composed, and lands in its editor", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await user.type(screen.getByLabelText("New hidden fact"), "The parcel was left in the rain.");
    await user.click(screen.getByRole("button", { name: "Add fact" }));
    await compose(user, "read-required-document");
    await compose(user, "concurrent-entity-mutation");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    // The create request carries the two the contract takes and nothing else.
    await waitFor(() =>
      expect(created).toEqual([{ name: "Damaged delivery", ticket_id: TICKET_ID }]),
    );
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0]).toEqual({
      name: "Damaged delivery",
      // Copied in by the create from the ticket's own suggestion, and carried through
      // untouched by the write that follows.
      context_documents: [{ kind: "policy", document_id: "address-change" }],
      objectives: [
        {
          id: "read-required-document",
          block_id: READ_BLOCK_ID,
          severity: "required",
          bindings: [],
        },
      ],
      // The template's own `timing` default rides in with the instance, exactly as it does
      // when the editor's picker adds one: the parameters came from the template's draft.
      mutations: [
        {
          id: "concurrent-entity-mutation",
          block_id: MUTATION_BLOCK_ID,
          bindings: [{ parameter: "timing", value: "after_first_read" }],
        },
      ],
      hidden_facts: "The parcel was left in the rain.",
      completion: { statement: "", max_turns: 12 },
    });

    // And the operator ends in the scenario editor with the name they typed in its header.
    //
    // Waited for as a page and not as a heading: the create page's own title reads back the
    // name as it is typed, so a heading called "Damaged delivery" is on screen *before* the
    // editor is — and on a loaded machine the query found the create page's one and it was
    // unmounted by the landing before it could be asserted on. The create page is gone once its
    // Cancel is; only the editor's heading is left to find.
    await waitFor(() => expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull());
    expect(
      await screen.findByRole("heading", { level: 1, name: "Damaged delivery" }),
    ).toBeVisible();
  });

  it("writes the draft the editor would have saved for the same answers", async () => {
    // "Creation writes the same draft the editor would save" is the slice's own claim, and
    // the honest form of it is this: the same answers given on the two surfaces produce one
    // payload. The create page composes from the library *listing* and the editor from the
    // scenario's resources, which is exactly where the two could drift apart.
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await user.type(screen.getByLabelText("New hidden fact"), "The parcel was left in the rain.");
    await user.click(screen.getByRole("button", { name: "Add fact" }));
    await compose(user, "read-required-document");
    // The second one carries a severity default of its own, so this comparison is about the
    // field that decides a verdict and not only about the ids.
    await compose(user, "acknowledge-the-delay");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const fromTheCreatePage = savedPayloads[0];

    cleanup();
    savedPayloads = [];
    // Back to the draft the first write made, which is where the editor would start.
    current = { ...EMPTY_CONTENT, name: "Damaged delivery", ticket_id: TICKET_ID };
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { level: 1, name: "Damaged delivery" });
    await addBlock(user, "Objectives", "Add objective block", READ_BLOCK_ID);
    await addBlock(user, "Objectives", "Add objective block", EXPECTED_BLOCK_ID);
    await user.type(screen.getByLabelText("Hidden facts"), "The parcel was left in the rain.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(fromTheCreatePage).toEqual(savedPayloads[0]);
  });

  it("asks about what it composed once the scenario exists and the write was refused", async () => {
    // ADR 0051 keeps a half-typed create form out of the register — nothing exists to lose.
    // It stops being true the moment the first write lands: the objectives are on screen and
    // nowhere else, so the page declares them with its own second write as the save.
    const user = userEvent.setup();
    let refuse = true;
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft`, async ({ request }) => {
        if (refuse) {
          refuse = false;
          return HttpResponse.error();
        }
        const body = (await request.json()) as { payload: Record<string, unknown> };
        savedPayloads.push(body.payload);
        current = { ...current, ...(body.payload as Partial<ScenarioContentSchema>) };
        return HttpResponse.json(draft(current));
      }),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await compose(user, "read-required-document");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));
    expect(
      await screen.findByText(/The scenario was created, but what it composes could not be saved/),
    ).toBeVisible();

    await user.click(railEntry("Tickets"));

    const prompt = within(await screen.findByRole("dialog", { name: "Unsaved changes" }));
    expect(
      prompt.getByText(
        "Scenario Damaged delivery was created without the objectives composed for it.",
      ),
    ).toBeVisible();

    await user.click(prompt.getByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].objectives).toHaveLength(1);
  });

  it("re-reads the listing the moment the scenario exists, refused second write or not", async () => {
    // ADR 0056's invalidation rule is about what the surface *did*, not about whether it
    // finished: the shop holds one scenario more from the `POST`, so the rail must already
    // say so while the operator is still standing here reading why the rest did not save.
    const user = userEvent.setup();
    let listed = scenarioIndex.scenarios;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: listed }),
      ),
      http.post(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => {
        listed = [
          ...listed,
          {
            ...scenarioIndex.scenarios[0],
            scenario_id: SCENARIO_ID,
            name: "Damaged delivery",
          },
        ];
        current = { ...EMPTY_CONTENT, name: "Damaged delivery", ticket_id: TICKET_ID };
        return HttpResponse.json(draft(current), { status: 201 });
      }),
      http.put(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft`, () =>
        HttpResponse.error(),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await waitFor(() => expect(within(railEntry("Scenarios")).getByText("1")).toBeVisible());

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await compose(user, "read-required-document");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    expect(
      await screen.findByText(/The scenario was created, but what it composes could not be saved/),
    ).toBeVisible();
    // Still on the create page — and the rail has already moved, before any retry.
    expect(screen.getByText("created · what it composes is not saved yet")).toBeVisible();
    expect(within(railEntry("Scenarios")).getByText("2")).toBeVisible();
    // And the listing it just re-read holds this page's own name, which is the "until the
    // scenario exists" half of the taken-name refusal: counting it would refuse the retry of
    // the create that made it.
    expectNotRefused(screen.getByRole("button", { name: "Create scenario" }));
  });

  it("says the libraries failed rather than that it is still reading them", async () => {
    // A failed listing stays empty and unsettled, so a reason asked "loading first" would
    // report a read in flight for ever while the alert above it said the request failed.
    server.use(
      http.get("*/api/v1/objective-blocks", () => HttpResponse.error()),
      http.get("*/api/v1/mutation-blocks", () => HttpResponse.error()),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    const create = await screen.findByRole("button", { name: "Create scenario" });
    const reason =
      "The block libraries could not be read, so there is nothing to compose from yet.";
    await waitFor(() => expect(create).toHaveAccessibleDescription(reason));
    expect(create).toHaveAttribute("title", reason);
    expect(screen.getByText(reason)).toBeVisible();
    // And the compose cards stop claiming to be loading, from the same predicate.
    expect(screen.queryByText("Loading the library…")).toBeNull();
  });

  it("says the incidents failed rather than that this shop has none", async () => {
    // `useShopListings` answers `rows: []` on a failed read, so an empty listing and a
    // listing that never arrived look identical from here — and "this shop has none yet"
    // is a page contradicting the alert above it.
    server.use(http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.error()));
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    const create = await screen.findByRole("button", { name: "Create scenario" });
    await waitFor(() =>
      expect(create).toHaveAccessibleDescription(
        "This shop's incidents could not be read, so there is nothing to build on yet.",
      ),
    );
    expect(screen.queryByText(/this shop has none yet/)).toBeNull();
  });

  it("will not create while a template it has just composed is still being read", async () => {
    // `run` composes the payload from the render the press happened in, so a template whose
    // draft lands a moment later would be an answer on screen that never reaches the draft —
    // and, because the page composed without it, nothing would register to prompt about
    // either. The gate asks `reading` before it asks for an objective.
    const user = userEvent.setup();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*/api/v1/objective-blocks/${EXPECTED_BLOCK_ID}/draft`, async () => {
        await held;
        return HttpResponse.json(objectiveDraft(EXPECTED_BLOCK_ID));
      }),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await compose(user, "read-required-document");
    const create = screen.getByRole("button", { name: "Create scenario" });
    expectNotRefused(create);

    // The second template's draft is held open, so the page is composing something it
    // cannot build yet.
    const heldChip = screen.getByRole("button", { name: "acknowledge-the-delay" });
    await user.click(heldChip);
    const reason = "Reading what the template just composed declares…";
    await waitFor(() => expect(create).toHaveAccessibleDescription(reason));
    expectRefused(create, reason);
    expect(screen.getByText(reason)).toBeVisible();
    // The chip keeps its place in the tab order while it waits: a browser blurs a focused
    // control the moment it is disabled, and jsdom does not, so this is asserted rather
    // than left to a browser to contradict.
    expect(heldChip).toBeEnabled();
    expect(heldChip).toHaveAttribute("aria-busy", "true");

    release();

    await waitFor(() => expectNotRefused(create));
    await user.click(create);

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    // Both, not one: the press waited for the answer rather than composing without it.
    expect(savedPayloads[0].objectives).toHaveLength(2);
  });

  it("says the scenarios failed rather than reading a free name off an empty listing", async () => {
    // The listing a taken name is refused against answers `rows: []` when it fails, so
    // without this the page would offer to create a name the lab refuses and report the
    // refusal as a create that went wrong.
    server.use(http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.error()));
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    const create = await screen.findByRole("button", { name: "Create scenario" });
    await waitFor(() =>
      expect(create).toHaveAccessibleDescription(
        "This shop's scenarios could not be read, so a free name cannot be told from a taken one.",
      ),
    );
    expectRefused(
      create,
      "This shop's scenarios could not be read, so a free name cannot be told from a taken one.",
    );
  });

  it("composes nothing when the template it was asked for cannot be read", async () => {
    // The chip goes down only once the template's parameters are in hand: composing it from
    // nothing would give it the strictest severity there is rather than its author's.
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/objective-blocks/${READ_BLOCK_ID}/draft`, () => HttpResponse.error()),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    // Not `compose`: that helper waits for the chip to go down, and the whole claim here is
    // that it does not.
    await user.click(screen.getByRole("button", { name: "read-required-document" }));

    expect(
      await screen.findByText(/That template could not be read, so it was not composed/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "read-required-document" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("list", { name: "Composed objectives" })).toBeNull();
    expectRefused(
      screen.getByRole("button", { name: "Create scenario" }),
      /Compose at least one objective/,
    );
  });

  it("asks nothing while the create form is only half filled", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await compose(user, "read-required-document");
    await user.click(railEntry("Tickets"));

    // A half-typed create form is not an edit to something that exists (ADR 0051).
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull();
  });
});

describe("scenario editor", () => {
  it("goes back to Scenarios from the ← above its title", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await expectWayBack("Scenarios", `/shops/${SHOP_ID}/scenarios`, "scenario");
  });
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

  it("names its first card for what the scenario is built on, never a recipe", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    const builtOn = await screen.findByRole("region", { name: "Built on" });

    expect(within(builtOn).getByLabelText("Name")).toHaveValue("Wrong shipping address");
    expect(within(builtOn).getByText("T-204")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Recipe" })).toBeNull();
    expect(document.body).not.toHaveTextContent(/recipe/i);
  });

  it("offers to show a reader around what it composes", async () => {
    // "Binding" and "hidden fact" are this lab's words, not a commerce admin's, so
    // the editor has a tour that says what they mean where they are used (ADR 0045).
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    // The bar offers the tour from the route, so it is on screen before the editor is; what
    // the tour points *at* is the editor's, and is asserted once the editor has drawn it.
    expect(
      screen.getByRole("button", { name: `Show me around ${TOURS.scenario.surface}` }),
    ).toBeVisible();
    await screen.findByRole("heading", { name: "Wrong shipping address" });
    for (const step of TOURS.scenario.steps) {
      expect(document.querySelectorAll(step.anchor), step.anchor).toHaveLength(1);
    }
  });

  it("binds a template to this shop's own objects rather than to typed text", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Objectives", "Add objective block", READ_BLOCK_ID);
    await openRow(user, "read-required-document");

    const picker = screen.getByLabelText("doc_ref of read-required-document");
    expect(within(picker).getByRole("option", { name: /Address-change policy/ })).toBeVisible();
    await user.selectOptions(picker, "policy:address-change");
    await saveRow(user, "read-required-document");
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
    await openRow(user, "read-required-document");

    // The template declares a `severity` parameter; the instance's own field resolves it.
    expect(screen.queryByLabelText("severity of read-required-document")).toBeNull();
    expect(screen.getByLabelText("Severity of read-required-document")).toHaveValue("required");
  });

  it("offers a mutation's moment as the three forms the runtime can observe", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Mutations", "Add mutation block", MUTATION_BLOCK_ID);
    await openRow(user, "concurrent-entity-mutation");

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
    await openRow(user, "read-required-document");
    await user.selectOptions(
      screen.getByLabelText("doc_ref of read-required-document"),
      "policy:address-change",
    );
    await saveRow(user, "read-required-document");

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
    await openRow(user, "forbidden-disclosure");

    const object = screen.getByLabelText("data_ref of forbidden-disclosure");
    const field = screen.getByLabelText("Field of data_ref of forbidden-disclosure");
    await user.selectOptions(object, `order:${ORDER_ID}`);
    await user.selectOptions(field, "shipping_address");
    await user.selectOptions(object, "");
    expect(field).toHaveValue("");
    await saveRow(user, "forbidden-disclosure");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect((savedPayloads[0].objectives as BoundObjectiveSchema[])[0].bindings).toEqual([]);
  });

  it("drops a field the newly bound object has no answer for", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: "Wrong shipping address" });
    await addBlock(user, "Objectives", "Add objective block", FORBIDDEN_BLOCK_ID);
    await openRow(user, "forbidden-disclosure");

    const object = screen.getByLabelText("data_ref of forbidden-disclosure");
    await user.selectOptions(object, `order:${ORDER_ID}`);
    await user.selectOptions(
      screen.getByLabelText("Field of data_ref of forbidden-disclosure"),
      "shipping_address",
    );
    // A customer has no shipping_address, so the field cannot survive the switch.
    await user.selectOptions(object, `customer:${PROFILE_ID}`);
    await saveRow(user, "forbidden-disclosure");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect((savedPayloads[0].objectives as BoundObjectiveSchema[])[0].bindings).toEqual([
      { parameter: "data_ref", value: `customer:${PROFILE_ID}` },
    ]);
  });

  it("keeps showing a bound value the picker's own list does not name", async () => {
    const user = userEvent.setup();
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

    // The list offers turns 2 and 3; a draft holding turn 5 must not read as unbound — on the
    // closed row, or in the open one.
    const mutations = screen.getByRole("region", { name: "Mutations" });
    expect(await within(mutations).findByText("at_turn:5")).toBeVisible();
    await openRow(user, "order-moves-under-the-arm");
    expect(screen.getByLabelText("timing of order-moves-under-the-arm")).toHaveValue("at_turn:5");
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

    expect(await publicationNotice()).toHaveTextContent("Published version 1");
    // The notice describes what was frozen, so the next edit retires it.
    await user.type(screen.getByLabelText("Hidden facts"), "Maya says nothing unprompted.");
    expect(await publicationNotice()).toBeUndefined();
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

    expectRefused(screen.getByRole("button", { name: "Publish v1" }), /Save the draft first/);
    expect(screen.getByText(/publishing freezes the saved draft, not unsaved edits/)).toBeVisible();
  });
});

/**
 * The rail's figure and this index are one listing, read once by the shell and handed to
 * both, so they cannot come to disagree (ADR 0056).
 */
/** The card's title, which reads how far into the lab's cap its collection is. */
function capOf(card: string): string {
  const region = screen.getByRole("region", { name: card });
  return within(region).getByRole("heading", { level: 2 }).textContent ?? "";
}

const OBJECTIVES_CAP = "a scenario composes at most 24 objectives";
const MUTATIONS_CAP = "a scenario composes at most 8 mutations";
const DOCUMENTS_CAP = "a scenario carries at most 12 context documents";

function objectivesUpTo(count: number): BoundObjectiveSchema[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `acknowledge-${index + 1}`,
    block_id: EXPECTED_BLOCK_ID,
    severity: "expected" as const,
    bindings: [],
  }));
}

function mutationsUpTo(count: number): ScenarioContentSchema["mutations"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `mutation-${index + 1}`,
    block_id: MUTATION_BLOCK_ID,
    bindings: [],
  }));
}

describe("the scenario's caps, each read on its own card", () => {
  it("counts every card against its cap, and follows each add and removal", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: /^Wrong shipping address/ });
    expect(capOf("Context documents")).toMatch(/1 of 12$/);
    expect(capOf("Objectives")).toMatch(/0 of 24$/);
    expect(capOf("Mutations")).toMatch(/0 of 8$/);

    await addBlock(user, "Objectives", "Add objective block", EXPECTED_BLOCK_ID);
    await addBlock(user, "Objectives", "Add objective block", EXPECTED_BLOCK_ID);
    expect(capOf("Objectives")).toMatch(/2 of 24$/);
    await addBlock(user, "Mutations", "Add mutation block", MUTATION_BLOCK_ID);
    expect(capOf("Mutations")).toMatch(/1 of 8$/);
    await user.click(screen.getByRole("checkbox", { name: "Escalation" }));
    expect(capOf("Context documents")).toMatch(/2 of 12$/);

    const objectives = within(screen.getByRole("region", { name: "Objectives" }));
    await user.click(objectives.getAllByRole("button", { name: /^Remove/ })[0]);
    await user.click(objectives.getByRole("button", { name: "Remove it" }));
    expect(capOf("Objectives")).toMatch(/1 of 24$/);
    await user.click(screen.getByRole("checkbox", { name: "Address-change policy" }));
    await user.click(screen.getByRole("checkbox", { name: "Escalation" }));
    expect(capOf("Context documents")).toMatch(/0 of 12$/);
    // The card keeps its bare title as its name, whatever the count reads.
    expect(screen.getByRole("region", { name: "Objectives" })).toBeVisible();
  });

  for (const [card, picker, blockId, cap, max, content] of [
    [
      "Objectives",
      "Add objective block",
      EXPECTED_BLOCK_ID,
      OBJECTIVES_CAP,
      24,
      () => ({ objectives: objectivesUpTo(24) }),
    ],
    [
      "Mutations",
      "Add mutation block",
      MUTATION_BLOCK_ID,
      MUTATIONS_CAP,
      8,
      () => ({ mutations: mutationsUpTo(8) }),
    ],
  ] as const) {
    it(`refuses Add at the ${card.toLowerCase()} cap with the lab's own sentence, and adds nothing`, async () => {
      const user = userEvent.setup();
      current = { ...EMPTY_CONTENT, ...content() };
      renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

      await screen.findByRole("heading", { name: /^Wrong shipping address/ });
      const region = within(screen.getByRole("region", { name: card }));
      expect(capOf(card)).toMatch(new RegExp(`${max} of ${max}$`));
      const add = region.getByRole("button", { name: "Add" });
      expectRefused(add, cap);
      expect(region.getByText(cap)).toBeVisible();

      // Neither the press, nor Enter or Space on it, nor a submission without it adds one.
      await user.selectOptions(screen.getByLabelText(picker), blockId);
      await user.click(add);
      add.focus();
      await user.keyboard("{Enter}");
      await user.keyboard(" ");
      await submitWithoutPressing(add);
      expect(capOf(card)).toMatch(new RegExp(`${max} of ${max}$`));
      // Nothing was edited at all: the draft is as the lab stored it.
      expect(screen.getByText("All changes saved")).toBeVisible();

      // One removed is one the lab will store again.
      await user.click(region.getAllByRole("button", { name: /^Remove/ })[0]);
      await user.click(region.getByRole("button", { name: "Remove it" }));
      expect(capOf(card)).toMatch(new RegExp(`${max - 1} of ${max}$`));
      expectNotRefused(add);
      expect(region.queryByText(cap)).toBeNull();
      await user.selectOptions(screen.getByLabelText(picker), blockId);
      await user.click(add);
      expect(capOf(card)).toMatch(new RegExp(`${max} of ${max}$`));
      expectRefused(add, cap);
    });
  }

  it("opens a picker on the library's one template, and on it again after an add", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: /^Wrong shipping address/ });
    // Three objective templates are a choice: nothing is chosen, and nothing says otherwise.
    const objectives = screen.getByLabelText("Add objective block");
    expect(objectives).toHaveValue("");
    expect(objectives).not.toHaveAccessibleDescription(/already chosen/);

    // One mutation template is not.
    const mutations = screen.getByLabelText("Add mutation block");
    await waitFor(() => expect(mutations).toHaveValue(MUTATION_BLOCK_ID));
    await waitFor(() =>
      expect(mutations).toHaveAccessibleDescription(
        "This one is the only template in the library, so it is already chosen.",
      ),
    );
    await user.click(
      within(screen.getByRole("region", { name: "Mutations" })).getByRole("button", {
        name: "Add",
      }),
    );
    expect(capOf("Mutations")).toMatch(/1 of \d+$/);
    expect(mutations).toHaveValue(MUTATION_BLOCK_ID);
  });

  it("leaves an unchosen template to its own field to say, and adds nothing for it", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: /^Wrong shipping address/ });
    for (const [card, picker] of [
      ["Objectives", "Add objective block"],
      ["Mutations", "Add mutation block"],
    ] as const) {
      // Natively required, so the browser says it on the select; Add is not refused for it.
      // The library's one template is already chosen, so the operator takes it back off.
      const select = screen.getByLabelText(picker);
      expect(select).toBeRequired();
      await user.selectOptions(select, "");
      expect(select).toHaveValue("");
      const add = within(screen.getByRole("region", { name: card })).getByRole("button", {
        name: "Add",
      });
      expectNotRefused(add);
      await submitWithoutPressing(add);
      expect(capOf(card)).toMatch(/0 of \d+$/);
    }
  });

  it("keeps an unlisted document off at the context cap, and says why on it", async () => {
    const user = userEvent.setup();
    current = {
      ...EMPTY_CONTENT,
      context_documents: [
        { kind: "policy", document_id: "address-change" },
        ...Array.from({ length: 11 }, (_, index) => ({
          kind: "faq_entry" as const,
          document_id: `question-${index + 1}`,
        })),
      ],
    };
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    await screen.findByRole("heading", { name: /^Wrong shipping address/ });
    expect(capOf("Context documents")).toMatch(/12 of 12$/);
    // A native control keeps `disabled`, with the reason in `title` and in its description.
    const escalation = screen.getByRole("checkbox", { name: "Escalation" });
    expect(escalation).toBeDisabled();
    expect(escalation).toHaveAttribute("title", DOCUMENTS_CAP);
    // Read off the line its description names, not the computed description, which would fall
    // back to `title` and pass on the tooltip alone.
    expect(describedText(escalation)).toBe(DOCUMENTS_CAP);
    expect(screen.getByText(DOCUMENTS_CAP)).toBeVisible();
    // A listed one can always be taken off.
    const listed = screen.getByRole("checkbox", { name: "Address-change policy" });
    expect(listed).toBeEnabled();
    expect(listed).not.toHaveAttribute("title");

    await user.click(listed);
    expect(capOf("Context documents")).toMatch(/11 of 12$/);
    expect(escalation).toBeEnabled();
    expect(escalation).not.toHaveAttribute("title");
    expect(screen.queryByText(DOCUMENTS_CAP)).toBeNull();
  });

  it("counts the new scenario's compositions, and turns the chips off at the cap with its reason", async () => {
    const user = userEvent.setup();
    const blocks = Array.from({ length: 9 }, (_, index) => ({
      ...MUTATION_LIBRARY.blocks[0],
      block_id: `b2d42c7f-6a1e-4a2f-8c6b-3d5f7a9b1c${String(index).padStart(2, "0")}`,
      name: `mutation-${index + 1}`,
    }));
    server.use(
      http.get("*/api/v1/mutation-blocks", () => HttpResponse.json({ blocks })),
      http.get("*/api/v1/mutation-blocks/:blockId/draft", ({ params }) =>
        HttpResponse.json({
          ...mutationDraft(MUTATION_BLOCK_ID),
          block_id: String(params.blockId),
        }),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios/new`);

    await screen.findByRole("button", { name: "mutation-1" });
    expect(capOf("Objectives")).toMatch(/0 of 24$/);
    expect(capOf("Mutations")).toMatch(/0 of 8$/);
    await compose(user, "read-required-document");
    expect(capOf("Objectives")).toMatch(/1 of 24$/);
    for (let index = 1; index <= 8; index += 1) {
      await compose(user, `mutation-${index}`);
    }

    expect(capOf("Mutations")).toMatch(/8 of 8$/);
    const ninth = screen.getByRole("button", { name: "mutation-9" });
    expect(ninth).toBeDisabled();
    expect(ninth).toHaveAttribute("title", MUTATIONS_CAP);
    expect(describedText(ninth)).toBe(MUTATIONS_CAP);
    expect(screen.getByText(MUTATIONS_CAP)).toBeVisible();
    // A pressed chip stays reachable, so one can be taken back off at the cap.
    const first = screen.getByRole("button", { name: /mutation-1$/ });
    expect(first).toBeEnabled();

    await user.click(first);
    await waitFor(() => expect(capOf("Mutations")).toMatch(/7 of 8$/));
    expect(ninth).toBeEnabled();
    expect(ninth).not.toHaveAttribute("title");
    expect(screen.queryByText(MUTATIONS_CAP)).toBeNull();
  });
});

describe("the rail's figure and this index", () => {
  it("says on the rail what the table has rows", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry("Scenarios");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} scenario${rows === 1 ? "" : "s"}`);
  });

  /**
   * The assertion above agrees by construction while both reads answer from one fixture; this
   * is the one that can fail. A create changes what the index lists, so it has to move the
   * figure on the chrome with it — which it can only do by reading the listing the chrome is
   * drawn from.
   */
  it("moves the rail's figure when a scenario is created, without a reload", async () => {
    const user = userEvent.setup();
    let listed = scenarioIndex.scenarios;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: listed }),
      ),
      http.post(`*/api/v1/shops/${SHOP_ID}/scenarios`, async ({ request }) => {
        const body = (await request.json()) as { name: string; ticket_id: string };
        listed = [
          ...listed,
          { ...scenarioIndex.scenarios[0], scenario_id: SCENARIO_ID, name: body.name },
        ];
        current = { ...EMPTY_CONTENT, name: body.name, ticket_id: body.ticket_id };
        return HttpResponse.json(draft(current), { status: 201 });
      }),
    );
    renderAt(`/shops/${SHOP_ID}/scenarios`);

    const table = await screen.findByRole("table");
    await waitFor(() => expect(bodyRows(table)).toBe(1));
    expect(within(railEntry("Scenarios")).getByText("1")).toBeVisible();

    // Created from the page the header opens, which is the only place a scenario is made.
    await user.click(screen.getByRole("link", { name: "New scenario" }));
    await user.type(await screen.findByLabelText("Name"), "Damaged delivery");
    await compose(user, "read-required-document");
    await user.click(screen.getByRole("button", { name: "Create scenario" }));

    await waitFor(() => expect(within(railEntry("Scenarios")).getByText("2")).toBeVisible());
  });
});

describe("the scenario editor's side panel", () => {
  it("holds the gate, the resolved state, how read-checks report and what publishing freezes, in that order, and no field", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);

    const panel = sidePanel(await screen.findByRole("region", { name: "Publish gate" }));

    expect(panelCards(panel)).toEqual([
      "Publish gate",
      "Resolved-state preview",
      "How read-checks report",
      "What publishing freezes",
    ]);
    expect(panelFields(panel)).toEqual([]);
  });
});

/**
 * The scenario editor's *Built on* and *Completion* on the reference pages' rows. The bound
 * blocks' fields are list rows, and stay where they are.
 */
describe("the scenario editor's rows", () => {
  it("draws Built on as the name and the three things it is read against, each on a row", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);
    const builtOn = await screen.findByRole("region", { name: "Built on" });
    const card = within(builtOn);

    expectFieldRow(card.getByLabelText("Name"), "Name");
    // Shown, not asked: the scenario never moves off them.
    await waitFor(() => expect(card.getByLabelText("Ticket")).toHaveTextContent("T-204"));
    const ticket = card.getByLabelText("Ticket");
    expect(ticket.tagName).toBe("OUTPUT");
    // The latest published version, as the shop version beside it is: not a frozen one.
    expect(ticket).toHaveTextContent("T-204 · Wrong address concern — published at v1");
    expectFieldRow(ticket, "Ticket");
    expect(card.getByLabelText("Customer")).toHaveTextContent("Maya Laurent");
    expectFieldRow(card.getByLabelText("Customer"), "Customer");
    const shop = card.getByLabelText("Shop version");
    expect(shop).toHaveTextContent("Northstar Outfitters v3");
    expectFieldRow(shop, "Shop version");
    // The version moves with the shop's next publish, so the row says that rather than the
    // prototype's "does not move it".
    expect(shop).toHaveAccessibleDescription(
      /The shop's newest published version, which is what the scenario resolves against today\./,
    );
    expectCardOnRows(builtOn);
  });

  it("draws Completion's statement and turn cap on rows", async () => {
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);
    const completion = await screen.findByRole("region", { name: "Completion" });

    for (const label of ["A resolved incident looks like", "Turn cap"]) {
      expectFieldRow(within(completion).getByLabelText(label), label);
    }
    expectCardOnRows(completion);
  });
});

/**
 * A scenario's composed objectives and mutations are lists on `EntryCard` (PLAN-UX Slice 33):
 * a row reads its bindings back, opens them on field rows in place, and writes them — and an
 * objective's severity — through the same builder the template picker composes with.
 */
describe("a scenario's composed blocks", () => {
  const READ_OBJECTIVE = {
    id: "read-required-document",
    block_id: READ_BLOCK_ID,
    severity: "required" as const,
    bindings: [{ parameter: "doc_ref", value: "policy:address-change" }],
  };
  const SECOND_OBJECTIVE = { ...READ_OBJECTIVE, id: "read-required-document-2", bindings: [] };

  async function openEditor() {
    renderAt(`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);
    await screen.findByRole("heading", { name: "Wrong shipping address" });
    return within(screen.getByRole("region", { name: "Objectives" }));
  }

  it("reads a row's bindings back and opens them on field rows in place", async () => {
    const user = userEvent.setup();
    current = { ...EMPTY_CONTENT, objectives: [READ_OBJECTIVE] };
    const objectives = await openEditor();

    // Closed, the binding is read as the choice it names, not offered as a picker.
    expect(await objectives.findByText(/^Address-change policy/)).toBeVisible();
    expect(objectives.getByText("Required")).toBeVisible();
    expect(screen.queryByLabelText("doc_ref of read-required-document")).toBeNull();

    const open = within(await openRow(user, "read-required-document"));
    const binding = open.getByLabelText("doc_ref of read-required-document");
    expect(binding).toHaveValue("policy:address-change");
    expectFieldRow(binding, "doc_ref");
    expectFieldRow(open.getByLabelText("Severity of read-required-document"), "Severity");
    // The arrows and the Remove wait for Save or Cancel.
    expect(objectives.queryByRole("button", { name: "Remove read-required-document" })).toBeNull();
  });

  it("saves an open row with exactly what composing the same template writes for the same answers", async () => {
    const user = userEvent.setup();
    current = { ...EMPTY_CONTENT, objectives: [READ_OBJECTIVE] };
    await openEditor();
    await addBlock(user, "Objectives", "Add objective block", READ_BLOCK_ID);

    // The composed one starts unbound; the saved one is unbound by hand and saved.
    const open = within(await openRow(user, "read-required-document"));
    await user.selectOptions(open.getByLabelText("doc_ref of read-required-document"), "");
    await saveRow(user, "read-required-document");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const [edited, composed] = savedPayloads[0].objectives as BoundObjectiveSchema[];
    expect(edited.id).toBe("read-required-document");
    expect(composed.id).toBe("read-required-document-2");
    expect({ ...edited, id: null }).toEqual({ ...composed, id: null });
  });

  it("writes nothing on Cancel, and nothing typed in an open row reaches Save draft", async () => {
    const user = userEvent.setup();
    current = { ...EMPTY_CONTENT, objectives: [READ_OBJECTIVE] };
    await openEditor();

    await user.type(screen.getByLabelText("Hidden facts"), "Maya says nothing unprompted.");
    const open = within(await openRow(user, "read-required-document"));
    await user.selectOptions(open.getByLabelText("Severity of read-required-document"), "expected");

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect((savedPayloads[0].objectives as BoundObjectiveSchema[])[0].severity).toBe("required");

    await user.click(screen.getByRole("button", { name: "Cancel editing read-required-document" }));
    const objectives = within(screen.getByRole("region", { name: "Objectives" }));
    expect(objectives.getByText("Required")).toBeVisible();
    expect(objectives.queryByText("Expected")).toBeNull();
  });

  it("holds one open row per list, and every other Edit on it says why it is disabled", async () => {
    const user = userEvent.setup();
    current = {
      ...EMPTY_CONTENT,
      objectives: [READ_OBJECTIVE, SECOND_OBJECTIVE],
      mutations: [{ id: "order-moves", block_id: MUTATION_BLOCK_ID, bindings: [] }],
    };
    const objectives = await openEditor();

    await openRow(user, "read-required-document");

    const sibling = objectives.getByRole("button", { name: "Edit read-required-document-2" });
    expect(sibling).toBeDisabled();
    expect(sibling).toHaveAccessibleDescription(
      "Editing read-required-document. Save or Cancel before opening another row; nothing in the open row reaches the draft until you press Save.",
    );
    // One per list: the mutations keep their own open row.
    expect(screen.getByRole("button", { name: "Edit order-moves" })).toBeEnabled();
  });

  it("removes a composed block only on the second press", async () => {
    const user = userEvent.setup();
    current = { ...EMPTY_CONTENT, objectives: [READ_OBJECTIVE] };
    const objectives = await openEditor();

    await user.click(objectives.getByRole("button", { name: "Remove read-required-document" }));
    const confirm = objectives.getByRole("group", { name: /^Remove / });
    expect(confirm).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(objectives.getByRole("button", { name: "Remove read-required-document" })).toHaveFocus();
  });
});
