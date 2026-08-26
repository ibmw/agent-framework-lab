import type {
  SandboxListResponse,
  SandboxSnapshotListResponse,
  SandboxSnapshotResponse,
  SandboxSummarySchema,
  ScenarioContentSchema,
  ScenarioDraftResponse,
  ScenarioVersionListResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  ToolCallResponse,
  ToolContractListResponse,
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
const SNAPSHOT_ID = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const FINGERPRINT = "a".repeat(64);

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

const CONTENT: ScenarioContentSchema = {
  name: "Wrong shipping address",
  ticket_id: TICKET_ID,
  context_documents: [],
  objectives: [],
  mutations: [],
  hidden_facts: "",
  completion: { statement: "The order ships to the confirmed address.", max_turns: 12 },
  objective_count: 0,
  mutation_count: 0,
};

const SNAPSHOT: SandboxSnapshotResponse = {
  snapshot_id: SNAPSHOT_ID,
  scenario_id: SCENARIO_ID,
  scenario_version: 2,
  seed: 20260825,
  sandbox_fingerprint: FINGERPRINT,
  canonical_schema_version: "sandbox-v2",
  order_count: 1,
  origin_kind: "order_page",
  ticket_reference: "T-204",
  created_at: "2026-08-25T12:20:00+00:00",
  pins: [
    {
      definition_type: "shop",
      definition_id: SHOP_ID,
      version: 3,
      content_fingerprint: "b".repeat(64),
    },
    {
      definition_type: "ticket",
      definition_id: TICKET_ID,
      version: 1,
      content_fingerprint: "c".repeat(64),
    },
  ],
  state: {
    customer_profile_id: PROFILE_ID,
    interaction: {
      origin_kind: "order_page",
      product_handle: null,
      order_id: ORDER_ID,
      channel: "chat",
      ticket_reference: "T-204",
    },
    orders: [
      {
        order_id: ORDER_ID,
        reference: "NS-10482",
        payment_status: "paid",
        fulfilment_status: "unfulfilled",
        total_amount: "249.00",
        currency: "EUR",
        item_count: 1,
        shipping_label: "Maya Laurent · 42 cours de la Marne · 33800 Bordeaux",
      },
    ],
  },
};

// Newest first, as `listScenarioVersions` really answers (the repository orders by
// `version.desc()`). Reading an end of this list is what the page must not do.
const VERSIONS: ScenarioVersionListResponse = {
  versions: [
    { version: 2, content_fingerprint: "e".repeat(64), published_at: "2026-08-25T12:00:00+00:00" },
    { version: 1, content_fingerprint: "d".repeat(64), published_at: "2026-08-25T11:00:00+00:00" },
  ],
};

const STATE_FINGERPRINT = "f".repeat(64);

function arm(label: string, sandboxId: string, revision = 0): SandboxSummarySchema {
  return {
    sandbox_id: sandboxId,
    snapshot_id: SNAPSHOT_ID,
    label,
    revision,
    snapshot_fingerprint: FINGERPRINT,
    // Two arms of one snapshot start from the same bytes, so they hash the same until one
    // of them writes. The revision is what says which one has.
    state_fingerprint: revision === 0 ? STATE_FINGERPRINT : "9".repeat(64),
    canonical_schema_version: "sandbox-state-v1",
    created_at: "2026-08-25T12:30:00+00:00",
    updated_at: "2026-08-25T12:30:00+00:00",
  };
}

const TOOLS: ToolContractListResponse = {
  tools: [
    {
      name: "interaction.read_context",
      version: "v1",
      summary: "Where this conversation started and the ticket thread it belongs to.",
      arguments: [],
    },
    {
      name: "support.read_document",
      version: "v1",
      summary: "Read one policy, support guideline, or FAQ entry in full.",
      arguments: [
        {
          name: "kind",
          kind: "enum",
          description: "The collection the document lives in.",
          required: true,
          choices: ["policy", "support_guideline", "faq_entry"],
        },
      ],
    },
    {
      name: "orders.read_order",
      version: "v1",
      summary: "Read one order in full.",
      arguments: [
        {
          name: "order_reference",
          kind: "text",
          description: "The reference the customer quotes, such as NS-10482.",
          required: false,
          choices: [],
        },
      ],
    },
  ],
};

const ORDER_RESULT: ToolCallResponse = {
  canonical_schema_version: "tool-result-v1",
  tool: "orders.read_order",
  version: "v1",
  arguments: { order_reference: "NS-10482" },
  outcome: "success",
  data: { reference: "NS-10482", shipping_address: { city: "Bordeaux" } },
  refusal: null,
  sandbox_revision: 0,
  state_fingerprint: STATE_FINGERPRINT,
};

let stored: SandboxSnapshotListResponse = { snapshots: [] };
let calls: Record<string, unknown>[] = [];
let materialized: Record<string, unknown>[] = [];
let arms: SandboxListResponse = { sandboxes: [] };
let cloned: Record<string, unknown>[] = [];

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
  http.get("*/api/v1/tools", () => HttpResponse.json(TOOLS)),
  http.post(`*/api/v1/shops/${SHOP_ID}/sandboxes/:sandboxId/tool-calls`, async ({ request }) => {
    calls.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(ORDER_RESULT);
  }),
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
      latest_published_version: 3,
      next_version: 4,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft`, () =>
    HttpResponse.json({
      scenario_id: SCENARIO_ID,
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: CONTENT,
      created_at: "2026-08-25T12:00:00+00:00",
      updated_at: "2026-08-25T12:05:00+00:00",
    } satisfies ScenarioDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
    HttpResponse.json(VERSIONS),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/snapshots`, () =>
    HttpResponse.json(stored),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/snapshots/${SNAPSHOT_ID}`, () => HttpResponse.json(SNAPSHOT)),
  http.get(`*/api/v1/shops/${SHOP_ID}/snapshots/${SNAPSHOT_ID}/sandboxes`, () =>
    HttpResponse.json(arms),
  ),
  http.post(`*/api/v1/shops/${SHOP_ID}/snapshots/${SNAPSHOT_ID}/sandboxes`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    cloned.push(body);
    const created = arm(String(body.label), `a${cloned.length}`.padEnd(36, "0"));
    arms = { sandboxes: [...arms.sandboxes, created] };
    return HttpResponse.json({ ...created, state: SNAPSHOT.state }, { status: 201 });
  }),
  http.post(
    `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version/snapshots`,
    async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      materialized.push({ ...body, version: params.version });
      stored = { snapshots: [SNAPSHOT] };
      return HttpResponse.json(SNAPSHOT, { status: 201 });
    },
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  stored = { snapshots: [] };
  materialized = [];
  arms = { sandboxes: [] };
  cloned = [];
  calls = [];
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/snapshots`]}>
      <App />
    </MemoryRouter>,
  );
}

