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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

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

let currentObjective = OBJECTIVE_CONTENT;
let currentMutation = MUTATION_CONTENT;
let savedPayloads: Array<Record<string, unknown>> = [];
let createdNames: string[] = [];
let publishAttempts = 0;

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

  http.get("*/api/v1/objective-blocks", () => HttpResponse.json(objectiveIndex)),
  http.post("*/api/v1/objective-blocks", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    createdNames.push(body.name);
    return HttpResponse.json(draft(OBJECTIVE_ID, currentObjective), { status: 201 });
  }),
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

  http.get("*/api/v1/mutation-blocks", () => HttpResponse.json(mutationIndex)),
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
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentObjective = OBJECTIVE_CONTENT;
  currentMutation = MUTATION_CONTENT;
  savedPayloads = [];
  createdNames = [];
  publishAttempts = 0;
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("block libraries", () => {
  it("lists objective blocks with their type axis and publication state", async () => {
    renderAt(`/shops/${SHOP_ID}/objective-blocks`);

    expect(await screen.findByRole("heading", { name: "Objective blocks" })).toBeVisible();
    expect(screen.getByText("Shared across shops")).toBeVisible();
    expect(await screen.findByRole("link", { name: "read-required-document" })).toBeVisible();
    expect(screen.getByText("deterministic · event")).toBeVisible();
    expect(screen.getByText("v1 · 1 version(s)")).toBeVisible();
    // The column a scenario's binding work is read from.
    expect(screen.getByText("1 bound same-shop")).toBeVisible();
  });

  it("shows a parameterless template as a legitimate design rather than a gap", async () => {
    renderAt(`/shops/${SHOP_ID}/objective-blocks`);

    const row = (await screen.findByRole("link", { name: "verify-before-disclosure" })).closest(
      "tr",
    );
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("—")).toBeVisible();
    expect(within(row as HTMLElement).getByText("Draft")).toBeVisible();
  });

  it("creates a block under a slug derived from what the author typed", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/objective-blocks`);

    await screen.findByRole("heading", { name: "Objective blocks" });
    await user.type(screen.getByLabelText("Name"), "Identify entity");
    expect(screen.getByText("identify-entity")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create block" }));

    await waitFor(() => expect(createdNames).toEqual(["identify-entity"]));
  });

  it("reaches both libraries from the Scenarios section of the rail", async () => {
    renderAt(`/shops/${SHOP_ID}/objective-blocks`);

    await screen.findByRole("heading", { name: "Objective blocks" });
    expect(screen.getByRole("link", { name: "Objective blocks" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Mutation blocks" })).toBeVisible();
    // The scenario editor itself is still ahead of this slice, so its two entries stay inert.
    expect(
      screen.getAllByTitle("Arrives with Milestone 2").map((entry) => entry.textContent),
    ).toEqual(["Scenariossoon", "All scenariossoon"]);
  });
});

describe("objective block editor", () => {
  it("marks the parameter a scenario must resolve inside its own shop", async () => {
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

    expect(await screen.findByRole("heading", { name: "read-required-document" })).toBeVisible();
    expect(screen.getByText("bound same-shop")).toBeVisible();
    expect(
      screen.getByText(/1 parameter\(s\) must be bound to objects in the scenario's own shop/),
    ).toBeVisible();
  });

  it("offers a default only for a parameter whose kind can carry one", async () => {
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    expect(screen.getByLabelText("Default of severity")).toHaveValue("required");
    expect(screen.queryByLabelText("Default of doc_ref")).toBeNull();
    expect(screen.getByText(/a template\s+cannot default it/)).toBeVisible();
  });

  it("drops a default the new kind cannot carry when a parameter is retyped", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.selectOptions(screen.getByLabelText("Kind of severity"), "entity_reference");

    // The field is gone rather than showing a value the publish gate would refuse.
    expect(screen.queryByLabelText("Default of severity")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters[1].default).toBeNull();
    expect(parameters[1].kind).toBe("entity_reference");
  });

  it("moves the evidence with the assessment so the pairing always exists", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

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
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    const form = screen.getByRole("form", { name: "Add a parameter" });
    await user.type(within(form).getByLabelText("Parameter name"), "policy ref");
    await user.click(within(form).getByRole("button", { name: "Add parameter" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters.map((entry) => entry.name)).toEqual(["doc_ref", "severity", "policy_ref"]);
  });

  it("reorders parameters, because order is what a scenario binds in", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.click(screen.getByRole("button", { name: "Move severity up" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const parameters = savedPayloads[0].parameters as Array<Record<string, unknown>>;
    expect(parameters.map((entry) => entry.name)).toEqual(["severity", "doc_ref"]);
  });

  it("publishes a clean draft and names the frozen version", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Published version 1. A scenario binds this exact version.",
    );
    expect(publishAttempts).toBe(1);
  });

  it("refuses to publish edits that have not been saved", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/objective-blocks/${OBJECTIVE_ID}`);

    await screen.findByRole("heading", { name: "read-required-document" });
    await user.type(screen.getByLabelText("Statement"), " now");

    expect(screen.getByRole("button", { name: "Publish v1" })).toBeDisabled();
    expect(publishAttempts).toBe(0);
  });
});

describe("mutation block editor", () => {
  it("shows why a mutation with no timing parameter cannot be published", async () => {
    renderAt(`/shops/${SHOP_ID}/mutation-blocks/${MUTATION_ID}`);

    expect(
      await screen.findByRole("heading", { name: "concurrent-entity-mutation" }),
    ).toBeVisible();
    expect(screen.getByText(/must declare a timing parameter/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish v1" })).toBeDisabled();
  });

  it("adds the timing parameter the gate asks for", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/mutation-blocks/${MUTATION_ID}`);

    await screen.findByRole("heading", { name: "concurrent-entity-mutation" });
    const form = screen.getByRole("form", { name: "Add a parameter" });
    await user.type(within(form).getByLabelText("Parameter name"), "timing");
    await user.selectOptions(within(form).getByLabelText("Kind"), "timing");
    await user.click(within(form).getByRole("button", { name: "Add parameter" }));
    await user.type(screen.getByLabelText("Default of timing"), "after_first_read");
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
    renderAt(`/shops/${SHOP_ID}/mutation-blocks/${MUTATION_ID}`);

    await screen.findByRole("heading", { name: "concurrent-entity-mutation" });
    expect(screen.getByLabelText("Perturbs")).toHaveValue("entity_mutation");
    expect(screen.queryByLabelText("Assessed by")).toBeNull();
  });
});
