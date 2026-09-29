import type {
  BlockListResponse,
  MutationBlockDraftResponse,
  MutationBlockPayloadSchema,
  MutationBlockPreviewResponse,
  ObjectiveBlockDraftResponse,
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPreviewResponse,
  ObjectiveBlockVersionResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TOURS } from "./lib/tours";
import { neutralPillClasses } from "./lib/ui";
import { renderApp } from "./test/app";
import { expectWayBack } from "./test/header";
import { expectPublicationPill } from "./test/indexes";
import { panelCards, panelFields, sidePanel } from "./test/panel";
import { expectNotRefused, expectRefused, submitWithoutPressing } from "./test/refused";
import { expectCardOnRows, expectFieldRow } from "./test/rows";
import { bodyRows, railEntry, shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const OBJECTIVE_ID = "1a2b3c4d-5e6f-4708-9a0b-1c2d3e4f5a6b";
const MUTATION_ID = "7f6e5d4c-3b2a-4019-8877-665544332211";

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

const OBJECTIVE_CONTENT: ObjectiveBlockPayloadSchema = {
  name: "read-required-document",
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
};

const MUTATION_CONTENT: MutationBlockPayloadSchema = {
  name: "concurrent-entity-mutation",
  statement: "",
  description: "",
  effect: "entity_mutation",
  parameters: [
    {
      name: "entity_ref",
      kind: "entity_reference",
      description: "The order or customer that moves under the arm.",
      required: true,
      default: null,
      shop_bound: true,
    },
  ],
};

function objectivePreview(
  overrides: Partial<ObjectiveBlockPreviewResponse> = {},
): ObjectiveBlockPreviewResponse {
  return {
    block_id: OBJECTIVE_ID,
    publishable: true,
    issues: [],
    changes: [
      { kind: "added", path: "", description: "First published version of read-required-document" },
    ],
    content_fingerprint: "a".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: currentObjective,
    ...overrides,
  };
}

function mutationPreview(
  overrides: Partial<MutationBlockPreviewResponse> = {},
): MutationBlockPreviewResponse {
  return {
    block_id: MUTATION_ID,
    publishable: false,
    issues: [
      {
        severity: "error",
        code: "mutation_without_timing",
        message: "a mutation is injected at a bound moment, so it must declare a timing parameter",
        path: "parameters",
      },
      {
        severity: "error",
        code: "block_without_statement",
        message: "a scenario renders each bound instance as this statement, so it cannot be empty",
        path: "statement",
      },
    ],
    changes: [],
    content_fingerprint: "b".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: currentMutation,
    ...overrides,
  };
}

const objectiveIndex: BlockListResponse = {
  blocks: [
    {
      block_id: OBJECTIVE_ID,
      name: "read-required-document",
      statement: "Read document",
      type_label: "deterministic · event",
      parameter_count: 2,
      shop_bound_parameter_count: 1,
      updated_at: "2026-08-25T12:05:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
    {
      block_id: "2b3c4d5e-6f70-4819-ab0c-2d3e4f5a6b7c",
      name: "verify-before-disclosure",
      statement: "Verify identity before revealing account data",
      type_label: "deterministic · policy",
      parameter_count: 0,
      shop_bound_parameter_count: 0,
      updated_at: "2026-08-25T12:00:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
  ],
};

const mutationIndex: BlockListResponse = {
  blocks: [
    {
      block_id: MUTATION_ID,
      name: "concurrent-entity-mutation",
      statement: "",
      type_label: "entity_mutation",
      parameter_count: 1,
      shop_bound_parameter_count: 1,
      updated_at: "2026-08-25T12:05:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
  ],
};

const NEW_OBJECTIVE_ID = "3c4d5e6f-7081-4923-a456-7b8c9d0e1f20";
const NEW_MUTATION_ID = "4d5e6f70-8192-4a34-b567-8c9d0e1f2031";

/** What the lab makes from a create request: named, and nothing else decided. */
function newObjective(name: string): ObjectiveBlockPayloadSchema {
  return {
    name,
    statement: "",
    description: "",
    assessment: "deterministic",
    evidence: "event",
    parameters: [],
  };
}

function newMutation(name: string): MutationBlockPayloadSchema {
  return { name, statement: "", description: "", effect: "entity_mutation", parameters: [] };
}

let currentObjective = OBJECTIVE_CONTENT;
let currentMutation = MUTATION_CONTENT;
let savedPayloads: Array<Record<string, unknown>> = [];
let createdNames: string[] = [];
let completedDrafts: Array<Record<string, unknown>> = [];
let objectiveListing: BlockListResponse = objectiveIndex;
let mutationListing: BlockListResponse = mutationIndex;
let publishAttempts = 0;

/** The row a created template adds to its library, so the rail's figure has somewhere to go. */
function listedRow(blockId: string, name: string, typeLabel: string) {
  return {
    block_id: blockId,
    name,
    statement: "",
    type_label: typeLabel,
    parameter_count: 0,
    shop_bound_parameter_count: 0,
    updated_at: "2026-08-25T12:20:00+00:00",
    latest_published_version: null,
    published_version_count: 0,
  };
}

function draft(blockId: string, content: unknown) {
  return {
    block_id: blockId,
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
      latest_published_version: null,
      next_version: 1,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),

  http.get("*/api/v1/objective-blocks", () => HttpResponse.json(objectiveListing)),
  // A create makes the library hold one template more, which is what lets a test watch the
  // rail's figure move rather than agree with a fixture (ADR 0056).
  http.post("*/api/v1/objective-blocks", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    createdNames.push(body.name);
    objectiveListing = {
      blocks: [
        ...objectiveListing.blocks,
        listedRow(NEW_OBJECTIVE_ID, body.name, "deterministic · event"),
      ],
    };
    return HttpResponse.json(draft(NEW_OBJECTIVE_ID, newObjective(body.name)), { status: 201 });
  }),
  http.put(`*/api/v1/objective-blocks/${NEW_OBJECTIVE_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    completedDrafts.push(body.payload);
    return HttpResponse.json(draft(NEW_OBJECTIVE_ID, body.payload) as ObjectiveBlockDraftResponse);
  }),
  http.get(`*/api/v1/objective-blocks/${NEW_OBJECTIVE_ID}/draft`, () =>
    HttpResponse.json(
      draft(
        NEW_OBJECTIVE_ID,
        completedDrafts.at(-1) ?? newObjective(createdNames.at(-1) ?? ""),
      ) as ObjectiveBlockDraftResponse,
    ),
  ),
  http.get(`*/api/v1/objective-blocks/${NEW_OBJECTIVE_ID}/draft/preview`, () =>
    HttpResponse.json(objectivePreview({ block_id: NEW_OBJECTIVE_ID })),
  ),
  http.get(`*/api/v1/objective-blocks/${OBJECTIVE_ID}/draft`, () =>
    HttpResponse.json(draft(OBJECTIVE_ID, currentObjective) as ObjectiveBlockDraftResponse),
  ),
  http.put(`*/api/v1/objective-blocks/${OBJECTIVE_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    savedPayloads.push(body.payload);
    currentObjective = body.payload as unknown as ObjectiveBlockPayloadSchema;
    return HttpResponse.json(draft(OBJECTIVE_ID, currentObjective) as ObjectiveBlockDraftResponse);
  }),
  http.get(`*/api/v1/objective-blocks/${OBJECTIVE_ID}/draft/preview`, () =>
    HttpResponse.json(objectivePreview()),
  ),
  http.post(`*/api/v1/objective-blocks/${OBJECTIVE_ID}/versions`, () => {
    publishAttempts += 1;
    return HttpResponse.json(
      {
        block_id: OBJECTIVE_ID,
        lifecycle_state: "published",
        version: 1,
        content_fingerprint: "d".repeat(64),
        published_at: "2026-08-25T12:10:00+00:00",
        content: currentObjective,
      } satisfies ObjectiveBlockVersionResponse,
      { status: 201 },
    );
  }),

  http.get("*/api/v1/mutation-blocks", () => HttpResponse.json(mutationListing)),
  http.post("*/api/v1/mutation-blocks", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    createdNames.push(body.name);
    mutationListing = {
      blocks: [...mutationListing.blocks, listedRow(NEW_MUTATION_ID, body.name, "tool_fault")],
    };
    return HttpResponse.json(draft(NEW_MUTATION_ID, newMutation(body.name)), { status: 201 });
  }),
  http.put(`*/api/v1/mutation-blocks/${NEW_MUTATION_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    completedDrafts.push(body.payload);
    return HttpResponse.json(draft(NEW_MUTATION_ID, body.payload) as MutationBlockDraftResponse);
  }),
  http.get(`*/api/v1/mutation-blocks/${NEW_MUTATION_ID}/draft`, () =>
    HttpResponse.json(
      draft(
        NEW_MUTATION_ID,
        completedDrafts.at(-1) ?? newMutation(createdNames.at(-1) ?? ""),
      ) as MutationBlockDraftResponse,
    ),
  ),
  http.get(`*/api/v1/mutation-blocks/${NEW_MUTATION_ID}/draft/preview`, () =>
    HttpResponse.json(mutationPreview({ block_id: NEW_MUTATION_ID })),
  ),
  http.get(`*/api/v1/mutation-blocks/${MUTATION_ID}/draft`, () =>
    HttpResponse.json(draft(MUTATION_ID, currentMutation) as MutationBlockDraftResponse),
  ),
  http.put(`*/api/v1/mutation-blocks/${MUTATION_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    savedPayloads.push(body.payload);
    currentMutation = body.payload as unknown as MutationBlockPayloadSchema;
    return HttpResponse.json(draft(MUTATION_ID, currentMutation) as MutationBlockDraftResponse);
  }),
  http.get(`*/api/v1/mutation-blocks/${MUTATION_ID}/draft/preview`, () =>
    HttpResponse.json(mutationPreview()),
  ),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  window.localStorage.clear();
  currentObjective = OBJECTIVE_CONTENT;
  currentMutation = MUTATION_CONTENT;
  savedPayloads = [];
  createdNames = [];
  completedDrafts = [];
  objectiveListing = objectiveIndex;
  mutationListing = mutationIndex;
  publishAttempts = 0;
});
afterAll(() => server.close());

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

/** A promise this test resolves by hand, so a read can be held open while the page renders. */
function heldOpen() {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

describe("block libraries", () => {
  // The card's title says what the list is (an objective block is what a scenario composes to assert), on the header line opposite the search.
  it("titles its card What a scenario can assert, opposite the search box", async () => {
    renderAt("/lab/objective-blocks");

    const box = await screen.findByRole("searchbox", { name: "Search the library" });
    const title = screen.getByRole("heading", { level: 2, name: "What a scenario can assert" });
    expect(title.parentElement).toContainElement(box);
  });

  // The title is the card's, not the rows': it is drawn while the listing is still on its way,
  // and only the search box, which could narrow nothing yet, waits for the rows.
  it("titles the card before the listing arrives, and holds the search box until it has", async () => {
    const { held, release } = heldOpen();
    server.use(
      http.get("*/api/v1/objective-blocks", async () => {
        await held;
        return HttpResponse.json(objectiveListing);
      }),
    );
    renderAt("/lab/objective-blocks");

    expect(await screen.findByText("Loading blocks…")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "What a scenario can assert" }),
    ).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();

    release();
    expect(await screen.findByRole("searchbox", { name: "Search the library" })).toBeVisible();
  });

  it("titles the mutation library's card Faults a scenario can inject", async () => {
    renderAt("/lab/mutation-blocks");

    const box = await screen.findByRole("searchbox", { name: "Search the library" });
    const title = screen.getByRole("heading", { level: 2, name: "Faults a scenario can inject" });
    expect(title.parentElement).toContainElement(box);
    expect(screen.queryByRole("heading", { name: "What a scenario can assert" })).toBeNull();
  });

  it("lists objective blocks with their type axis and publication state", async () => {
    renderAt("/lab/objective-blocks");

    expect(await screen.findByRole("heading", { name: "Objective blocks" })).toBeVisible();
    expect(screen.getByText("Shared across shops")).toBeVisible();
    expect(await screen.findByRole("link", { name: "read-required-document" })).toBeVisible();
    expect(screen.getByText("deterministic · event")).toBeVisible();
    expect(screen.getByText("v1 · 1 version")).toBeVisible();
    // The column a scenario's binding work is read from.
    expect(screen.getByText("1 bound same-shop")).toBeVisible();
  });

  it("shows a parameterless template as a legitimate design rather than a gap", async () => {
    renderAt("/lab/objective-blocks");

    const row = (await screen.findByRole("link", { name: "verify-before-disclosure" })).closest(
      "tr",
    );
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("—")).toBeVisible();
    expect(within(row as HTMLElement).getByText("Never published")).toBeVisible();
  });

  it("says Shared across shops in the neutral pill beside the title", async () => {
    renderAt("/lab/objective-blocks");

    await screen.findByRole("heading", { level: 1, name: "Objective blocks" });
    const pill = screen.getByText("Shared across shops");
    expect(pill.className).toBe(neutralPillClasses);
    expect(pill.firstElementChild).toHaveAttribute("aria-hidden");
    expect(pill.firstElementChild).toHaveTextContent("⇄");
  });

  it("says each block's publication in a pill: the version and how many, or Never published", async () => {
    renderAt("/lab/objective-blocks");

    const published = (await screen.findByRole("link", { name: "read-required-document" })).closest(
      "tr",
    ) as HTMLElement;
    const never = screen
      .getByRole("link", { name: "verify-before-disclosure" })
      .closest("tr") as HTMLElement;
    expectPublicationPill(published, "v1 · 1 version", "published");
    expectPublicationPill(never, "Never published", "never published");
  });

  /**
   * The chips the listing can count: All, Published and *Never published*, off
   * `latest_published_version`. The prototype's five domain chips are not drawn — the listing
   * carries no usage figure, and the kind only as the composed caption `type_label`.
   */
  it("counts the whole library on All, Published and Never published, and nothing else", async () => {
    renderAt("/lab/objective-blocks");
    await screen.findByRole("link", { name: "read-required-document" });

    const chips = within(screen.getByRole("group", { name: "Filter objective blocks" }));
    expect(chips.getAllByRole("button").map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "All 2",
      "Published 1",
      "Never published 1",
    ]);
  });

  it("narrows the library to the chip pressed, and the search leaves the counts where they were", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks");
    await screen.findByRole("link", { name: "read-required-document" });
    const chips = within(screen.getByRole("group", { name: "Filter objective blocks" }));

    await user.click(chips.getByRole("button", { name: "Never published 1" }));
    expect(screen.getByRole("link", { name: "verify-before-disclosure" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "read-required-document" })).toBeNull();

    await user.click(chips.getByRole("button", { name: "Published 1" }));
    expect(screen.getByRole("link", { name: "read-required-document" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "verify-before-disclosure" })).toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "Search the library" }), "verify");
    expect(screen.getByText("No objective block matches this view.")).toBeVisible();
    expect(chips.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(chips.getByRole("button", { name: "Published 1" })).toBeVisible();
  });

  it("counts the mutation library under its own name", async () => {
    renderAt("/lab/mutation-blocks");
    await screen.findByRole("link", { name: "concurrent-entity-mutation" });

    const chips = within(screen.getByRole("group", { name: "Filter mutation blocks" }));
    expect(chips.getByRole("button", { name: "All 1" })).toBeVisible();
    expect(chips.getByRole("button", { name: "Published 0" })).toBeVisible();
    expect(chips.getByRole("button", { name: "Never published 1" })).toBeVisible();
  });

  it("narrows the library to the blocks the word is in", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks");
    await screen.findByRole("link", { name: "read-required-document" });

    await user.type(screen.getByRole("searchbox", { name: "Search the library" }), "verify");

    expect(screen.getByRole("link", { name: "verify-before-disclosure" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "read-required-document" })).toBeNull();
  });

  it("leaves a sentence rather than a blank card when the word is in nothing", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks");
    await screen.findByRole("link", { name: "read-required-document" });

    await user.type(screen.getByRole("searchbox", { name: "Search the library" }), "no-such-block");

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No objective block matches this view.")).toBeVisible();
  });

  it("reaches both libraries from the lab's Library, which is where they are shared from", async () => {
    // They left the Scenarios nest with ADR 0054: a scenario composes them, but they belong to
    // no shop, and the rail they sat in was one shop's.
    renderAt("/lab/objective-blocks");

    await screen.findByRole("heading", { name: "Objective blocks" });
    const rail = within(screen.getByRole("navigation", { name: "Experiment lab workspace" }));
    expect(rail.getByRole("link", { name: "Objective blocks" })).toBeVisible();
    expect(rail.getByRole("link", { name: "Mutation blocks" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "All scenarios" })).not.toBeInTheDocument();
  });

  it("offers to show a reader around, on both libraries", async () => {
    // The vocabulary these two screens use is the lab's own — a template with open parameters
    // is not a thing a commerce admin has — so each library has a tour of its own (ADR 0045).
    const objectives = renderAt("/lab/objective-blocks");
    expect(
      await screen.findByRole("button", {
        name: `Show me around ${TOURS["objective-blocks"].surface}`,
      }),
    ).toBeVisible();
    // Every element that tour lights is on this page, exactly once. The same reading is swept
    // in a real browser by `tests/e2e/tour-anchors.spec.ts`; this is the cheap half of it.
    for (const step of TOURS["objective-blocks"].steps) {
      expect(document.querySelectorAll(step.anchor), step.anchor).toHaveLength(1);
    }
    objectives.unmount();

    const mutations = renderAt("/lab/mutation-blocks");
    expect(
      await screen.findByRole("button", {
        name: `Show me around ${TOURS["mutation-blocks"].surface}`,
      }),
    ).toBeVisible();
    mutations.unmount();
  });
});