describe("starting states", () => {
  it("freezes the newest published version by default", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: /Wrong shipping address · starting states/ }),
    ).toBeVisible();
    // The newest version is the one an operator means without saying so — whichever end of
    // the server's list it arrives on.
    await waitFor(() => expect(screen.getByLabelText("Scenario version")).toHaveValue("2"));
    expect(
      within(screen.getByLabelText("Scenario version"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["v2", "v1"]);

    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    await waitFor(() => expect(materialized).toHaveLength(1));
    expect(materialized[0]).toEqual({ seed: 20260825, version: "2" });
  });

  it("separates what the snapshot pinned from what it copied", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Materialize snapshot" });

    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    const pins = await screen.findByRole("region", { name: "Pinned versions" });
    expect(within(pins).getByText("shop")).toBeVisible();
    expect(within(pins).getByText("v3")).toBeVisible();

    const orders = screen.getByRole("region", { name: "Copied orders" });
    expect(within(orders).getByText("NS-10482")).toBeVisible();
    expect(within(orders).getByText(/33800 Bordeaux/)).toBeVisible();
  });

  it("reads the interaction back as an identifier, not a resource copy", async () => {
    const user = userEvent.setup();
    stored = { snapshots: [SNAPSHOT] };
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^[a-f0-9]{12}…$/ }));

    expect(await screen.findByText(/Opened from the order page on ticket/)).toBeVisible();
    expect(screen.getByText("T-204")).toBeVisible();
  });

  it("explains a refused freeze with the findings that caused it", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version/snapshots`,
        () =>
          HttpResponse.json(
            {
              code: "sandbox_not_materializable",
              message: "the scenario version cannot be materialized into starting state",
              request_id: "req-1",
              issues: [
                {
                  severity: "error",
                  code: "binding_order_missing_from_shop",
                  message: "This shop no longer holds that order.",
                  path: "scenario.mutations.order-moves-under-the-arm.bindings.entity_ref",
                },
              ],
            },
            { status: 422 },
          ),
      ),
    );
    renderPage();
    await screen.findByRole("button", { name: "Materialize snapshot" });

    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    expect(await screen.findByText("This shop no longer holds that order.")).toBeVisible();
    expect(
      screen.getByText("scenario.mutations.order-moves-under-the-arm.bindings.entity_ref"),
    ).toBeVisible();
  });

  it("says a scenario with no published version has nothing to freeze", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
        HttpResponse.json({ versions: [] } satisfies ScenarioVersionListResponse),
      ),
    );
    renderPage();

    expect(await screen.findByText(/This scenario has no published version yet/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Materialize snapshot" })).toBeNull();
  });

  it("refuses to freeze against a seed the author cleared", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Materialize snapshot" });

    await user.clear(screen.getByLabelText("Seed"));
    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter the seed/);
    expect(materialized).toHaveLength(0);
  });
});

describe("sandbox arms", () => {
  it("clones a snapshot into arms that start from the same fingerprint", async () => {
    const user = userEvent.setup();
    stored = { snapshots: [SNAPSHOT] };
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^[a-f0-9]{12}…$/ }));

    const panel = await screen.findByRole("region", { name: "Sandbox arms" });
    expect(
      within(panel).getByText("No arm has been cloned from this starting state yet."),
    ).toBeVisible();

    await user.type(within(panel).getByLabelText("Arm label"), "Arm A");
    await user.click(within(panel).getByRole("button", { name: "Clone sandbox" }));
    await waitFor(() => expect(cloned).toHaveLength(1));

    await user.type(within(panel).getByLabelText("Arm label"), "Arm B");
    await user.click(within(panel).getByRole("button", { name: "Clone sandbox" }));

    await waitFor(() => expect(within(panel).getAllByRole("row")).toHaveLength(3));
    expect(cloned).toEqual([{ label: "Arm A" }, { label: "Arm B" }]);
    expect(within(panel).getByText("Arm A")).toBeVisible();
    expect(within(panel).getByText("Arm B")).toBeVisible();
    // Same starting state, so the same current-state fingerprint until one of them writes.
    expect(within(panel).getAllByTitle(STATE_FINGERPRINT)).toHaveLength(2);
  });

  it("shows an arm that has moved apart from the one beside it", async () => {
    const user = userEvent.setup();
    stored = { snapshots: [SNAPSHOT] };
    arms = {
      sandboxes: [arm("Arm A", "a1".padEnd(36, "0"), 1), arm("Arm B", "a2".padEnd(36, "0"))],
    };
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^[a-f0-9]{12}…$/ }));

    const panel = await screen.findByRole("region", { name: "Sandbox arms" });
    await waitFor(() => expect(within(panel).getByText("r1")).toBeVisible());
    expect(within(panel).getByText("r0")).toBeVisible();
    expect(within(panel).getAllByTitle(STATE_FINGERPRINT)).toHaveLength(1);
  });

  it("keeps a successful clone successful when the list cannot be refetched", async () => {
    const user = userEvent.setup();
    stored = { snapshots: [SNAPSHOT] };
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^[a-f0-9]{12}…$/ }));
    const panel = await screen.findByRole("region", { name: "Sandbox arms" });
    await within(panel).findByText("No arm has been cloned from this starting state yet.");

    // The arm is created by the POST; a listing that fails afterwards must not be reported
    // as a clone that failed.
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/snapshots/${SNAPSHOT_ID}/sandboxes`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "unavailable", request_id: "req-2" },
          { status: 500 },
        ),
      ),
    );
    await user.type(within(panel).getByLabelText("Arm label"), "Arm A");
    await user.click(within(panel).getByRole("button", { name: "Clone sandbox" }));

    expect(await within(panel).findByText("Arm A")).toBeVisible();
    expect(within(panel).queryByRole("alert")).toBeNull();
  });

  it("refuses to clone an arm with no label", async () => {
    const user = userEvent.setup();
    stored = { snapshots: [SNAPSHOT] };
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^[a-f0-9]{12}…$/ }));

    const panel = await screen.findByRole("region", { name: "Sandbox arms" });
    await user.click(within(panel).getByRole("button", { name: "Clone sandbox" }));

    expect(
      await within(panel).findByText("Name the arm so it can be told from the one beside it."),
    ).toBeVisible();
    expect(cloned).toHaveLength(0);
  });
});

