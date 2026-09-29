import type {
  AgentConfigurationVersionResponse,
  ExperimentHistoryEntrySchema,
  ExperimentHistoryResponse,
  HistoryArmSchema,
  ModelConnectionSource,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HISTORY_TOTAL_PAGE_SIZE } from "./shell/listings";
import { renderApp } from "./test/app";
import { labConnection } from "./test/connection";
import { indexCard } from "./test/indexes";
import { expectBusy, expectNotRefused } from "./test/refused";
import { bodyRows, railEntry, shellListings } from "./test/shell";

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
  logo: null,
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
      logo: null,
    },
    {
      shop_id: OTHER_SHOP_ID,
      name: "Southline Supply",
      slug: "southline",
      updated_at: "2026-08-28T09:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
      logo: null,
    },
  ],
};

/** The index card's title, which the card is found by. */
const CARD_TITLE = "Recorded across every shop";

/** What the search box is called and what is written in it. */
const SEARCH = "Search experiments, notes and tags";

function searchBox(): HTMLElement {
  return screen.getByRole("searchbox", { name: SEARCH });
}

/** The status chips, inside the card and inside the form. */
function statusChips() {
  return within(screen.getByRole("group", { name: "Filter by status" }));
}

/** Which status chip is pressed, by its name. */
function pressedStatus(): string[] {
  return statusChips()
    .getAllByRole("button")
    .filter((chip) => chip.getAttribute("aria-pressed") === "true")
    .map((chip) => chip.getAttribute("aria-label") ?? "");
}

/** The rows' container, which is what says it is busy while a narrowing is read. */
function rowsOf(): HTMLElement {
  const rows = screen.getByRole("table").closest("[aria-busy]");
  expect(rows, "the rows' busy container").not.toBeNull();
  return rows as HTMLElement;
}

/** The line beside *Clear filters*: why it is disabled, or what its press did. */
function clearLine(): HTMLElement {
  return within(screen.getByRole("form", { name: "Narrow history" })).getByRole("status");
}

function shopFilter(): HTMLElement {
  return within(screen.getByRole("form", { name: "Narrow history" })).getByRole("combobox", {
    name: "Shop",
  });
}

/**
 * The top bar's shop switcher, or null where the lab has no shops to draw one from.
 *
 * It is a button opening a menu now, not a select (ADR 0055), which is also what tells it
 * apart from the page's own *Shop* filter above — the two used to share a role as well as a
 * name.
 */
function shopSwitcher(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^Switch shop/ });
}

let asked: URLSearchParams[] = [];
let unavailable = false;
let replayed: string[] = [];
/** Every fork the listing asked for, as the backend received it. */
let forked: { configuration_id: string; version: number }[][] = [];
let rows: ExperimentHistoryEntrySchema[] = EVERY_ROW;
/** Which answer of ADR 0052's chain the lab gives; a lab that reaches its provider by default. */
let connectionSource: ModelConnectionSource = "environment";
const connectionServed = { statuses: 0, listings: 0 };
let versionReads = 0;
/** The provider a published version names. OpenAI unless a case says otherwise. */
let providerOf: (configurationId: string, version: number) => string = () => "openai";

/** One frozen version of a configuration, naming the provider `providerOf` gives it. */
function publishedVersion(
  configurationId: string,
  version: number,
): AgentConfigurationVersionResponse {
  const provider = providerOf(configurationId, version);
  return {
    configuration_id: configurationId,
    lifecycle_state: "published",
    version,
    content_fingerprint: "e".repeat(64),
    published_at: "2026-08-28T08:00:00+00:00",
    support_identity_version: 1,
    content: {
      name: "cfg-atlas",
      description: "",
      framework_id: provider === "fake" ? "fake" : "pydantic-ai",
      architecture: "single_agent",
      support_identity_id: "8e9f0a1b-2c3d-4e5f-8a6b-7c8d9e0f1a2b",
      prompt: "You are a support agent.",
      tone_of_voice: { source: "shop_default", guideline_id: "" },
      tools: [],
      memory: "conversation",
      model: {
        provider,
        model_id: provider === "fake" ? "deterministic" : "gpt-5-mini",
        temperature: "0.20",
        max_tool_rounds: 8,
      },
    },
  };
}

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
    record(url);
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
  http.get("*/api/v1/agent-configurations/:configurationId/versions/:version", ({ params }) => {
    versionReads += 1;
    return HttpResponse.json(
      publishedVersion(String(params.configurationId), Number(params.version)),
    );
  }),
  ...labConnection(() => connectionSource, connectionServed),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
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
  connectionSource = "environment";
  connectionServed.statuses = 0;
  connectionServed.listings = 0;
  versionReads = 0;
  providerOf = () => "openai";
});
afterAll(() => server.close());