describe("objective block editor", () => {
  it("goes back to Objective blocks from the ← above its title", async () => {
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await expectWayBack("Objective blocks", "/lab/objective-blocks", "objective block");
  });
  it("marks the parameter a scenario must resolve inside its own shop", async () => {
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    expect(await screen.findByRole("heading", { name: "read-required-document" })).toBeVisible();
    expect(screen.getByText("bound same-shop")).toBeVisible();
    expect(
      screen.getByText(/1 parameter\(s\) must be bound to objects in the scenario's own shop/),
    ).toBeVisible();
  });

  it("offers a default only for a parameter whose kind can carry one", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.click(screen.getByRole("button", { name: "Edit severity" }));
    expect(screen.getByLabelText("Default of severity")).toHaveValue("required");
    await user.click(screen.getByRole("button", { name: "Cancel editing severity" }));

    await user.click(screen.getByRole("button", { name: "Edit doc_ref" }));
    expect(screen.queryByLabelText("Default of doc_ref")).toBeNull();
    expect(screen.getByText(/a template\s+cannot default it/)).toBeVisible();
  });

  it("says beside its checkbox that an optional parameter has nothing to fall back on, and saves it", async () => {
    const user = userEvent.setup();
    const sentence =
      "severity is optional but has nothing to fall back on, so a scenario that omits it leaves the runtime with no value; give it a default";
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.click(screen.getByRole("button", { name: "Edit severity" }));
    const defaultOf = screen.getByLabelText("Default of severity");
    const row = within(screen.getByRole("form", { name: "Edit severity" }));
    const required = row.getByRole("checkbox", { name: "A scenario must bind this" });
    expect(screen.queryByText(sentence)).toBeNull();

    // Required with no default is the gate's own answer: nothing to say.
    await user.selectOptions(defaultOf, "");
    expect(screen.queryByText(sentence)).toBeNull();
    expect(required).not.toHaveAttribute("aria-invalid");

    // Optional with no default is `optional_parameter_without_default`, said under the checkbox.
    await user.click(required);
    const line = row.getByText(sentence);
    expect(line).toBeVisible();
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).not.toHaveAttribute("role", "alert");
    expect(required).toHaveAttribute("aria-invalid", "true");
    expect(required).toHaveAccessibleDescription(sentence);
    expect(defaultOf).toHaveAccessibleDescription(sentence);

    // A default clears it, and so would requiring the parameter again.
    await user.selectOptions(defaultOf, "expected");
    expect(screen.queryByText(sentence)).toBeNull();
    expect(required).not.toHaveAttribute("aria-invalid");
    await user.selectOptions(defaultOf, "");
    expect(row.getByText(sentence)).toBeVisible();
    await user.click(required);
    expect(screen.queryByText(sentence)).toBeNull();
    await user.click(required);

    // A finding, not a refusal: the row saves it, and the closed row goes on saying it.
    await user.click(row.getByRole("button", { name: "Save severity" }));
    expect(screen.getByText(sentence)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters[1]).toMatchObject({ name: "severity", required: false, default: null });
  });

  it("drops a default the new kind cannot carry when a parameter is retyped", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.click(screen.getByRole("button", { name: "Edit severity" }));
    await user.selectOptions(screen.getByLabelText("Kind of severity"), "entity_reference");

    // The field is gone rather than showing a value the publish gate would refuse.
    expect(screen.queryByLabelText("Default of severity")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save severity" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters[1].default).toBeNull();
    expect(parameters[1].kind).toBe("entity_reference");
  });

  it("moves the evidence with the assessment so the pairing always exists", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.selectOptions(screen.getByLabelText("Assessed by"), "judge");

    // A judge scores a rubric dimension and nothing else, so there is no evidence to pick.
    expect(screen.queryByLabelText("Evidence")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].assessment).toBe("judge");
    expect(savedPayloads[0].evidence).toBe("dimension");
  });

  it("adds a parameter in authored order and saves the whole payload", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    const form = screen.getByRole("form", { name: "Add a parameter" });
    await user.type(within(form).getByLabelText("Label"), "policy ref");
    expect(within(form).getByLabelText("Label")).toHaveAccessibleDescription(
      /saved as policy_ref/i,
    );
    await user.click(within(form).getByRole("button", { name: "Add parameter" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters.map((entry) => entry.name)).toEqual(["doc_ref", "severity", "policy_ref"]);
  });

  it("asks for a label, previews the identifier, and does not suggest typing doc_ref", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    const form = screen.getByRole("form", { name: "Add a parameter" });
    expect(within(form).getByLabelText("Label")).toHaveAttribute("placeholder", "Document");
    expect(within(form).queryByPlaceholderText("doc_ref")).toBeNull();

    await user.type(within(form).getByLabelText("Label"), "doc ref");
    expect(within(form).getByLabelText("Label")).toHaveAccessibleDescription(/saved as doc_ref_2/i);

    await user.clear(within(form).getByLabelText("Label"));
    await user.type(within(form).getByLabelText("Label"), "!!!");
    expect(within(form).getByLabelText("Label")).toHaveAccessibleDescription(/saved as parameter/i);
    await user.click(within(form).getByRole("button", { name: "Add parameter" }));
    await user.type(within(form).getByLabelText("Label"), "!!!");
    expect(within(form).getByLabelText("Label")).toHaveAccessibleDescription(
      /saved as parameter_2/i,
    );
  });

  it("reorders parameters, because order is what a scenario binds in", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.click(screen.getByRole("button", { name: "Move severity up" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters.map((entry) => entry.name)).toEqual(["severity", "doc_ref"]);
  });

  it("removes the parameter it asked about, from the draft as it stands, when a neighbour moves", async () => {
    const user = userEvent.setup();
    currentObjective = {
      ...OBJECTIVE_CONTENT,
      parameters: [
        ...OBJECTIVE_CONTENT.parameters,
        {
          name: "note",
          kind: "text",
          description: "A note.",
          required: false,
          default: "none",
          shop_bound: false,
        },
      ],
    };
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    // [doc_ref, severity, note]: arm the first, then move the last past the middle one.
    await user.click(screen.getByRole("button", { name: "Remove doc_ref" }));
    await user.click(screen.getByRole("button", { name: "Move note up" }));

    const confirm = screen.getByRole("group", { name: "Remove the parameter doc_ref?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove it" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    // The move made before the second press is kept: a removal acted on the draft as it was
    // at the first press would put `note` back after `severity`.
    expect(parameters.map((entry) => entry.name)).toEqual(["note", "severity"]);
  });

  it("publishes a clean draft and names the frozen version", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await publicationNotice()).toHaveTextContent(
      "Published version 1. A scenario binds this exact version.",
    );
    expect(publishAttempts).toBe(1);
  });

  it("refuses to publish edits that have not been saved", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.type(screen.getByLabelText("Statement"), " now");

    expectRefused(screen.getByRole("button", { name: "Publish v1" }), /Save the draft first/);
    expect(publishAttempts).toBe(0);
  });
});

