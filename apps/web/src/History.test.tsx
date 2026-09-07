import type {
  ExperimentHistoryEntrySchema,
  ExperimentHistoryResponse,
  HistoryArmSchema,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const OTHER_SHOP_ID = "6a5b4c3d-2e1f-4a0b-8c9d-1e2f3a4b5c6d";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const OTHER_SCENARIO_ID = "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b";
const FINISHED_ID = "9f8e7d6c-5b4a-4392-8817-6f5e4d3c2b1a";
const RUNNING_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

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

function arm(label: string, name: string, overrides: Partial<HistoryArmSchema> = {}) {
  return {
    run_id: `${label}-run`,
    label,
    agent_configuration_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
    agent_configuration_version: 4,
    agent_configuration_name: name,
    framework_id: "pydantic-ai",
    framework_label: "Pydantic AI",
    model_id: "gpt-5-mini",
    awaiting: "completed",
    met: 1,
    decided: 1,
    failed: false,
    ...overrides,
  } satisfies HistoryArmSchema;
}

const FINISHED: ExperimentHistoryEntrySchema = {
  experiment_id: FINISHED_ID,
  shop_id: SHOP_ID,
  shop_name: "Northstar Outfitters",
  label: "Prompt A against prompt B",
  scenario_id: SCENARIO_ID,
  scenario_name: "Wrong shipping address",
  scenario_version: 1,
  scenario_superseded: true,
  seed: 20260828,
  sandbox_fingerprint: "a".repeat(64),
  resolution_fingerprint: "b".repeat(64),
  participant_driver: "human",
  status: "failed",
  arms: [
    arm("Arm A", "cfg-atlas"),
    arm("Arm B", "cfg-beacon", { met: 0, decided: 1, failed: true }),
  ],
  tags: ["read-check-gap", "two-arm"],
  note_count: 2,
  created_at: "2026-09-02T17:41:00+00:00",
};

const RUNNING: ExperimentHistoryEntrySchema = {
  ...FINISHED,
  experiment_id: RUNNING_ID,
  shop_id: OTHER_SHOP_ID,
  shop_name: "Southline Supply",
  label: "Control policy alone",
  scenario_id: OTHER_SCENARIO_ID,
  scenario_name: "Order status inquiry",
  scenario_superseded: false,
  status: "running",
  tags: [],
  note_count: 0,
  arms: [
    arm("Arm A", "cfg-control", {
      awaiting: "agent",
      met: 0,
      decided: 0,
      framework_id: "fake",
      framework_label: "Deterministic fake",
    }),
  ],
  created_at: "2026-09-03T14:02:00+00:00",
};

const EVERY_ROW = [RUNNING, FINISHED];

/** The listing as the backend serves it: the page, its total, and its filter options. */
function historyOf(rows: ExperimentHistoryEntrySchema[]): ExperimentHistoryResponse {
  return {
    experiments: rows,
    page: 1,
    page_size: 20,
    total: rows.length,
    shops: [
      { id: SHOP_ID, label: "Northstar Outfitters" },
      { id: OTHER_SHOP_ID, label: "Southline Supply" },
    ],
    scenarios: [
      { id: OTHER_SCENARIO_ID, label: "Order status inquiry" },
      { id: SCENARIO_ID, label: "Wrong shipping address" },
    ],
    frameworks: [
      { id: "fake", label: "Deterministic fake" },
      { id: "pydantic-ai", label: "Pydantic AI" },
    ],
    tags: [
      { id: "read-check-gap", label: "read-check-gap" },
      { id: "two-arm", label: "two-arm" },
    ],
  };
}

let asked: URLSearchParams[] = [];
let unavailable = false;

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: SHOP_CONTENT,
      created_at: "2026-08-28T09:00:00+00:00",
      updated_at: "2026-08-28T09:00:00+00:00",
    } satisfies ShopDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      publishable: true,
      issues: [],
      changes: [],
      content_fingerprint: "f".repeat(64),
      latest_published_version: 3,
      next_version: 4,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),
  http.get("*/api/v1/experiments", ({ request }) => {
    const url = new URL(request.url);
    asked.push(url.searchParams);
    if (unavailable) {
      return HttpResponse.json(
        {
          code: "internal_error",
          message: "The lab could not read its own history",
          request_id: "req-1",
        },
        { status: 500 },
      );
    }
    // The backend narrows; this stands in for it so the page is tested on what it asks for
    // and what it renders, never on a filter it applied itself.
    const shop = url.searchParams.get("shop_id");
    const rows = shop === null ? EVERY_ROW : EVERY_ROW.filter((row) => row.shop_id === shop);
    return HttpResponse.json({ ...historyOf(rows), total: rows.length });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
beforeEach(() => {
  asked = [];
  unavailable = false;
});
afterAll(() => server.close());

function renderHistory(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/shops/${SHOP_ID}/history${search}`]}>
      <App />
    </MemoryRouter>,
  );
}

function lastAsked(): URLSearchParams {
  return asked[asked.length - 1];
}

describe("experiment history", () => {
  it("lists every run in the lab, not only the shop the operator is standing in", async () => {
    renderHistory();

    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(3));
    expect(within(table).getByText("Prompt A against prompt B")).toBeVisible();
    expect(within(table).getByText("Southline Supply")).toBeVisible();
    expect(lastAsked().get("shop_id")).toBeNull();
  });

  it("reads each arm's objectives against its own denominator and never adds them up", async () => {
    renderHistory();

    const row = within(await screen.findByRole("table"))
      .getByText("Prompt A against prompt B")
      .closest("tr") as HTMLElement;

    const objectives = within(row).getByRole("cell", { name: /decided/ });
    const [first, second] = within(objectives).getAllByRole("listitem");
    expect(first).toHaveTextContent("Arm A 1/1 decided");
    expect(second).toHaveTextContent("Arm B 0/1 decided");
    expect(second).toHaveTextContent("missed a requirement");
    // Two arms, two denominators, and nothing that adds them into one.
    expect(within(row).queryByText(/1\/2 decided/)).toBeNull();
  });

  it("says a run's recipe has moved on without pretending the run did", async () => {
    renderHistory();

    const table = await screen.findByRole("table");
    const superseded = within(table).getByText("Prompt A against prompt B").closest("tr");
    const current = within(table).getByText("Control policy alone").closest("tr");

    expect(within(superseded as HTMLElement).getByText(/newer versions exist/)).toBeVisible();
    expect(within(current as HTMLElement).queryByText(/newer versions exist/)).toBeNull();
  });

  it("marks a finished run that missed a requirement as failed and a live one as running", async () => {
    renderHistory();

    const table = await screen.findByRole("table");

    expect(within(table).getByText("Failed")).toBeVisible();
    expect(within(table).getByText("Running")).toBeVisible();
  });

  it("opens a row's evidence and its bench, each in the shop that ran it", async () => {
    renderHistory();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Control policy alone").closest("tr") as HTMLElement;

    expect(within(row).getByRole("link", { name: "View evidence" })).toHaveAttribute(
      "href",
      `/shops/${OTHER_SHOP_ID}/bench/${RUNNING_ID}/results`,
    );
    expect(within(row).getByRole("link", { name: "Open live bench" })).toHaveAttribute(
      "href",
      `/shops/${OTHER_SHOP_ID}/bench/${RUNNING_ID}`,
    );
  });

  it("narrows by shop, offering every other shop the lab has run in", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Shop"), "Southline Supply");

    await waitFor(() => expect(lastAsked().get("shop_id")).toBe(OTHER_SHOP_ID));
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    // Choosing one shop must not remove the other from the filter that chose it.
    expect(within(screen.getByLabelText("Shop")).getAllByRole("option")).toHaveLength(3);
  });

  it("narrows by scenario, framework, status, outcome, and when a run started", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Scenario"), "Wrong shipping address");
    await user.selectOptions(screen.getByLabelText("Framework"), "Pydantic AI");
    await user.selectOptions(screen.getByLabelText("Tag"), "read-check-gap");
    await user.selectOptions(screen.getByLabelText("Status"), "Completed");
    await user.selectOptions(screen.getByLabelText("Objective outcome"), "missed");
    await user.selectOptions(screen.getByLabelText("Started"), "Last 30 days");

    await waitFor(() => expect(lastAsked().get("started_after")).not.toBeNull());
    const asked = lastAsked();
    expect(asked.get("scenario_id")).toBe(SCENARIO_ID);
    expect(asked.get("framework_id")).toBe("pydantic-ai");
    expect(asked.get("tag")).toBe("read-check-gap");
    expect(asked.get("status")).toBe("completed");
    expect(asked.get("outcome")).toBe("missed");
  });

  it("shows the tags a run is filed under and how many notes it carries", async () => {
    renderHistory();

    const table = await screen.findByRole("table");
    const annotated = within(table)
      .getByText("Prompt A against prompt B")
      .closest("tr") as HTMLElement;
    const bare = within(table).getByText("Control policy alone").closest("tr") as HTMLElement;

    expect(within(annotated).getByText("read-check-gap")).toBeVisible();
    expect(within(annotated).getByText("two-arm")).toBeVisible();
    expect(within(annotated).getByText("2 notes")).toBeVisible();
    // A run nobody has written on says nothing rather than showing an empty strip.
    expect(within(bare).queryByText(/note/)).toBeNull();
  });

  it("searches on submission rather than on every keystroke", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("table");
    const reads = asked.length;

    await user.type(screen.getByLabelText("Search"), "beacon");
    expect(asked).toHaveLength(reads);

    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(lastAsked().get("q")).toBe("beacon"));
  });

  it("keeps a narrowing in the URL so a finding can be shared as it was found", async () => {
    renderHistory(`?shop=${OTHER_SHOP_ID}&status=running`);

    await screen.findByRole("table");

    await waitFor(() => expect(lastAsked().get("shop_id")).toBe(OTHER_SHOP_ID));
    expect(lastAsked().get("status")).toBe("running");
    expect(screen.getByLabelText("Shop")).toHaveValue(OTHER_SHOP_ID);
  });

  it("pages by number over the whole matching set and starts over when narrowed", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () =>
        HttpResponse.json({
          shop_id: SHOP_ID,
          publishable: true,
          issues: [],
          changes: [],
          content_fingerprint: "f".repeat(64),
          latest_published_version: 3,
          next_version: 4,
          matches_latest_published: false,
          content: SHOP_CONTENT,
        } satisfies ShopPreviewResponse),
      ),
      http.get("*/api/v1/experiments", ({ request }) => {
        asked.push(new URL(request.url).searchParams);
        return HttpResponse.json({ ...historyOf(EVERY_ROW), page: 1, total: 42 });
      }),
    );
    renderHistory();
    await screen.findByRole("table");

    expect(screen.getByText("Showing 1–20 of 42")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastAsked().get("page")).toBe("2"));

    await user.selectOptions(screen.getByLabelText("Status"), "Running");

    await waitFor(() => expect(lastAsked().get("status")).toBe("running"));
    expect(lastAsked().get("page")).toBe("1");
  });

  it("ignores a filter value the contract does not publish rather than asking for it", async () => {
    renderHistory("?status=bogus&outcome=nonsense&span=forever&page=abc");

    await screen.findByRole("table");

    const asked = lastAsked();
    expect(asked.get("status")).toBeNull();
    expect(asked.get("outcome")).toBeNull();
    expect(asked.get("started_after")).toBeNull();
    expect(asked.get("page")).toBe("1");
    expect(screen.getByText(/Page 1 of/)).toBeVisible();
  });

  it("says it is working while a narrowing is read, keeping the rows it has", async () => {
    const user = userEvent.setup();
    let answer = () => {};
    renderHistory();
    await screen.findByRole("table");
    const listed = screen.getByRole("region", { name: "Experiment history" });
    expect(listed).toHaveAttribute("aria-busy", "false");

    server.use(
      http.get("*/api/v1/experiments", async ({ request }) => {
        asked.push(new URL(request.url).searchParams);
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json(historyOf([FINISHED]));
      }),
    );
    await user.selectOptions(screen.getByLabelText("Status"), "Failed");

    await waitFor(() => expect(listed).toHaveAttribute("aria-busy", "true"));
    // The previous narrowing's rows are still readable while the next one is in flight.
    expect(within(listed).getByText("Control policy alone")).toBeVisible();
    answer();
    await waitFor(() => expect(listed).toHaveAttribute("aria-busy", "false"));
  });

  it("reports a lab it cannot read with the backend's own reason", async () => {
    unavailable = true;
    renderHistory();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The lab could not read its own history",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says nothing has been run rather than showing an empty table", async () => {
    server.use(http.get("*/api/v1/experiments", () => HttpResponse.json(historyOf([]))));
    renderHistory();

    expect(await screen.findByText(/No experiment matches these filters/)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("is reachable from the workspace rail", async () => {
    renderHistory();
    await screen.findByRole("table");

    expect(
      within(screen.getByLabelText("Shop workspace")).getByRole("link", { name: "History" }),
    ).toHaveAttribute("href", `/shops/${SHOP_ID}/history`);
  });
});
