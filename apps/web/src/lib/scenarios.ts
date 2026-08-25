import type {
  BlockParameterSchema,
  BoundMutationSchema,
  BoundObjectiveSchema,
  ContextDocumentSchema,
  ReplaceScenarioDraftRequest,
  ScenarioBindingSchema,
  ScenarioBlockOptionSchema,
  ScenarioContentSchema,
  ScenarioResourcesSchema,
  ShopDocumentKind,
} from "@agent-lab/contracts";
import { slugify, uniqueId } from "./entryIds";

/**
 * Client-side rules for composing a scenario.
 *
 * The editor holds only recipes the lab would take, the same rule the order, ticket, and
 * block editors follow. Two of those rules matter most here, and both mirror a backend rule
 * rather than inventing a second one:
 *
 * - **A severity parameter is never bound.** An objective's severity is a field of the
 *   instance, so the editor renders no binding row for a `severity` parameter — a row it did
 *   render would produce the `objective_binds_severity` finding on save.
 * - **A shop-bound parameter is picked, never typed.** The value grammar
 *   (`policy:address-change`, `order:<id>`) is the backend's; the editor offers the shop's
 *   own objects and writes the value, so an author cannot spell one wrong.
 */

/** Mirrors `MAX_CONTEXT_DOCUMENTS`, `MAX_SCENARIO_OBJECTIVES`, and `MAX_SCENARIO_MUTATIONS`. */
export const MAX_CONTEXT_DOCUMENTS = 12;
export const MAX_OBJECTIVES = 24;
export const MAX_MUTATIONS = 8;

/** Mirrors `MIN_COMPLETION_TURNS` and `MAX_COMPLETION_TURNS`. */
export const MIN_TURN_CAP = 1;
export const MAX_TURN_CAP = 100;

/**
 * Read a typed turn cap, or null while the field holds nothing a cap could be.
 *
 * Returning null rather than a fallback is what lets the editor leave the draft alone
 * mid-edit: clearing the field to retype it must not snap the cap to the minimum. Committing
 * on every *parseable* keystroke rather than on blur is deliberate — a value committed on
 * blur would race the Save click that caused the blur, and the click would freeze the value
 * from before it.
 */