describe("mutation block editor", () => {
  it("goes back to Mutation blocks from the ← above its title", async () => {
    renderAt(`/lab/mutation-blocks/${MUTATION_ID}`);

    await expectWayBack("Mutation blocks", "/lab/mutation-blocks", "mutation block");
  });
  it("shows why a mutation with no timing parameter cannot be published", async () => {
    renderAt(`/lab/mutation-blocks/${MUTATION_ID}`);

    expect(
      await screen.findByRole("heading", { name: "concurrent-entity-mutation" }),
    ).toBeVisible();
    expect(screen.getByText(/must declare a timing parameter/)).toBeVisible();
    expectRefused(
      screen.getByRole("button", { name: "Publish v1" }),
      /Resolve 2 error\(s\) to publish/,
    );
  });

  it("adds the timing parameter the gate asks for", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/mutation-blocks/${MUTATION_ID}`);

    await screen.findByRole("heading", { name: "concurrent-entity-mutation" });
    const form = screen.getByRole("form", { name: "Add a parameter" });
    await user.type(within(form).getByLabelText("Label"), "timing");
    await user.selectOptions(within(form).getByLabelText("Kind"), "timing");
    await user.click(within(form).getByRole("button", { name: "Add parameter" }));
    await user.click(screen.getByRole("button", { name: "Edit timing" }));
    await user.type(screen.getByLabelText("Default of timing"), "after_first_read");
    await user.click(screen.getByRole("button", { name: "Save timing" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters[1]).toMatchObject({
      name: "timing",
      kind: "timing",
      default: "after_first_read",
    });
  });

  it("carries its own type axis rather than the objective's", async () => {
    renderAt(`/lab/mutation-blocks/${MUTATION_ID}`);

    await screen.findByRole("heading", { name: "concurrent-entity-mutation" });
    expect(screen.getByLabelText("Perturbs")).toHaveValue("entity_mutation");
    expect(screen.queryByLabelText("Assessed by")).toBeNull();
  });
});

/**
 * Creating a template is a page, on the `CreatePage` layout with the parameter form the
 * editor already draws (PLAN-UX Slice 13).
 */
describe("the two create pages", () => {
  it("is reached from each index's own header, neither of which carries a create card", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks");

    await screen.findByRole("link", { name: "read-required-document" });
    expect(screen.queryByRole("region", { name: "New objective block" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "New objective block" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "New objective block" }),
    ).toBeVisible();
    expect(screen.getByText(/creating an objective block/)).toBeVisible();
  });

  it("derives the slug it will be saved under, and refuses Create until there is one", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks/new");

    const create = await screen.findByRole("button", { name: "Create block" });
    await waitFor(() =>
      expectRefused(create, "The template needs a name before it can be created."),
    );
    expect(create).toHaveAccessibleDescription(
      "The template needs a name before it can be created.",
    );

    await user.type(screen.getByLabelText("Name"), "Identify entity");

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/saved as identify-entity/i);
    expect(screen.getByRole("heading", { level: 1, name: "identify-entity" })).toBeVisible();
    expectNotRefused(create);
  });

  it("refuses a name this library already answers to, and says which", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks/new");

    await user.type(await screen.findByLabelText("Name"), "read required document");

    expect(screen.getByRole("button", { name: "Create block" })).toHaveAccessibleDescription(
      "read-required-document is the name of a template this library already holds.",
    );
  });

  it("creates under the derived slug alone when nothing else was answered", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks/new");

    await user.type(await screen.findByLabelText("Name"), "Identify entity");
    await user.click(screen.getByRole("button", { name: "Create block" }));

    await waitFor(() => expect(createdNames).toEqual(["identify-entity"]));
    // The contract creates a block with its name only, and the page asked for nothing the
    // create could not carry — so there is no second write and nothing was ever unsaved.
    await screen.findByRole("heading", { level: 1, name: "identify-entity" });
    expect(completedDrafts).toEqual([]);
  });

  it("carries the type axis and the parameters into the template, and lands in its editor", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks/new");

    await user.type(await screen.findByLabelText("Name"), "Identify entity");
    await user.selectOptions(screen.getByLabelText("Assessed by"), "judge");
    // A judged objective is scored on a rubric dimension, so the evidence follows rather
    // than being asked for.
    expect(screen.queryByLabelText("Evidence")).toBeNull();

    const addParameter = within(screen.getByRole("form", { name: "Add a parameter" }));
    await user.type(addParameter.getByLabelText("Label"), "doc_ref");
    await user.click(addParameter.getByRole("button", { name: "Add parameter" }));
    expect(screen.getByText("bound same-shop")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Create block" }));

    await waitFor(() => expect(completedDrafts).toHaveLength(1));
    expect(completedDrafts[0]).toMatchObject({
      name: "identify-entity",
      assessment: "judge",
      evidence: "dimension",
      parameters: [{ name: "doc_ref", kind: "document_reference" }],
    });
    expect(await screen.findByRole("heading", { level: 1, name: "identify-entity" })).toBeVisible();
  });

  it("refuses a ninth parameter with the cap, instead of going quiet", async () => {
    const user = userEvent.setup();
    renderAt("/lab/objective-blocks/new");

    await user.type(await screen.findByLabelText("Name"), "Identify entity");
    const addParameter = within(screen.getByRole("form", { name: "Add a parameter" }));
    for (let index = 1; index <= 8; index += 1) {
      await user.type(addParameter.getByLabelText("Label"), `p${index}`);
      await user.click(addParameter.getByRole("button", { name: "Add parameter" }));
    }

    const add = addParameter.getByRole("button", { name: "Add parameter" });
    expectRefused(add, "A template carries at most 8 parameters.");
    // Neither the press nor Enter in the label adds a ninth.
    await user.type(addParameter.getByLabelText("Label"), "p9{Enter}");
    await user.click(add);
    await submitWithoutPressing(add);
    expect(screen.getAllByRole("button", { name: /^Remove p\d$/ })).toHaveLength(8);
    expect(screen.queryByRole("button", { name: "Remove p9" })).toBeNull();
  });

  it("takes a parameter back off before anything is created", async () => {
    const user = userEvent.setup();
    renderAt("/lab/mutation-blocks/new");

    await user.type(await screen.findByLabelText("Name"), "tool timeout");
    const addParameter = within(screen.getByRole("form", { name: "Add a parameter" }));
    await user.type(addParameter.getByLabelText("Label"), "timing");
    await user.selectOptions(addParameter.getByLabelText("Kind"), "timing");
    await user.click(addParameter.getByRole("button", { name: "Add parameter" }));

    // A create page's parameter has no Edit — its description and default are the editor's —
    // and one press takes it off: ADR 0060 exempts a removal before Create is pressed.
    expect(screen.queryByRole("button", { name: "Edit timing" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove timing" }));
    expect(screen.queryByRole("group", { name: /Remove the parameter/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove timing" })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Perturbs"), "tool_fault");
    await user.click(screen.getByRole("button", { name: "Create block" }));

    await waitFor(() => expect(completedDrafts).toHaveLength(1));
    expect(completedDrafts[0]).toMatchObject({ effect: "tool_fault", parameters: [] });
  });

  it("does not refuse its own retry with the name it has already taken", async () => {
    // The listing is re-read the moment the block exists, so on a retry it holds this page's
    // own template: a create page counting that against the operator would refuse the second
    // press of the create that made it. The name is frozen instead, because it is what the
    // create request carried and the write that follows cannot move one.
    const user = userEvent.setup();
    let refuse = true;
    server.use(
      http.put(`*/api/v1/objective-blocks/${NEW_OBJECTIVE_ID}/draft`, async ({ request }) => {
        if (refuse) {
          refuse = false;
          return HttpResponse.error();
        }
        const body = (await request.json()) as { payload: Record<string, unknown> };
        completedDrafts.push(body.payload);
        return HttpResponse.json(
          draft(NEW_OBJECTIVE_ID, body.payload) as ObjectiveBlockDraftResponse,
        );
      }),
    );
    renderAt("/lab/objective-blocks/new");

    await user.type(await screen.findByLabelText("Name"), "Identify entity");
    const addParameter = within(screen.getByRole("form", { name: "Add a parameter" }));
    await user.type(addParameter.getByLabelText("Label"), "doc_ref");
    await user.click(addParameter.getByRole("button", { name: "Add parameter" }));
    await user.click(screen.getByRole("button", { name: "Create block" }));

    expect(
      await screen.findByText(/The block was created, but its template could not be saved/),
    ).toBeVisible();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    const create = screen.getByRole("button", { name: "Create block" });
    expectNotRefused(create);

    await user.click(create);

    await waitFor(() => expect(completedDrafts).toHaveLength(1));
    expect(createdNames).toEqual(["identify-entity"]);
  });

  it("stops saying nothing has been created the moment something has", async () => {
    // The chip is the page's statement about what it has written, and it has to be true on
    // the one-write path too — where the block exists while the navigation into its editor
    // is still on its way. The listing re-read is held open to stand in that interval.
    const user = userEvent.setup();
    const { held, release } = heldOpen();
    let reads = 0;
    server.use(
      http.get("*/api/v1/objective-blocks", async () => {
        reads += 1;
        if (reads > 1) {
          await held;
        }
        return HttpResponse.json(objectiveListing);
      }),
    );
    renderAt("/lab/objective-blocks/new");

    await user.type(await screen.findByLabelText("Name"), "Identify entity");
    expect(screen.getByText("nothing created yet")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Create block" }));

    expect(await screen.findByText("created")).toBeVisible();
    expect(screen.queryByText("nothing created yet")).toBeNull();

    release();
    expect(await screen.findByRole("heading", { level: 1, name: "identify-entity" })).toBeVisible();
    // And it stayed a one-write create throughout: nothing was owed, so nothing says so.
    expect(completedDrafts).toEqual([]);
  });

  it("puts the name hint in that control's accessible description on both libraries", async () => {
    const objectivesPage = renderAt("/lab/objective-blocks/new");
    expect(await screen.findByLabelText("Name")).toHaveAccessibleDescription(
      /saved as a lowercase slug.*binds this template/i,
    );
    objectivesPage.unmount();

    renderAt("/lab/mutation-blocks/new");
    expect(await screen.findByLabelText("Name")).toHaveAccessibleDescription(
      /saved as a lowercase slug.*binds this template/i,
    );
  });
});

/**
 * The rail's figure and this index are one listing, read once by the shell and handed to
 * both, so they cannot come to disagree (ADR 0056).
 */
describe("the rail's figures and the two libraries", () => {
  it.each([
    ["/lab/objective-blocks", "Objective blocks"],
    ["/lab/mutation-blocks", "Mutation blocks"],
  ])("says on the rail what %s has rows", async (path, label) => {
    renderAt(path);

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry(label, "Experiment lab workspace");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} block${rows === 1 ? "" : "s"}`);
  });

  it.each([
    ["/lab/objective-blocks/new", "Objective blocks", "2", "3"],
    ["/lab/mutation-blocks/new", "Mutation blocks", "1", "2"],
  ])(
    "moves %s's figure when a template is created, without a reload",
    async (path, label, before, after) => {
      // Created rather than compared: an agreement between two reads of one fixture is true
      // by construction, and what ADR 0056 asks of a create is that it re-reads the listing.
      const user = userEvent.setup();
      renderAt(path);

      await waitFor(() =>
        expect(
          within(railEntry(label, "Experiment lab workspace")).getByText(before),
        ).toBeVisible(),
      );

      await user.type(await screen.findByLabelText("Name"), "Identify entity");
      await user.click(screen.getByRole("button", { name: "Create block" }));

      await waitFor(() =>
        expect(within(railEntry(label, "Experiment lab workspace")).getByText(after)).toBeVisible(),
      );
    },
  );
});