function renderHistory(search = "") {
  return renderApp(`/lab/history${search}`);
}

/**
 * What the *page* asked for.
 *
 * The lab's shell reads this same route for the one figure the rail draws beside *History* —
 * a single row asked for its `total` and nothing else (ADR 0056). That is not a narrowing
 * anybody chose, so it is not what this suite means by "what was asked". Every handler that
 * records goes through here, so `asked` means one thing across the whole file.
 */
function record(url: URL): void {
  if (url.searchParams.get("page_size") !== String(HISTORY_TOTAL_PAGE_SIZE)) {
    asked.push(url.searchParams);
  }
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

  it("says a run's scenario has moved on without pretending the run did", async () => {
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

  it("draws a run's status as the shared pill: the axis's glyph beside the word", async () => {
    renderHistory();

    const table = await screen.findByRole("table");
    for (const word of ["Failed", "Running"]) {
      const pill = within(table).getByText(word);
      const glyph = pill.firstElementChild;
      expect(glyph, `the glyph beside ${word}`).not.toBeNull();
      expect(glyph).toHaveAttribute("aria-hidden");
      expect(glyph).toHaveTextContent("▷");
      // One fill for every state, as every status axis but publication draws: the word and
      // the glyph carry it, never a colour of the page's own.
      expect(pill).toHaveClass("rounded-full", "bg-admin-border/60");
      expect(pill.className).not.toMatch(/lab-error|admin-draft|admin-published/);
    }
  });

  it("draws a row's secondary lines at the table's 13px, as every index does", async () => {
    renderHistory();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;
    for (const line of [
      within(row).getByText("Northstar Outfitters"),
      within(row).getByText("v1"),
    ]) {
      expect(line).toHaveClass("text-admin-muted");
      expect(line).not.toHaveClass("text-xs");
    }
  });

  it("offers New experiment in its header, with the create glyph, to the bench", async () => {
    renderHistory();

    const create = await screen.findByRole("link", { name: "New experiment" });
    expect(create).toHaveAttribute("href", "/lab/bench");
    expect(create.closest("header")).not.toBeNull();
    expect(create.querySelector("svg")).toHaveClass("lucide-plus");
  });

  it("offers the statuses as chips in the card, named by their words and counting nothing", async () => {
    renderHistory();
    await screen.findByRole("table");

    const chips = statusChips().getAllByRole("button");
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "All",
      "Running",
      "Completed",
      "Failed",
    ]);
    for (const chip of chips) {
      // The payload counts no status, so no chip draws a figure — not even a zero.
      expect(chip).toHaveAccessibleName(chip.textContent ?? "");
      expect(chip.textContent).not.toMatch(/\d/);
    }
    expect(pressedStatus()).toEqual(["All"]);
    expect(indexCard(CARD_TITLE)).toContainElement(
      screen.getByRole("group", { name: "Filter by status" }),
    );
  });

  it("narrows the address and the listing on a chip's press, as the selects do", async () => {
    const user = userEvent.setup();
    const { router } = renderHistory();
    await screen.findByRole("table");

    await user.click(statusChips().getByRole("button", { name: "Failed" }));

    // At once, and into the address: the listing asked for is the one the address names.
    await waitFor(() => expect(lastAsked().get("status")).toBe("failed"));
    expect(new URLSearchParams(router.state.location.search).get("status")).toBe("failed");
    // Pushed, as every narrowing of this form is, so Back walks it back.
    expect(router.state.historyAction).toBe("PUSH");
    expect(pressedStatus()).toEqual(["Failed"]);

    await user.click(statusChips().getByRole("button", { name: "All" }));

    await waitFor(() => expect(lastAsked().get("status")).toBeNull());
    expect(router.state.location.search).toBe("");
    expect(pressedStatus()).toEqual(["All"]);
  });

  it("opens with the chip its address names pressed, so a reload keeps it", async () => {
    renderHistory("?status=failed");
    await screen.findByRole("table");

    expect(lastAsked().get("status")).toBe("failed");
    expect(pressedStatus()).toEqual(["Failed"]);
  });

  it("opens a row's evidence and its bench, each in the shop that ran it", async () => {
    renderHistory();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Control policy alone").closest("tr") as HTMLElement;

    expect(within(row).getByRole("link", { name: "Open results" })).toHaveAttribute(
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
    expect(await screen.findByRole("heading", { name: "Results" })).toBeVisible();
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
    expect(await screen.findByRole("heading", { name: "Results" })).toBeVisible();
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
    await user.click(statusChips().getByRole("button", { name: "Completed" }));
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

    await user.type(searchBox(), "beacon");
    expect(asked).toHaveLength(reads);

    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(lastAsked().get("q")).toBe("beacon"));
  });

  it("ends the form on Clear filters and then Search, as the frame draws it", async () => {
    renderHistory();
    await screen.findByRole("table");

    const form = screen.getByRole("form", { name: "Narrow history" });
    const controls = Array.from(form.querySelectorAll("input, select, button")).map(
      (control) =>
        control.getAttribute("aria-label") ??
        control.getAttribute("placeholder") ??
        control.textContent,
    );

    // The search box opens the form, in the card's head; the status chips follow it; the
    // facets are the second row; and the form ends on its two actions.
    expect(controls).toEqual([
      SEARCH,
      "All",
      "Running",
      "Completed",
      "Failed",
      "Shop",
      "Scenario",
      "Framework",
      "Tag",
      "Objective outcome",
      "Started",
      "Clear filters",
      "Search",
    ]);
    // All of it inside the one index card, under its title.
    expect(indexCard(CARD_TITLE)).toContainElement(form);
  });

  it("offers nothing to clear on an unnarrowed list, and says why", async () => {
    renderHistory();
    await screen.findByRole("table");

    const clear = screen.getByRole("button", { name: "Clear filters" });

    expect(clear).toBeDisabled();
    expect(clear).toHaveAttribute("title", "No filter is set, so every run is shown.");
    expect(clear).toHaveAccessibleDescription("No filter is set, so every run is shown.");
  });

  it("clears every filter and the query at once, and says so", async () => {
    const user = userEvent.setup();
    const { router } = renderHistory(
      `?shop=${OTHER_SHOP_ID}&scenario=${SCENARIO_ID}&framework=pydantic-ai&tag=two-arm&status=failed&outcome=missed&span=30&q=beacon&page=2`,
    );
    await screen.findByRole("table");
    await waitFor(() => expect(lastAsked().get("q")).toBe("beacon"));
    const reads = asked.length;

    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toBeEnabled();
    expect(clear).not.toHaveAccessibleDescription();
    await user.click(clear);

    await waitFor(() => expect(asked.length).toBeGreaterThan(reads));
    const unnarrowed = lastAsked();
    for (const key of [
      "shop_id",
      "scenario_id",
      "framework_id",
      "tag",
      "status",
      "outcome",
      "started_after",
      "q",
    ]) {
      expect(unnarrowed.get(key) ?? "", key).toBe("");
    }
    expect(unnarrowed.get("page")).toBe("1");
    const form = within(screen.getByRole("form", { name: "Narrow history" }));
    expect(searchBox()).toHaveValue("");
    expect(shopFilter()).toHaveValue("");
    expect(form.getByLabelText("Scenario")).toHaveValue("");
    expect(form.getByLabelText("Framework")).toHaveValue("");
    expect(form.getByLabelText("Tag")).toHaveValue("");
    expect(form.getByLabelText("Objective outcome")).toHaveValue("");
    expect(form.getByLabelText("Started")).toHaveValue("");
    expect(pressedStatus()).toEqual(["All"]);
    // The address holds none of it either, so a reload does not bring any of it back.
    expect(router.state.location.search).toBe("");
    // It says what it did where it will be heard, and hands focus to the form it emptied
    // rather than dropping it with the button it disabled.
    expect(clearLine()).toHaveTextContent("Filters cleared. Every run is shown.");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
    expect(searchBox()).toHaveFocus();
  });

  it("clears words typed into the search box and not yet searched for", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("table");

    await user.type(searchBox(), "beacon");
    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toBeEnabled();

    await user.click(clear);

    expect(searchBox()).toHaveValue("");
    expect(clearLine()).toHaveTextContent("Filters cleared. Every run is shown.");
  });

  it("stops saying the filters were cleared once one is set again", async () => {
    const user = userEvent.setup();
    renderHistory("?status=failed");
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(clearLine()).toHaveTextContent("Filters cleared.");

    await user.click(statusChips().getByRole("button", { name: "Completed" }));

    await waitFor(() => expect(clearLine()).toHaveTextContent(""));
    expect(clearLine()).toBeEmptyDOMElement();
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
        record(new URL(request.url));
        return HttpResponse.json({ ...historyOf(EVERY_ROW), page: 1, total: 42 });
      }),
    );
    renderHistory();
    await screen.findByRole("table");

    expect(screen.getByText("Showing 1–20 of 42")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastAsked().get("page")).toBe("2"));

    await user.click(statusChips().getByRole("button", { name: "Running" }));

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
    const listed = rowsOf();
    expect(listed).toHaveAttribute("aria-busy", "false");
    // The rows and not the card: the form over them is not what is about to change.
    expect(screen.getByRole("region", { name: "Experiment history" })).not.toHaveAttribute(
      "aria-busy",
    );
    expect(listed).not.toContainElement(screen.getByRole("form", { name: "Narrow history" }));

    server.use(
      http.get("*/api/v1/experiments", async ({ request }) => {
        record(new URL(request.url));
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json(historyOf([FINISHED]));
      }),
    );
    await user.click(statusChips().getByRole("button", { name: "Failed" }));

    await waitFor(() => expect(listed).toHaveAttribute("aria-busy", "true"));
    // The previous narrowing's rows are still readable while the next one is in flight.
    expect(within(listed).getByText("Control policy alone")).toBeVisible();
    answer();
    await waitFor(() => expect(listed).toHaveAttribute("aria-busy", "false"));
  });

  it("reports a lab it cannot read with the backend's own reason, inside its card", async () => {
    unavailable = true;
    renderHistory();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The lab could not read its own history");
    expect(indexCard(CARD_TITLE)).toContainElement(alert);
    expect(screen.queryByRole("table")).toBeNull();
    // A listing that never arrived has no facets to offer and has said nothing about the lab.
    expect(screen.queryByRole("form", { name: "Narrow history" })).toBeNull();
    expect(screen.queryByText(/No experiment/)).toBeNull();
  });

  it("drops the rows of an earlier answer when the next read fails", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("table");

    unavailable = true;
    await user.click(statusChips().getByRole("button", { name: "Failed" }));

    const alert = await screen.findByRole("alert");
    expect(indexCard(CARD_TITLE)).toContainElement(alert);
    // Those rows answered another narrowing, and on screen they would read as this one's.
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("says a replay that failed above the card, and keeps the rows it was pressed on", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${FINISHED_ID}/replays`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The replay could not start", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderHistory();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Replay recorded versions" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The replay could not start");
    // A derivation's failure is not the listing's: it is said outside the card, and the
    // listing it was pressed from is still there.
    expect(indexCard(CARD_TITLE)).not.toContainElement(alert);
    expect(within(screen.getByRole("table")).getByText("Control policy alone")).toBeVisible();
  });

  it("tells a lab that has run nothing how to start, rather than showing an empty table", async () => {
    rows = [];
    renderHistory();

    const empty = await screen.findByText(/No experiment yet/);
    expect(indexCard(CARD_TITLE)).toContainElement(empty);
    expect(within(empty).getByRole("link", { name: "start one on the bench" })).toHaveAttribute(
      "href",
      "/lab/bench",
    );
    expect(screen.queryByText(/matches this view/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says a narrowing missed when the lab holds runs it left out", async () => {
    // The page asked for failed runs and got none; the lab's total — the rail's figure — is two.
    server.use(
      http.get("*/api/v1/experiments", ({ request }) => {
        const url = new URL(request.url);
        record(url);
        const whole = url.searchParams.get("page_size") === String(HISTORY_TOTAL_PAGE_SIZE);
        return HttpResponse.json(historyOf(whole ? EVERY_ROW : []));
      }),
    );
    renderHistory("?status=failed");

    await waitFor(() =>
      expect(within(railEntry("History", "Experiment lab workspace")).getByText("2")).toBeVisible(),
    );
    const miss = await screen.findByText("No experiment matches this view.");
    expect(indexCard(CARD_TITLE)).toContainElement(miss);
    expect(screen.queryByText(/No experiment yet/)).toBeNull();
    // The way out of a miss is the form, which is still there.
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeEnabled();
  });

  it("says a lab has run nothing even under a narrowing, once its total says so", async () => {
    rows = [];
    renderHistory("?status=failed");

    await waitFor(() =>
      expect(within(railEntry("History", "Experiment lab workspace")).getByText("0")).toBeVisible(),
    );
    expect(await screen.findByText(/No experiment yet/)).toBeVisible();
    expect(screen.queryByText(/matches this view/)).toBeNull();
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
    // It names no shop, which is what the notice says of it.
    expect(switcher).toHaveAccessibleName("Switch shop");
    expect(switcher).toHaveTextContent("Select a shop");

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

/**
 * The rail says how many experiments the lab has run, which is the whole list and not the
 * page on screen — the rule the chip row observes and the reason the shell asks for the
 * total rather than holding the rows (ADR 0056).
 */
/** What a row's Replay and Fork are described by as well, before the press as after (ADR 0065). */
const DERIVING =
  "This can take a minute and cannot be cancelled. If you are still here when its arms are done, the new run opens; History lists it either way.";

/** Holds every request to one route until released, then hands it to the suite's handler. */
function holdEach(path: string) {
  let arrived = 0;
  const waiting: (() => void)[] = [];
  server.use(
    http.post(path, async () => {
      arrived += 1;
      await new Promise<void>((resolve) => waiting.push(resolve));
    }),
  );
  return { arrived: () => arrived, release: () => waiting.shift()?.() };
}

describe("a row's replay and fork report themselves", () => {
  const MINUTE = "This can take a minute and cannot be cancelled.";

  function queueRows(region: HTMLElement): string[] {
    return Array.from(region.querySelectorAll("li"), (row) =>
      Array.from(row.children, (cell) => cell.textContent).join(" | "),
    );
  }

  it("names the run and its arms while a replay runs, and holds the press with focus", async () => {
    const user = userEvent.setup();
    const replays = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${FINISHED_ID}/replays`);
    renderHistory();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;
    const queue = screen.getByRole("status", { name: "Where each derived arm stands" });
    expect(queue).toHaveTextContent("");

    const replay = within(row).getByRole("button", { name: "Replay recorded versions" });
    await user.click(replay);

    await waitFor(() => expect(replays.arrived()).toBe(1));
    // A press made again meanwhile, by a click or a key, starts nothing more (ADR 0065).
    await user.click(replay);
    await user.keyboard("{Enter}");
    expect(replays.arrived()).toBe(1);
    expect(queueRows(queue)).toEqual([
      "Arm A | cfg-atlas v4 | running…",
      "Arm B | cfg-beacon v4 | running…",
    ]);
    expect(queue).toHaveTextContent("Replaying Prompt A against prompt B: 2 of 2 running.");
    expect(replay).toHaveTextContent("Replaying…");
    expectBusy(replay);
    expect(replay).toHaveAccessibleDescription(
      `${MINUTE} If you are still here when its arms are done, the new run opens; History lists it either way.`,
    );
    // Outside the table, which is busy only while it is read again.
    expect(screen.getByRole("region", { name: "Experiment history" })).not.toContainElement(queue);
    // No second derivation starts meanwhile, from this row or another.
    const others = within(table)
      .getAllByRole("button", { name: /Replay recorded versions|Fork with newer versions/ })
      .filter((button) => button !== replay);
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(other).toBeDisabled();
    }

    replays.release();
    expect(await screen.findByRole("heading", { name: "Results" })).toBeVisible();
    expect(replayed).toEqual([FINISHED_ID]);
  });

  it("names the versions a fork moves onto while it runs", async () => {
    const user = userEvent.setup();
    rows = [
      {
        ...FINISHED,
        arms: FINISHED.arms.map((entry, position) =>
          position === 0 ? { ...entry, agent_configuration_latest_version: 7 } : entry,
        ),
      },
    ];
    const forks = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${FINISHED_ID}/forks`);
    renderHistory();
    const table = await screen.findByRole("table");
    const row = within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;

    const fork = within(row).getByRole("button", { name: "Fork with newer versions" });
    await user.click(fork);

    await waitFor(() => expect(forks.arrived()).toBe(1));
    // A press made again meanwhile, by a click or a key, starts nothing more (ADR 0065).
    await user.click(fork);
    await user.keyboard("{Enter}");
    expect(forks.arrived()).toBe(1);
    const queue = screen.getByRole("status", { name: "Where each derived arm stands" });
    expect(queueRows(queue)).toEqual([
      "Arm A | cfg-atlas v7 | running…",
      "Arm B | cfg-beacon v4 | running…",
    ]);
    expect(queue).toHaveTextContent("Forking Prompt A against prompt B: 2 of 2 running.");
    expect(fork).toHaveTextContent("Forking…");
    expectBusy(fork);
    // The replay beside it was not pressed, so it keeps its own name.
    expect(within(row).getByRole("button", { name: "Replay recorded versions" })).toBeDisabled();

    forks.release();
    expect(await screen.findByRole("heading", { name: "Results" })).toBeVisible();
  });
});

describe("the rail's figure and this index", () => {
  const LAB = "Experiment lab workspace";

  it("says on the rail what the unnarrowed table has rows", async () => {
    renderHistory();

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry("History", LAB);
    await waitFor(() => expect(within(entry).getByText(String(rows))).toBeVisible());
    expect(entry).toHaveAccessibleDescription(`${rows} experiment${rows === 1 ? "" : "s"}`);
  });

  it("keeps saying the whole lab's total while the table is narrowed to one shop", async () => {
    renderHistory(`?shop=${OTHER_SHOP_ID}`);

    const table = await screen.findByRole("table");
    await waitFor(() => expect(bodyRows(table)).toBe(1));
    expect(within(railEntry("History", LAB)).getByText("2")).toBeVisible();
  });
});

/**
 * A row's Replay and Fork run their arms before they answer, so an arm naming a provider this
 * lab cannot reach is refused there with 422 and nothing written. The row says so first, with
 * the sentence setup's Start carries (ADR 0053 and its amendment).
 */
describe("a row's replay, fork and the provider the lab can reach", () => {
  const NOTE =
    "Published configurations naming OpenAI cannot be advanced here until the lab has a connection for it.";
  const BROKEN_READ = {
    code: "internal_error",
    message: "The lab could not complete the request.",
    request_id: "r",
  };
  /** Arm A's configuration has a newer publication, v7, which is what the row forks onto. */
  const FORKABLE: ExperimentHistoryEntrySchema = {
    ...FINISHED,
    arms: FINISHED.arms.map((entry, position) =>
      position === 0 ? { ...entry, agent_configuration_latest_version: 7 } : entry,
    ),
  };

  /**
   * Both reads that say what the lab reaches have answered — once each, which is all the page
   * asks — and the page has drawn them.
   */
  async function connectionRead() {
    await waitFor(() => {
      expect(connectionServed.statuses).toBe(1);
      expect(connectionServed.listings).toBe(1);
    });
    await settle();
  }

  /**
   * The same, once the page has read exactly `distinct` versions: one per version the row's
   * replay and fork would pin, however many arms pin it.
   */
  async function versionRead(distinct: number) {
    await connectionRead();
    await waitFor(() => expect(versionReads).toBe(distinct));
    await settle();
    expect(versionReads).toBe(distinct);
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function forkableRow(): Promise<HTMLElement> {
    const table = await screen.findByRole("table");
    return within(table).getByText("Prompt A against prompt B").closest("tr") as HTMLElement;
  }

  function failing(route: "lab-status" | "model-connections") {
    return http.get(`*/api/v1/${route}`, () => {
      if (route === "lab-status") {
        connectionServed.statuses += 1;
      } else {
        connectionServed.listings += 1;
      }
      return HttpResponse.json(BROKEN_READ, { status: 500 });
    });
  }

  it("leaves a row's Replay and Fork alone on a lab that reaches their provider", async () => {
    rows = [FORKABLE];
    renderHistory();
    const row = await forkableRow();
    await connectionRead();
    // A lab that reaches its provider has nothing to ask of a version.
    expect(versionReads).toBe(0);

    const replay = within(row).getByRole("button", { name: "Replay recorded versions" });
    const fork = within(row).getByRole("button", { name: "Fork with newer versions" });
    expect(replay).toBeEnabled();
    expectNotRefused(fork);
    expect(replay).not.toHaveAttribute("title");
    expect(fork).not.toHaveAttribute("title");
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  for (const source of ["none", "saved_unreadable"] as const) {
    it(`disables a row's Replay and Fork with one line when a lab on ${source} cannot reach their arms`, async () => {
      const user = userEvent.setup();
      connectionSource = source;
      rows = [FORKABLE];
      renderHistory();
      const row = await forkableRow();

      const replay = within(row).getByRole("button", { name: "Replay recorded versions" });
      const fork = within(row).getByRole("button", { name: "Fork with newer versions" });
      await waitFor(() => expect(replay).toBeDisabled());
      await waitFor(() => expect(fork).toBeDisabled());
      // Four pins — two arms ran v4, the fork moves one onto v7 and keeps the other on v4 —
      // and two versions, each read once.
      await versionRead(2);
      for (const control of [replay, fork]) {
        expect(control).toHaveAttribute("title", NOTE);
        expect(control).toHaveAccessibleDescription(`${NOTE} ${DERIVING}`);
      }
      // Two arms on one provider, and two refusals with one cause: one sentence.
      expect(within(row).getAllByText(NOTE)).toHaveLength(1);
      expect(within(row).getByText(NOTE)).toBeVisible();

      await user.click(replay);
      await user.click(fork);
      expect(replayed).toEqual([]);
      expect(forked).toEqual([]);
    });
  }

  it("releases the fork when the versions it moves onto are reachable, and blocks the replay alone", async () => {
    connectionSource = "none";
    // Both arms ran v4 of one configuration, which names OpenAI; its newer publication, v7,
    // names the control. The replay runs v4 again, and the fork runs v7.
    rows = [
      {
        ...FINISHED,
        arms: FINISHED.arms.map((entry) => ({ ...entry, agent_configuration_latest_version: 7 })),
      },
    ];
    providerOf = (_, version) => (version === 7 ? "fake" : "openai");
    renderHistory();
    const row = await forkableRow();

    const replay = within(row).getByRole("button", { name: "Replay recorded versions" });
    const fork = within(row).getByRole("button", { name: "Fork with newer versions" });
    await waitFor(() => expect(replay).toBeDisabled());
    await versionRead(2);
    expectNotRefused(fork);
    expect(fork).not.toHaveAttribute("title");
    expect(replay).toHaveAccessibleDescription(`${NOTE} ${DERIVING}`);
    expect(within(row).getAllByText(NOTE)).toHaveLength(1);
  });

  it("blocks the fork alone when only the versions it moves onto are unreachable", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    rows = [
      {
        ...FINISHED,
        arms: FINISHED.arms.map((entry) => ({ ...entry, agent_configuration_latest_version: 7 })),
      },
    ];
    providerOf = (_, version) => (version === 7 ? "openai" : "fake");
    renderHistory();
    const row = await forkableRow();

    const replay = within(row).getByRole("button", { name: "Replay recorded versions" });
    const fork = within(row).getByRole("button", { name: "Fork with newer versions" });
    await waitFor(() => expect(fork).toBeDisabled());
    expect(fork).toHaveAttribute("title", NOTE);
    expect(fork).toHaveAccessibleDescription(`${NOTE} ${DERIVING}`);
    expect(replay).toBeEnabled();
    expect(replay).not.toHaveAttribute("title");
    expect(within(row).getAllByText(NOTE)).toHaveLength(1);

    await user.click(replay);
    expect(replayed).toEqual([FINISHED_ID]);
    // The replay lands on the derived run's results, which reads the lab's reach for itself.
    // Waited for here, so none of its reads is counted against the case after this one.
    expect(await screen.findByRole("heading", { name: "Results" })).toBeVisible();
    await waitFor(() => {
      expect(connectionServed.statuses).toBe(2);
      expect(connectionServed.listings).toBe(2);
    });
  });

  it("replays a row on the declared control whatever the lab can reach", async () => {
    connectionSource = "none";
    rows = [FORKABLE];
    providerOf = () => "fake";
    renderHistory();
    const row = await forkableRow();
    await versionRead(2);

    expect(within(row).getByRole("button", { name: "Replay recorded versions" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "Fork with newer versions" })).toBeEnabled();
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  for (const route of ["lab-status", "model-connections"] as const) {
    it(`leaves a row's Replay and Fork alone when ${route} cannot be read`, async () => {
      connectionSource = "none";
      rows = [FORKABLE];
      server.use(failing(route));
      renderHistory();
      const row = await forkableRow();
      await connectionRead();
      // A lab whose reach is unknown asks nothing of a version either.
      expect(versionReads).toBe(0);

      expect(within(row).getByRole("button", { name: "Replay recorded versions" })).toBeEnabled();
      expect(within(row).getByRole("button", { name: "Fork with newer versions" })).toBeEnabled();
      expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
    });
  }

  it("leaves a row's Replay and Fork alone when the versions they would run cannot be read", async () => {
    connectionSource = "none";
    rows = [FORKABLE];
    server.use(
      http.get("*/api/v1/agent-configurations/:configurationId/versions/:version", () => {
        versionReads += 1;
        return HttpResponse.json(BROKEN_READ, { status: 500 });
      }),
    );
    renderHistory();
    const row = await forkableRow();
    await versionRead(2);

    expect(within(row).getByRole("button", { name: "Replay recorded versions" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "Fork with newer versions" })).toBeEnabled();
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  it("keeps a fork with nothing newer on its own reason, while the replay beside it carries the reach line", async () => {
    connectionSource = "none";
    // Every arm already runs the newest publication, v4, which names OpenAI.
    rows = [FINISHED];
    renderHistory();
    const row = await forkableRow();

    const replay = within(row).getByRole("button", { name: "Replay recorded versions" });
    const fork = within(row).getByRole("button", { name: "Fork with newer versions" });
    await waitFor(() => expect(replay).toBeDisabled());
    await versionRead(1);
    expect(replay).toHaveAccessibleDescription(`${NOTE} ${DERIVING}`);
    // The fork cannot move anything, which is its reason; the lab's reach is not a second one.
    expect(fork).toBeDisabled();
    expect(fork).toHaveAccessibleDescription(
      `Every arm already runs the newest published version of its configuration, and a derivation that changes nothing is a replay. ${DERIVING}`,
    );
    expect(fork).not.toHaveAttribute("title");
    expect(within(row).getAllByText(NOTE)).toHaveLength(1);
  });
});
