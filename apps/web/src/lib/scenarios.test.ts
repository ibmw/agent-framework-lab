import type {
  BlockParameterSchema,
  BoundObjectiveSchema,
  ScenarioBlockOptionSchema,
  ScenarioContentSchema,
  ScenarioResourcesSchema,
} from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  addObjective,
  bindableParameters,
  dataFieldsFor,
  documentKey,
  joinDataReference,
  moveObjective,
  parseTurnCap,
  readChecksByDocument,
  referenceChoices,
  retargetDataReference,
  splitDataReference,
  toggleContextDocument,
  toScenarioRequest,
  withBinding,
  withCurrentChoice,
} from "./scenarios";

const ORDER_ID = "2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42";
const PROFILE_ID = "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101";

function parameter(overrides: Partial<BlockParameterSchema> = {}): BlockParameterSchema {
  return {
    name: "doc_ref",
    kind: "document_reference",
    description: "The shop document the arm has to read.",
    required: true,
    default: null,
    shop_bound: true,
    ...overrides,
  };
}

const READ_TEMPLATE: ScenarioBlockOptionSchema = {
  block_id: "a1c31b6e-5f0d-4f1e-9b5a-2c4e6f8a0b11",
  name: "read-required-document",
  statement: "Read document",
  description: "Passes when the arm reads the bound document.",
  type_label: "deterministic · event",
  latest_published_version: 1,
  parameters: [
    parameter(),
    parameter({
      name: "severity",
      kind: "severity",
      description: "Whether missing the read fails the objective.",
      default: "expected",
      shop_bound: false,
    }),
  ],
};