describe("the block editor's side panel", () => {
  it("holds the gate, what uses the block and what publishing freezes, in that order, and no field", async () => {
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);

    const panel = sidePanel(await screen.findByRole("region", { name: "Publish gate" }));

    expect(panelCards(panel)).toEqual(["Publish gate", "Used by", "What publishing freezes"]);
    expect(panelFields(panel)).toEqual([]);
  });
});

/**
 * The block editor's sections on the reference pages' rows. The parameters stay a list with an
 * add form beneath it, whose stacked labels are an add form's (`ParameterForm`).
 */
describe("the block editor's rows", () => {
  it("draws the template's fields on rows, the statement's rule under its label", async () => {
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);
    const template = await screen.findByRole("region", { name: "Template" });

    for (const label of ["Name", "Statement", "Description"]) {
      expectFieldRow(within(template).getByLabelText(label), label);
    }
    expect(within(template).getByLabelText("Statement")).toHaveAccessibleDescription(
      /A scenario renders each bound instance as this statement followed by what it was bound to/,
    );
    expectCardOnRows(template);
  });

  it("asks how an objective is assessed on rows, and says under the choice what a judge scores", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);
    const assessment = await screen.findByRole("region", { name: "Assessment" });
    const assessedBy = within(assessment).getByLabelText("Assessed by");

    expectFieldRow(assessedBy, "Assessed by");
    expectFieldRow(within(assessment).getByLabelText("Evidence"), "Evidence");
    expectCardOnRows(assessment);
    expect(assessedBy).not.toHaveAccessibleDescription(/scored on a rubric dimension/);

    await user.selectOptions(assessedBy, "judge");
    expect(assessedBy).toHaveAccessibleDescription(
      /A judged objective is scored on a rubric dimension/,
    );
  });

  it("asks what a mutation perturbs on a row", async () => {
    renderAt(`/lab/mutation-blocks/${MUTATION_ID}`);
    const effect = await screen.findByRole("region", { name: "Effect" });

    expectFieldRow(within(effect).getByLabelText("Perturbs"), "Perturbs");
    expectCardOnRows(effect);
  });
});