export function parseTurnCap(typed: string): number | null {
  const parsed = Number.parseInt(typed, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.min(Math.max(parsed, MIN_TURN_CAP), MAX_TURN_CAP);
}

const DOCUMENT_LABELS: Record<ShopDocumentKind, string> = {
  policy: "shop policy",
  support_guideline: "support guideline",
  faq_entry: "FAQ entry",
};

/** Which shop tool reads each collection, as frame 4 labels a context document. */
const DOCUMENT_TOOLS: Record<ShopDocumentKind, string> = {
  policy: "get_policies",
  support_guideline: "get_support_guidelines",
  faq_entry: "get_faq",
};

/**
 * Deliberately not named `documentKindLabel`: `lib/tickets.ts` already exports one with
 * shorter copy for a context panel, and two same-named helpers over the same enum are a
 * wrong import waiting to happen.
 */
export function documentCollectionLabel(kind: ShopDocumentKind): string {
  return DOCUMENT_LABELS[kind];
}

export function documentToolName(kind: ShopDocumentKind): string {
  return DOCUMENT_TOOLS[kind];
}

export function documentKey(document: { kind: ShopDocumentKind; document_id: string }): string {
  return `${document.kind}:${document.document_id}`;
}

/**
 * A severity parameter carries no binding row: the instance's own severity is what resolves
 * it, and a second authored copy could contradict the first.
 */
export function isBindable(parameter: BlockParameterSchema): boolean {
  return parameter.kind !== "severity";
}

export function bindableParameters(
  option: ScenarioBlockOptionSchema | undefined,
): BlockParameterSchema[] {
  return (option?.parameters ?? []).filter(isBindable);
}

export function findOption(
  options: readonly ScenarioBlockOptionSchema[],
  blockId: string,
): ScenarioBlockOptionSchema | undefined {
  return options.find((option) => option.block_id === blockId);
}

/** The value the pickers offer for one shop-bound parameter kind. */
export interface ReferenceChoice {
  value: string;
  label: string;
}

export function referenceChoices(
  parameter: BlockParameterSchema,
  resources: ScenarioResourcesSchema,
): ReferenceChoice[] {
  if (parameter.kind === "document_reference") {
    return resources.documents.map((document) => ({
      value: document.reference_value,
      label: `${document.title} — ${documentCollectionLabel(document.kind)}`,
    }));
  }
  if (parameter.kind === "entity_reference") {
    return [
      ...resources.orders.map((order) => ({
        value: order.reference_value,
        label: `Order ${order.reference} — ${order.payment_status}, ${order.fulfilment_status}`,
      })),
      ...resources.customers.map((customer) => ({
        value: customer.reference_value,
        label: `Customer ${customer.display_name}`,
      })),
      ...resources.product_handles.map((handle) => ({
        value: `product:${handle}`,
        label: `Product ${handle}`,
      })),
    ];
  }
  if (parameter.kind === "data_reference") {
    // A data reference is an entity plus a field, so the picker offers the entity and the
    // field is appended below it. The entity half is what has to resolve in this shop.
    return referenceChoices({ ...parameter, kind: "entity_reference" }, resources);
  }
  return [];
}

/** Mirrors `DATA_FIELDS`: what the sandbox can resolve on each kind of entity. */
const DATA_FIELDS: Record<string, readonly string[]> = {
  order: ["shipping_address", "line_items", "payment", "total", "events"],
  customer: ["email", "phone", "address_book", "account"],
  product: ["price", "availability", "variants"],
};

export function dataFieldsFor(entityValue: string): readonly string[] {
  return DATA_FIELDS[entityValue.split(":")[0]] ?? [];
}

export function splitDataReference(value: string): { entity: string; field: string } {
  const separator = value.lastIndexOf("#");
  return separator === -1
    ? { entity: value, field: "" }
    : { entity: value.slice(0, separator), field: value.slice(separator + 1) };
}

export function joinDataReference(entity: string, field: string): string {
  // A field with no object is not a reference at all. Without this guard, clearing the object
  // picker would build `#shipping_address` — a truthy string `withBinding` would store, that
  // no control on screen displays, and that the publish gate refuses with a finding an author
  // cannot connect to anything.
  if (!entity) {
    return "";
  }
  return field ? `${entity}#${field}` : entity;
}

/**
 * Move a data reference to another object, dropping a field the new one has no answer for.
 *
 * The backend resolves the entity half and then checks the field against `DATA_FIELDS`, so
 * the editor never builds a pair it would refuse: an order's `shipping_address` does not
 * survive a switch to a customer. The same rule the ticket editor's `retargetOrigin` follows.
 */
export function retargetDataReference(entity: string, field: string): string {
  return joinDataReference(entity, dataFieldsFor(entity).includes(field) ? field : "");
}

/**
 * The timing forms the runtime can observe, as frame 4b states them.
 *
 * A convenience list, not the contract: the backend accepts any `at_turn:<n>` and any ISO
 * offset. `withCurrentChoice` is what keeps a controlled select honest about a value this
 * list does not happen to name.
 */
export const TIMING_CHOICES: readonly ReferenceChoice[] = [
  { value: "after_first_read", label: "After the agent's first read" },
  { value: "at_turn:2", label: "At turn 2" },
  { value: "at_turn:3", label: "At turn 3" },
  { value: "at_offset:PT30S", label: "30 seconds into the run" },
  { value: "at_offset:PT5M", label: "5 minutes into the run" },
];

/**
 * Offer the bound value even when the list does not name it.
 *
 * A controlled `<select>` whose value matches no option renders as unselected, so a draft
 * holding `at_turn:5` would read as unbound and the first interaction would silently replace
 * it. Appending the value keeps the control showing what the scenario actually holds.
 */
export function withCurrentChoice(
  choices: readonly ReferenceChoice[],
  value: string,
): ReferenceChoice[] {
  if (!value || choices.some((choice) => choice.value === value)) {
    return [...choices];
  }
  return [...choices, { value, label: `${value} — currently bound` }];
}

function bindingValue(bindings: readonly ScenarioBindingSchema[], parameter: string): string {
  return bindings.find((binding) => binding.parameter === parameter)?.value ?? "";
}

export function boundValue(
  instance: BoundObjectiveSchema | BoundMutationSchema,
  parameter: string,
): string {
  return bindingValue(instance.bindings, parameter);
}

/**
 * Set one binding, dropping it when the value is cleared.
 *
 * An empty binding is a publish-gate error (`binding_empty`), and "not bound yet" is the
 * state a draft is legitimately in, so clearing a picker removes the entry rather than
 * writing an empty one the gate would then refuse.
 */
export function withBinding<InstanceT extends BoundObjectiveSchema | BoundMutationSchema>(
  instance: InstanceT,
  parameter: string,
  value: string,
): InstanceT {
  const others = instance.bindings.filter((binding) => binding.parameter !== parameter);
  const bindings = value ? [...others, { parameter, value }] : others;
  return {
    ...instance,
    bindings: [...bindings].sort((left, right) => left.parameter.localeCompare(right.parameter)),
  };
}

/**
 * Start a bound instance with every default its template carries.
 *
 * A reference parameter never has one — a template may not default an object it does not own
 * — so this fills in the literals only, which is exactly what the template author meant them
 * for.
 */
export function bindTemplate(
  option: ScenarioBlockOptionSchema,
  taken: readonly string[],
): { id: string; block_id: string; bindings: ScenarioBindingSchema[] } {
  return {
    id: uniqueId(slugify(option.name, "block"), taken),
    block_id: option.block_id,
    bindings: bindableParameters(option)
      .filter((parameter) => parameter.default)
      .map((parameter) => ({ parameter: parameter.name, value: parameter.default as string })),
  };
}

export function addObjective(
  content: ScenarioContentSchema,
  option: ScenarioBlockOptionSchema,
): ScenarioContentSchema {
  const taken = content.objectives.map((objective) => objective.id);
  const severity = option.parameters.find((parameter) => parameter.kind === "severity");
  return {
    ...content,
    objectives: [
      ...content.objectives,
      {
        ...bindTemplate(option, taken),
        // The template's severity default is what an author meant a new binding to start at.
        severity: severity?.default === "expected" ? "expected" : "required",
      },
    ],
  };
}

export function addMutation(
  content: ScenarioContentSchema,
  option: ScenarioBlockOptionSchema,
): ScenarioContentSchema {
  const taken = content.mutations.map((mutation) => mutation.id);
  return { ...content, mutations: [...content.mutations, bindTemplate(option, taken)] };
}

export function updateObjective(
  content: ScenarioContentSchema,
  id: string,
  next: BoundObjectiveSchema,
): ScenarioContentSchema {
  return {
    ...content,
    objectives: content.objectives.map((objective) => (objective.id === id ? next : objective)),
  };
}

export function updateMutation(
  content: ScenarioContentSchema,
  id: string,
  next: BoundMutationSchema,
): ScenarioContentSchema {
  return {
    ...content,
    mutations: content.mutations.map((mutation) => (mutation.id === id ? next : mutation)),
  };
}

export function removeObjective(content: ScenarioContentSchema, id: string): ScenarioContentSchema {
  return {
    ...content,
    objectives: content.objectives.filter((objective) => objective.id !== id),
  };
}

export function removeMutation(content: ScenarioContentSchema, id: string): ScenarioContentSchema {
  return { ...content, mutations: content.mutations.filter((mutation) => mutation.id !== id) };
}

function move<EntryT extends { id: string }>(
  entries: readonly EntryT[],
  id: string,
  direction: -1 | 1,
): EntryT[] {
  const index = entries.findIndex((entry) => entry.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= entries.length) {
    return [...entries];
  }
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Objective order is priority and mutation order is the run timeline: both are content. */
export function moveObjective(
  content: ScenarioContentSchema,
  id: string,
  direction: -1 | 1,
): ScenarioContentSchema {
  return { ...content, objectives: move(content.objectives, id, direction) };
}

export function moveMutation(
  content: ScenarioContentSchema,
  id: string,
  direction: -1 | 1,
): ScenarioContentSchema {
  return { ...content, mutations: move(content.mutations, id, direction) };
}

export function toggleContextDocument(
  content: ScenarioContentSchema,
  document: ContextDocumentSchema,
): ScenarioContentSchema {
  const key = documentKey(document);
  const listed = content.context_documents.some((entry) => documentKey(entry) === key);
  return {
    ...content,
    context_documents: listed
      ? content.context_documents.filter((entry) => documentKey(entry) !== key)
      : [...content.context_documents, document],
  };
}

/**
 * Which objectives read each context document, as frame 4 shows beside it.
 *
 * Derived from the bindings rather than stored: the binding is where the scenario actually
 * names the document, and a second list would drift from it.
 */
export function readChecksByDocument(
  content: ScenarioContentSchema,
  options: readonly ScenarioBlockOptionSchema[],
): Map<string, number[]> {
  const readers = new Map<string, number[]>();
  content.objectives.forEach((objective, index) => {
    const option = findOption(options, objective.block_id);
    for (const binding of objective.bindings) {
      const parameter = option?.parameters.find((entry) => entry.name === binding.parameter);
      if (parameter?.kind !== "document_reference") {
        continue;
      }
      readers.set(binding.value, [...(readers.get(binding.value) ?? []), index + 1]);
    }
  });
  return readers;
}

/**
 * The draft a client sends carries the recipe's own prose and *selections* for everything
 * else; the ticket is fixed at creation and deliberately absent from the wire, as are the
 * derived counts the response computes.
 */
export function toScenarioRequest(content: ScenarioContentSchema): ReplaceScenarioDraftRequest {
  return {
    payload: {
      name: content.name,
      context_documents: content.context_documents,
      objectives: content.objectives,
      mutations: content.mutations,
      hidden_facts: content.hidden_facts,
      completion: content.completion,
    },
  };
}