const RESOURCES: ScenarioResourcesSchema = {
  documents: [
    {
      kind: "policy",
      document_id: "address-change",
      title: "Address-change policy",
      reference_value: "policy:address-change",
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
  product_handles: ["alpine-shell-jacket"],
  customers: [
    {
      profile_id: PROFILE_ID,
      display_name: "Maya Laurent",
      reference_value: `customer:${PROFILE_ID}`,
    },
  ],
  objective_blocks: [READ_TEMPLATE],
  mutation_blocks: [],
};

function content(overrides: Partial<ScenarioContentSchema> = {}): ScenarioContentSchema {
  return {
    name: "Wrong shipping address",
    ticket_id: "6b0f9c1e-49d1-4c9f-8b0c-1f6d1c2f9a01",
    context_documents: [{ kind: "policy", document_id: "address-change" }],
    objectives: [],
    mutations: [],
    hidden_facts: "",
    completion: { statement: "", max_turns: 12 },
    objective_count: 0,
    mutation_count: 0,
    ...overrides,
  };
}

describe("binding a template", () => {
  it("never offers a binding row for the severity a bound objective already declares", () => {
    expect(bindableParameters(READ_TEMPLATE).map((entry) => entry.name)).toEqual(["doc_ref"]);
  });

  it("starts a new objective at the severity its template defaults to", () => {
    const next = addObjective(content(), READ_TEMPLATE);

    expect(next.objectives).toHaveLength(1);
    expect(next.objectives[0].severity).toBe("expected");
    expect(next.objectives[0].id).toBe("read-required-document");
    // A reference parameter carries no default, so nothing is pre-bound.
    expect(next.objectives[0].bindings).toEqual([]);
  });

  it("keeps two bindings of one template apart by their own identifiers", () => {
    const twice = addObjective(addObjective(content(), READ_TEMPLATE), READ_TEMPLATE);

    expect(twice.objectives.map((objective) => objective.id)).toEqual([
      "read-required-document",
      "read-required-document-2",
    ]);
  });

  it("drops a binding when its picker is cleared rather than writing an empty one", () => {
    const objective: BoundObjectiveSchema = {
      id: "read-the-policy",
      block_id: READ_TEMPLATE.block_id,
      severity: "required",
      bindings: [{ parameter: "doc_ref", value: "policy:address-change" }],
    };

    expect(withBinding(objective, "doc_ref", "").bindings).toEqual([]);
  });

  it("keeps bindings ordered by parameter, matching what the lab stores", () => {
    const objective: BoundObjectiveSchema = {
      id: "read-the-policy",
      block_id: READ_TEMPLATE.block_id,
      severity: "required",
      bindings: [{ parameter: "z_last", value: "x" }],
    };

    expect(withBinding(objective, "a_first", "y").bindings.map((entry) => entry.parameter)).toEqual(
      ["a_first", "z_last"],
    );
  });
});

describe("what a picker may offer", () => {
  it("offers a document by its title and the value the backend resolves", () => {
    expect(referenceChoices(parameter(), RESOURCES)).toEqual([
      { value: "policy:address-change", label: "Address-change policy — shop policy" },
    ]);
  });

  it("offers every kind of entity the shop holds", () => {
    const choices = referenceChoices(parameter({ kind: "entity_reference" }), RESOURCES);

    expect(choices.map((choice) => choice.value)).toEqual([
      `order:${ORDER_ID}`,
      `customer:${PROFILE_ID}`,
      "product:alpine-shell-jacket",
    ]);
  });

  it("clears a data reference outright when its object is cleared", () => {
    // `#shipping_address` is truthy, so an unguarded join would be stored as a binding no
    // control on screen can display and the publish gate refuses.
    expect(joinDataReference("", "shipping_address")).toBe("");
    expect(retargetDataReference("", "shipping_address")).toBe("");
  });

  it("drops a field the newly bound object has no answer for", () => {
    expect(retargetDataReference(`customer:${PROFILE_ID}`, "shipping_address")).toBe(
      `customer:${PROFILE_ID}`,
    );
    expect(retargetDataReference(`order:${ORDER_ID}`, "shipping_address")).toBe(
      `order:${ORDER_ID}#shipping_address`,
    );
  });

  it("offers a bound value the list does not name, so a select never reads as unbound", () => {
    const listed = withCurrentChoice(
      [{ value: "after_first_read", label: "After the first read" }],
      "at_turn:5",
    );

    expect(listed.map((choice) => choice.value)).toEqual(["after_first_read", "at_turn:5"]);
    // Nothing is appended for a value the list already names, or for no value at all.
    expect(withCurrentChoice(listed, "at_turn:5")).toHaveLength(2);
    expect(withCurrentChoice(listed, "")).toHaveLength(2);
  });

  it("splits a data reference into the entity that must resolve and the field it names", () => {
    expect(splitDataReference(`order:${ORDER_ID}#shipping_address`)).toEqual({
      entity: `order:${ORDER_ID}`,
      field: "shipping_address",
    });
    expect(joinDataReference(`order:${ORDER_ID}`, "shipping_address")).toBe(
      `order:${ORDER_ID}#shipping_address`,
    );
    expect(dataFieldsFor(`order:${ORDER_ID}`)).toContain("shipping_address");
    expect(dataFieldsFor("")).toEqual([]);
  });
});

describe("the scenario itself", () => {
  it("reports which objectives read each context document", () => {
    const composed = content({
      objectives: [
        {
          id: "read-the-policy",
          block_id: READ_TEMPLATE.block_id,
          severity: "required",
          bindings: [{ parameter: "doc_ref", value: "policy:address-change" }],
        },
      ],
    });

    expect(readChecksByDocument(composed, [READ_TEMPLATE])).toEqual(
      new Map([["policy:address-change", [1]]]),
    );
  });

  it("toggles a context document on and off by its key", () => {
    const document = { kind: "policy", document_id: "address-change" } as const;

    const off = toggleContextDocument(content(), document);
    expect(off.context_documents).toEqual([]);
    expect(toggleContextDocument(off, document).context_documents).toEqual([document]);
    expect(documentKey(document)).toBe("policy:address-change");
  });

  it("reorders objectives, because order is their priority", () => {
    const composed = addObjective(addObjective(content(), READ_TEMPLATE), READ_TEMPLATE);

    const moved = moveObjective(composed, "read-required-document-2", -1);

    expect(moved.objectives.map((objective) => objective.id)).toEqual([
      "read-required-document-2",
      "read-required-document",
    ]);
    // A move past either end is a no-op rather than a reordering.
    expect(moveObjective(moved, "read-required-document-2", -1).objectives[0].id).toBe(
      "read-required-document-2",
    );
  });

  it("leaves the turn cap alone while the field holds nothing a cap could be", () => {
    // A cleared field must not snap the draft to the minimum mid-retype.
    expect(parseTurnCap("")).toBeNull();
    expect(parseTurnCap("20")).toBe(20);
    // What is committed is clamped to the range the contract accepts.
    expect(parseTurnCap("0")).toBe(1);
    expect(parseTurnCap("999")).toBe(100);
  });

  it("sends the scenario without the ticket or the counts the response derives", () => {
    const request = toScenarioRequest(content({ objective_count: 3 }));

    expect(Object.keys(request.payload).sort()).toEqual([
      "completion",
      "context_documents",
      "hidden_facts",
      "mutations",
      "name",
      "objectives",
    ]);
  });
});