describe("read tools", () => {
  async function openArm(user: ReturnType<typeof userEvent.setup>) {
    stored = { snapshots: [SNAPSHOT] };
    arms = { sandboxes: [arm("Arm A", "a1".padEnd(36, "0"))] };
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^[a-f0-9]{12}…$/ }));
    const panel = await screen.findByRole("region", { name: "Sandbox arms" });
    await user.click(await within(panel).findByRole("button", { name: "Arm A" }));
    return screen.findByRole("region", { name: "Read tools · Arm A" });
  }

  it("asks the arm the way the agent will ask it", async () => {
    const user = userEvent.setup();
    const console = await openArm(user);

    await user.selectOptions(within(console).getByLabelText("Tool"), "orders.read_order");
    await user.type(within(console).getByLabelText("order_reference"), "NS-10482");
    await user.click(within(console).getByRole("button", { name: "Run tool" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      tool: "orders.read_order",
      version: "v1",
      arguments: { order_reference: "NS-10482" },
    });
    // The answer is the arm's own state, read at the revision the arm currently holds.
    const result = await within(console).findByRole("region", {
      name: "orders.read_order result",
    });
    expect(within(result).getByText(/Bordeaux/)).toBeVisible();
    expect(within(console).getByText(/read at revision r0/)).toBeVisible();
  });

  it("shows a refusal as an answer the agent could act on", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/sandboxes/:sandboxId/tool-calls`, () =>
        HttpResponse.json({
          ...ORDER_RESULT,
          arguments: { order_reference: "NS-00000" },
          outcome: "refused",
          data: null,
          refusal: { code: "not_found", message: "this customer holds no order 'NS-00000'" },
        } satisfies ToolCallResponse),
      ),
    );
    const console = await openArm(user);

    await user.selectOptions(within(console).getByLabelText("Tool"), "orders.read_order");
    await user.type(within(console).getByLabelText("order_reference"), "NS-00000");
    await user.click(within(console).getByRole("button", { name: "Run tool" }));

    expect(
      await within(console).findByText("this customer holds no order 'NS-00000'"),
    ).toBeVisible();
    expect(within(console).getByText("refused")).toBeVisible();
    // A refusal is not an error: the console does not report the call as having failed.
    expect(within(console).queryByRole("alert")).toBeNull();
  });

  it("asks a required enum to be chosen rather than offering to leave it open", async () => {
    const user = userEvent.setup();
    const console = await openArm(user);

    await user.selectOptions(within(console).getByLabelText("Tool"), "support.read_document");

    const kind = within(console).getByLabelText("kind (required)");
    // A blank required enum is a call the tool will refuse, so it must not read as "any".
    expect(within(kind).getByRole("option", { name: "Choose…" })).toBeInTheDocument();
    expect(within(kind).queryByRole("option", { name: "Any" })).toBeNull();
  });

  it("never shows one tool's result under another tool's form", async () => {
    const user = userEvent.setup();
    // Held on an object so the call below is typed by the declaration rather than narrowed
    // to the initial null: the only assignment happens inside the handler's closure.
    const pending: { release: (() => void) | null } = { release: null };
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/sandboxes/:sandboxId/tool-calls`, async () => {
        await new Promise<void>((resolve) => {
          pending.release = resolve;
        });
        return HttpResponse.json(ORDER_RESULT);
      }),
    );
    const console = await openArm(user);

    await user.selectOptions(within(console).getByLabelText("Tool"), "orders.read_order");
    await user.click(within(console).getByRole("button", { name: "Run tool" }));
    // The operator moves on while the call is still in flight.
    await user.selectOptions(within(console).getByLabelText("Tool"), "support.read_document");
    await waitFor(() => expect(pending.release).not.toBeNull());
    pending.release?.();

    await waitFor(() =>
      expect(within(console).getByLabelText("kind (required)")).toBeInTheDocument(),
    );
    expect(within(console).queryByRole("region", { name: "orders.read_order result" })).toBeNull();
  });
});
