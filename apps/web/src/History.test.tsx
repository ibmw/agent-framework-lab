import type {
  ExperimentHistoryEntrySchema,
  ExperimentHistoryResponse,
  HistoryArmSchema,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderApp } from "./test/app";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const OTHER_SHOP_ID = "6a5b4c3d-2e1f-4a0b-8c9d-1e2f3a4b5c6d";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const OTHER_SCENARIO_ID = "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b";
const FINISHED_ID = "9f8e7d6c-5b4a-4392-8817-6f5e4d3c2b1a";
const RUNNING_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const DERIVED_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

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
    agent_configuration_latest_version: 4,
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

/** A run derived from another one: an ordinary experiment that names where it came from. */
const DERIVED: ExperimentHistoryEntrySchema = {
  ...FINISHED,
  experiment_id: DERIVED_ID,
  label: "Prompt A against prompt B (replay)",
  participant_driver: "scripted",
  derived_from: {
    experiment_id: FINISHED_ID,
    label: "Prompt A against prompt B",
    kind: "replay" as const,
    changed: [],
  },
  tags: [],
  note_count: 0,
  created_at: "2026-09-04T09:15:00+00:00",
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

/**
 * A lab with shops, which is the lab this page is normally read in.
 *
 * It matters to the no-current-shop notice: the copy there is about the shop switcher in the
 * top bar, and the top bar draws the switcher only where there are shops to switch between.
 * A fixture with no shops would pin that copy in the one state it is not true of.
 */
const SHOP_LISTING: ShopListResponse = {
  shops: [
    {
      shop_id: SHOP_ID,
      name: "Northstar Outfitters",
      slug: "northstar",
      updated_at: "2026-08-28T09:00:00+00:00",
      latest_published_version: 3,
      published_version_count: 3,
    },
    {
      shop_id: OTHER_SHOP_ID,
      name: "Southline Supply",
      slug: "southline",
      updated_at: "2026-08-28T09:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

/** The page's own Shop filter, which shares its accessible name with the top bar's switcher. */
function shopFilter(): HTMLElement {
  return within(screen.getByRole("form", { name: "Narrow history" })).getByRole("combobox", {
    name: "Shop",
  });
}

/** The top bar's shop switcher, or null where the lab has no shops to draw one from. */
function shopSwitcher(): HTMLElement | null {
  return (
    screen
      .queryAllByRole("combobox", { name: "Shop" })
      .find((control) => !control.closest("form")) ?? null
  );
}

let asked: URLSearchParams[] = [];
let unavailable = false;
let replayed: string[] = [];
/** Every fork the listing asked for, as the backend received it. */
let forked: { configuration_id: string; version: number }[][] = [];
let rows: ExperimentHistoryEntrySchema[] = EVERY_ROW;

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(SHOP_LISTING)),
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
    const listed = shop === null ? rows : rows.filter((row) => row.shop_id === shop);
    return HttpResponse.json({ ...historyOf(listed), total: listed.length });
  }),
  http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${FINISHED_ID}/replays`, () => {
    replayed.push(FINISHED_ID);
    return HttpResponse.json({ experiment_id: DERIVED_ID }, { status: 201 });
  }),
  http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${FINISHED_ID}/forks`, async ({ request }) => {
    const body = (await request.json()) as {
      arms: { configuration_id: string; version: number }[];
    };
    forked.push(body.arms);
    return HttpResponse.json({ experiment_id: DERIVED_ID }, { status: 201 });
  }),
  // The derived run's own screen is the results suite's; here it only has to be somewhere
  // this page navigated to, so its three reads answer rather than going unhandled.
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${DERIVED_ID}/*`, () =>
    HttpResponse.json(
      { code: "internal_error", message: "not part of this suite", request_id: "req-2" },
      { status: 500 },
    ),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${DERIVED_ID}`, () =>
    HttpResponse.json(
      { code: "internal_error", message: "not part of this suite", request_id: "req-2" },
      { status: 500 },
    ),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
beforeEach(() => {
  // The lab remembers a shop in this browser, and a test that derived a run left one behind:
  // the derivation lands on `/lab/bench/:shopId/…`, which writes the preference. Every test
  // here starts from a browser that remembers none, which is the state the no-current-shop
  // notice is about and the only one in which the rest of the page is unaffected.
  window.localStorage.clear();
  asked = [];
  unavailable = false;
  replayed = [];
  forked = [];
  rows = EVERY_ROW;
});
afterAll(() => server.close());

function renderHistory(search = "") {
  return renderApp(`/lab/history${search}`);
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
      `/lab/bench/${OTHER_SHOP_ID}/${RUNNING_ID}/results`,
    );
    expect(within(row).getByRole("link", { name: "Open live bench" })).toHaveAttribute(
      "href",
      `/lab/bench/${OTHER_SHOP_ID}/${RUNNING_ID}`,
    );
  });

  it("says which run a row was derived from, and links to the one it replays", async () => {
    rows = [DERIVED, FINISHED];
    renderHistory();

    const table = await screen.findByRole("table");
    const derived = within(table)
      .getByText("Prompt A against prompt B (replay)")
      .closest("tr") as HTMLElement;
    const source = within(table)
      .getAllByText("Prompt A against prompt B")
      .map((node) => node.closest("tr") as HTMLElement)
      .find((candidate) => candidate !== derived) as HTMLElement;

    expect(
      within(derived).getByRole("link", { name: "Prompt A against prompt B" }),
    ).toHaveAttribute("href", `/lab/bench/${SHOP_ID}/${FINISHED_ID}/results`);
    // Provenance is on the derived row alone: the run it came from is not a replay of
    // anything, and a marker on both would make the pair unreadable.
    expect(within(source).queryByText(/^replay of/)).toBeNull();
  });

  it("replays a row's recorded versions and leaves the listing for what that produced", async () => {
    const user = userEvent.setup();
    renderHistory();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Replay recorded versions" }));

    expect(replayed).toEqual([FINISHED_ID]);
    // What came back is a different experiment, so the operator is taken to it rather than
    // left on a listing that now has one more row than it shows.
    expect(await screen.findByRole("heading", { name: "Experiment results" })).toBeVisible();
  });

  it("forks a row onto the newest published version of every arm it ran", async () => {
    const user = userEvent.setup();
    // A newer publication of arm A's configuration, which is what a fork from a listing is.
    rows = [
      {
        ...FINISHED,
        arms: FINISHED.arms.map((entry, position) =>
          position === 0 ? { ...entry, agent_configuration_latest_version: 7 } : entry,
        ),
      },
    ];
    renderHistory();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Fork with newer versions" }));

    const [first, second] = rows[0].arms;
    expect(forked).toEqual([
      [
        { configuration_id: first.agent_configuration_id, version: 7 },
        {
          configuration_id: second.agent_configuration_id,
          version: second.agent_configuration_version,
        },
      ],
    ]);
    expect(await screen.findByRole("heading", { name: "Experiment results" })).toBeVisible();
  });

  it("offers no fork on a row whose arms already run the newest versions", async () => {
    renderHistory();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;

    // The backend refuses a derivation that changes nothing, so the row says why rather than
    // offering a button that can only fail.
    expect(within(row).getByRole("button", { name: "Fork with newer versions" })).toBeDisabled();
  });

  it("narrows by shop, offering every other shop the lab has run in", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("table");

    await user.selectOptions(shopFilter(), "Southline Supply");

    await waitFor(() => expect(lastAsked().get("shop_id")).toBe(OTHER_SHOP_ID));
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    // Choosing one shop must not remove the other from the filter that chose it.
    expect(within(shopFilter()).getAllByRole("option")).toHaveLength(3);
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
    expect(shopFilter()).toHaveValue(OTHER_SHOP_ID);
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

  it("is reachable from the lab's rail, and carries no shop in its address", async () => {
    // History has listed every run in the lab since ADR 0034, and it is now addressed the way
    // it reads: outside any one shop (ADR 0054).
    renderHistory();
    await screen.findByRole("table");

    expect(
      within(screen.getByLabelText("Experiment lab workspace")).getByRole("link", {
        name: "History",
      }),
    ).toHaveAttribute("href", "/lab/history");
  });

  it("says the lab has no current shop, and says only what is true of the top bar", async () => {
    // The notice reports the lab's state and never this list's. It renders on the lab's shop
    // alone; the narrowing is the URL's (ADR 0033). It must therefore not describe how many
    // runs are on screen, and it must name the control it is about — this page has a Shop
    // filter of its own, and the top bar's switcher carries the same accessible name.
    renderHistory();
    await screen.findByRole("table");

    const notice = await screen.findByText(/The lab has no current shop/);
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent("the shop switcher in the top bar names none");
    expect(notice).toHaveTextContent("this filter does not follow it");
    expect(screen.getByRole("link", { name: "Open a shop" })).toHaveAttribute("href", "/shops");

    // The control the copy sends the reader to is on screen, and it does name none. This is
    // the claim, not the wording: a notice about the switcher may only be said where the top
    // bar draws one.
    const switcher = shopSwitcher();
    expect(switcher).not.toBeNull();
    expect(switcher).toHaveValue("");
    expect(
      within(switcher as HTMLElement).getByRole("option", { name: "Select a shop" }),
    ).toBeInTheDocument();

    // And the filter itself is untouched by the notice: every shop with a run is offered.
    const filter = shopFilter();
    expect(filter).toHaveValue("");
    expect(within(filter).getByRole("option", { name: "All shops" })).toBeInTheDocument();
  });

  it("does not send a shopless lab to a switcher the top bar is not drawing", async () => {
    // A lab with no shops reaches the same notice, and the top bar draws no switcher there.
    // The fact and the way out are the ones that are true of it.
    server.use(
      http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
    );
    renderHistory();
    await screen.findByRole("table");

    const notice = await screen.findByText(/This lab has no shops yet/);
    expect(notice).toBeVisible();
    expect(notice).not.toHaveTextContent("switcher");
    expect(shopSwitcher()).toBeNull();
    expect(screen.getByRole("link", { name: "Create a shop" })).toHaveAttribute("href", "/shops");
    // What stays true of every state: this filter is never the lab's shop.
    expect(notice).toHaveTextContent("this filter does not follow the lab's shop");
    expect(screen.queryByText(/The lab has no current shop/)).toBeNull();
  });

  it("does not claim a lab has no current shop when it could not read its shops", async () => {
    // A failed listing is not an answer. The shell has established nothing about which shop is
    // current, so the notice reports the read rather than asserting the absence — and offers
    // the index, where the list is asked for again.
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json({}, { status: 500 })));
    renderHistory();
    await screen.findByRole("table");

    const notice = await screen.findByText(/The lab's shops did not load/);
    expect(notice).toBeVisible();
    expect(notice).not.toHaveTextContent("switcher");
    expect(shopSwitcher()).toBeNull();
    expect(screen.getByRole("link", { name: "Open the shops index" })).toHaveAttribute(
      "href",
      "/shops",
    );
    expect(screen.queryByText(/The lab has no current shop/)).toBeNull();
    expect(screen.queryByText(/This lab has no shops yet/)).toBeNull();
    // The history itself answered, so the page is still a page: the runs are on screen.
    expect(within(screen.getByRole("table")).getByText("Prompt A against prompt B")).toBeVisible();
  });

  it("does not claim the list is unnarrowed when the URL has narrowed it", async () => {
    // The state people actually share: a link kept at the narrowing the finding was found in
    // (ADR 0033), opened in a browser with no remembered shop. The notice renders here, and a
    // sentence about how much of the lab is on screen would be false under a one-shop list.
    renderHistory(`?shop=${SHOP_ID}`);
    await screen.findByRole("table");

    const notice = await screen.findByText(/The lab has no current shop/);
    expect(notice).toBeVisible();
    expect(notice).not.toHaveTextContent(/every run in the lab/);
    expect(
      within(screen.getByRole("form", { name: "Narrow history" })).getByRole("combobox", {
        name: "Shop",
      }),
    ).toHaveValue(SHOP_ID);
  });
});