/**
 * A template's parameters are a list on `EntryCard` (PLAN-UX Slice 33): a parameter opens where
 * it stands on its kind, description, default and whether a scenario must bind it; the arrows
 * stay on the row; *Add parameter* is the add form below it — both through `parameterEntry`.
 */
describe("a template's parameters", () => {
  async function openEditor() {
    renderAt(`/lab/objective-blocks/${OBJECTIVE_ID}`);
    await screen.findByRole("heading", { name: "read-required-document" });
    return within(screen.getByRole("region", { name: "Parameters" }));
  }

  it("reads a parameter back on its row and opens its fields in place", async () => {
    const user = userEvent.setup();
    const parameters = await openEditor();

    expect(parameters.queryByLabelText("Description of doc_ref")).toBeNull();
    expect(parameters.getByText("The shop document the arm has to read.")).toBeVisible();

    await user.click(parameters.getByRole("button", { name: "Edit doc_ref" }));

    const open = within(parameters.getByRole("form", { name: "Edit doc_ref" }));
    expect(open.getByLabelText("Kind of doc_ref")).toHaveValue("document_reference");
    expect(open.getByLabelText("Description of doc_ref")).toHaveValue(
      "The shop document the arm has to read.",
    );
    // The open row's arrows and Remove wait for Save or Cancel.
    expect(parameters.queryByRole("button", { name: "Move doc_ref down" })).toBeNull();
    expect(parameters.queryByRole("button", { name: "Remove doc_ref" })).toBeNull();
    expect(parameters.getByRole("button", { name: "Move severity up" })).toBeVisible();
  });

  it("saves a retyped parameter with exactly what the add form writes for the same kind", async () => {
    const user = userEvent.setup();
    const parameters = await openEditor();

    const add = within(parameters.getByRole("form", { name: "Add a parameter" }));
    await user.type(add.getByLabelText("Label"), "order");
    await user.selectOptions(add.getByLabelText("Kind"), "entity_reference");
    await user.click(add.getByRole("button", { name: "Add parameter" }));

    // `severity` is optional-capable and carries a default; as an entity reference it can
    // carry neither, and the builder says so the way the add form's does.
    await user.click(parameters.getByRole("button", { name: "Edit severity" }));
    const open = within(parameters.getByRole("form", { name: "Edit severity" }));
    await user.selectOptions(open.getByLabelText("Kind of severity"), "entity_reference");
    await user.clear(open.getByLabelText("Description of severity"));
    await user.click(open.getByRole("button", { name: "Save severity" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const [, edited, added] = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(edited.name).toBe("severity");
    expect(added.name).toBe("order");
    expect({ ...edited, name: null }).toEqual({ ...added, name: null });
    expect(added).toMatchObject({ shop_bound: true, required: true, default: null });
  });

  it("writes nothing on Cancel, and nothing typed in an open row reaches Save draft", async () => {
    const user = userEvent.setup();
    const parameters = await openEditor();

    await user.type(screen.getByLabelText("Statement"), " now");
    await user.click(parameters.getByRole("button", { name: "Edit doc_ref" }));
    await user.type(parameters.getByLabelText("Description of doc_ref"), " Typed, never saved.");

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const saved = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(saved[0].description).toBe("The shop document the arm has to read.");

    await user.click(parameters.getByRole("button", { name: "Cancel editing doc_ref" }));
    expect(parameters.getByText("The shop document the arm has to read.")).toBeVisible();
    expect(parameters.queryByText(/Typed, never saved/)).toBeNull();
  });

  it("holds one open row, and the other Edit says why it is disabled", async () => {
    const user = userEvent.setup();
    const parameters = await openEditor();

    await user.click(parameters.getByRole("button", { name: "Edit doc_ref" }));

    const sibling = parameters.getByRole("button", { name: "Edit severity" });
    expect(sibling).toBeDisabled();
    expect(sibling).toHaveAccessibleDescription(
      "Editing doc_ref. Save or Cancel before opening another row; nothing in the open row reaches the draft until you press Save.",
    );
  });

  it("removes a parameter only on the second press", async () => {
    const user = userEvent.setup();
    const parameters = await openEditor();

    await user.click(parameters.getByRole("button", { name: "Remove severity" }));
    const confirm = parameters.getByRole("group", { name: "Remove the parameter severity?" });
    expect(confirm).toHaveFocus();
    expect(parameters.queryByRole("button", { name: "Edit severity" })).toBeNull();

    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(parameters.getByRole("button", { name: "Remove severity" })).toHaveFocus();

    await user.click(parameters.getByRole("button", { name: "Remove severity" }));
    await user.click(
      within(parameters.getByRole("group", { name: "Remove the parameter severity?" })).getByRole(
        "button",
        { name: "Remove it" },
      ),
    );
    expect(parameters.getByText("Removed the parameter severity from the draft.")).toHaveFocus();
  });
});
