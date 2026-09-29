import type {
  AttributeSchema,
  BackgroundKind,
  BlockParameterKind,
  ComparisonDimension,
  ExperimentHistoryEntrySchema,
  FulfilmentStatus,
  JudgeEvidenceScope,
  ObjectiveSeverity,
  OrderEventKind,
  PaymentMethodSchema,
  PaymentStatus,
  PolicySchema,
  ProductSchema,
  SandboxPinSchema,
  ShopDocumentKind,
  SupportChannel,
  SupportPermission,
  TicketAuthor,
  TicketOriginKind,
  TicketStatus,
  ToolOutcome,
  VariantSchema,
} from "@agent-lab/contracts";
// `Currency` is a union `openapi.yaml` publishes like the others; the contracts package
// re-exports schemas one at a time and does not name this one, so `lib/currencies.ts`
// spells it off `ShopContentSchema` and this table is keyed on that.
import type { Currency } from "./currencies";

/**
 * The closed sets the workspace reads, in the words an operator reads them in.
 *
 * One module rather than one table per surface. Two things make that the right place. The
 * first is that these vocabularies are not domain-shaped: `SupportPermission` is read by the
 * identity editor *and* by the agent editor's tool bindings, `DefinitionType` by snapshots,
 * the bench and results, and neither belongs to any one page's module. The second is the
 * sweep in `enumLabels.test.ts`, which is only exhaustive if there is one list for it to be
 * exhaustive over: a map added to a page's own module is a map nothing holds to the contract.
 *
 * Every map below is typed `Record<Union, EnumLabel>` over the *contract's* union, so a
 * member added to `openapi.yaml` and regenerated fails the typecheck here, and the sweep
 * then names the enum and the member it has no words for. Nothing in this module decides
 * anything — each entry is a spelling of a value the payload already carries.
 *
 * The domain modules that already published a label function — `orders.ts`, `tickets.ts` —
 * keep publishing it and read its table from here, so their call sites are unchanged.
 *
 * Not yet every closed set in the workspace: the tables that pre-date this module are listed
 * in `docs/history/design-direction.md` under *Revision — enum labels and the status pill*,
 * with the rule that each moves here as the slice that next touches its surface moves it.
 */

/**
 * A value's name, and — where a control has to explain the choice — what choosing it means.
 *
 * The explanation is written only where an operator could reasonably pick wrong: a
 * permission grants something, an evidence scope changes the question a judge is asked. A
 * closed set whose members explain themselves ("Card", "Wallet", "Draft") carries no second
 * sentence, because a hint that says nothing teaches a reader to skip the ones that do.
 *
 * An explanation that states a rule must be the lab's own rule, carried from the code that
 * applies it — a sentence invented here would teach a constraint the run will not honour.
 * It is a lowercase clause, so that `optionText` can compose it onto its label as one line.
 */
export type EnumLabel = {
  readonly label: string;
  readonly explanation?: string;
};

/** A map from every member of one contract union to the words this workspace reads it in. */
export type LabelMap<Value extends string> = Readonly<Record<Value, EnumLabel>>;

/** One value's name, on its own — a table cell, a chip, a sentence. */
export function labelOf<Value extends string>(map: LabelMap<Value>, value: Value): string {
  return map[value].label;
}

/**
 * One option row: the value, its name, and the "label — explanation" text a select shows.
 *
 * The two-part form is the scenario editor's, carried here so that every explained select in
 * the workspace spells the explanation the same way. `option` falls back to the bare label
 * where a member has nothing to add, so a caller never has to ask which kind of map it holds.
 */
export function optionsOf<Value extends string>(
  map: LabelMap<Value>,
): { value: Value; label: string; option: string }[] {
  return (Object.keys(map) as Value[]).map((value) => ({
    value,
    label: map[value].label,
    option: optionText(map[value]),
  }));
}

/** The "label — explanation" spelling, for a control that renders one entry rather than a list. */
export function optionText(entry: EnumLabel): string {
  return entry.explanation === undefined ? entry.label : `${entry.label} — ${entry.explanation}`;
}

/**
 * One value's name where the *payload* types the field as a free string.
 *
 * `ResolvedDefinitionSchema.definition_type` is the case this exists for: the experiment
 * payload carries a definition type as `string` rather than as the `DefinitionType` union
 * the snapshot payload uses, so the map cannot be indexed by the field's own type. A value
 * outside the union is rendered as itself rather than as invented words — the vocabulary is
 * the backend's, and the same rule `describeFailure` in `evidence.ts` follows.
 */
export function describeValue<Value extends string>(map: LabelMap<Value>, value: string): string {
  return (map as Readonly<Record<string, EnumLabel | undefined>>)[value]?.label ?? value;
}

/** Every member of one contract union, in the order this module writes them. */
export function membersOf<Value extends string>(map: LabelMap<Value>): Value[] {
  return Object.keys(map) as Value[];
}

/**
 * No explanation: the lab attaches no behaviour to a product's status beyond validating the
 * value, so any sentence here would be a rule this application invented. The three words say
 * what they mean, which is the condition the header above puts on a second sentence.
 */
export const PRODUCT_STATUS: LabelMap<ProductSchema["status"]> = {
  draft: { label: "Draft" },
  active: { label: "Active" },
  archived: { label: "Archived" },
};

export const VARIANT_AVAILABILITY: LabelMap<VariantSchema["availability"]> = {
  in_stock: { label: "In stock" },
  backorder: { label: "On backorder" },
  out_of_stock: { label: "Out of stock" },
  discontinued: { label: "Discontinued" },
};

export const ATTRIBUTE_TYPE: LabelMap<AttributeSchema["attribute_type"]> = {
  text: { label: "Text" },
  number: { label: "Number" },
  boolean: { label: "Yes or no" },
  choice: { label: "Choice" },
  measurement: { label: "Measurement" },
};

export const PAYMENT_METHOD_KIND: LabelMap<PaymentMethodSchema["kind"]> = {
  card: { label: "Card" },
  wallet: { label: "Wallet" },
  bank_transfer: { label: "Bank transfer" },
  gift_card: { label: "Gift card" },
};

export const POLICY_KIND: LabelMap<PolicySchema["kind"]> = {
  returns: { label: "Returns" },
  shipping: { label: "Shipping" },
  cancellation: { label: "Cancellation" },
  privacy: { label: "Privacy" },
  warranty: { label: "Warranty" },
  terms: { label: "Terms" },
};

/**
 * The currencies a shop may sell in, named for a reader who knows the money but not the code.
 *
 * In the domain's own order — `Currency` in `domain/shop.py` is "the ten most traded, in that
 * order" — because the checkbox group renders the table as it stands and that order is the
 * lab's, not an alphabetisation of it.
 *
 * No explanation: a currency is the name of a currency, and the rule an operator needs here is
 * about the *set* they tick rather than about any one member, so it is the group's hint.
 *
 * Whether a shop sells in one currency or four is content the operator authors; nothing in the
 * lab prefers a member of this list, so nothing here is a default.
 */
export const CURRENCY: LabelMap<Currency> = {
  USD: { label: "US dollar" },
  EUR: { label: "Euro" },
  JPY: { label: "Japanese yen" },
  GBP: { label: "Pound sterling" },
  CNY: { label: "Renminbi" },
  AUD: { label: "Australian dollar" },
  CAD: { label: "Canadian dollar" },
  CHF: { label: "Swiss franc" },
  HKD: { label: "Hong Kong dollar" },
  SGD: { label: "Singapore dollar" },
};

export const SUPPORT_CHANNEL: LabelMap<SupportChannel> = {
  chat: { label: "Chat" },
  email: { label: "Email" },
  phone: { label: "Phone" },
};

/**
 * What each permission lets a support agent do.
 *
 * Every one carries its explanation: a checkbox that grants an ability is the one control in
 * the workspace where "what does ticking this do" has to be answered on the control itself.
 *
 * Each sentence is the lab's own, not this application's, and every clause that states a rule
 * names the code that applies it:
 *
 * - the four reads say what the read tools in `application/sandbox_tool_contracts.py` say
 *   they return, and state no rule;
 * - `change_shipping_address` is the refusal `AddressChangeRefusalCode.ORDER_ALREADY_SHIPPED`
 *   raises in `domain/address_change.py`;
 * - `cancel_order` is the one rule `Order.cancel` enforces in `domain/entities.py`, reached
 *   through the cancel tool in `application/order_actions.py`;
 * - `apply_discount` repeats why `domain/support_identity.py` keeps it out of
 *   `ORDER_MUTATION_PERMISSIONS` — a catalog offer, not an edit to an order;
 * - `escalate_to_human` names the target an identity's `EscalationPolicy` must declare;
 * - `issue_refund` is the wording PLAN-UX Slice 3 dictates, and the lab enforces nothing
 *   about refunds.
 *
 * Nothing here may state a rule no code applies.
 */
export const SUPPORT_PERMISSION: LabelMap<SupportPermission> = {
  read_catalog: { label: "Read catalog", explanation: "look up products, variants and prices" },
  read_customer: {
    label: "Read customer",
    explanation: "look up the customer's profile and addresses",
  },
  read_orders: { label: "Read orders", explanation: "look up this customer's orders" },
  read_policies: {
    label: "Read policies",
    explanation: "read the shop's policies, guidelines and FAQ",
  },
  cancel_order: { label: "Cancel order", explanation: "cancel an order the customer has paid for" },
  change_shipping_address: {
    label: "Change shipping address",
    explanation: "redirect an order that has not shipped",
  },
  issue_refund: { label: "Issue refund", explanation: "refund an order in full or part" },
  apply_discount: {
    label: "Apply discount",
    explanation: "offer a discount on the catalog, not on an order already placed",
  },
  escalate_to_human: {
    label: "Escalate to human",
    explanation: "hand the incident to the escalation target this identity names",
  },
};

export const BACKGROUND_KIND: LabelMap<BackgroundKind> = {
  purchase: { label: "Purchase" },
  support_contact: { label: "Support contact" },
  account_event: { label: "Account event" },
  life_event: { label: "Life event" },
};

/**
 * What each evidence scope shows the judge, from the docstrings on `JudgeEvidenceScope` in
 * `apps/api/src/capability_lab/domain/judge.py`, in this table's own lowercase-clause style
 * so that `optionText` can compose them like every other explained set.
 */
export const JUDGE_EVIDENCE_SCOPE: LabelMap<JudgeEvidenceScope> = {
  customer_turns: {
    label: "Customer turns",
    explanation: "what the customer said to this arm, in the order it was said",
  },
  agent_replies: {
    label: "Agent replies",
    explanation:
      "what this arm answered; without it the judge scores what the arm did, not what it said",
  },
  tool_calls: {
    label: "Tool calls",
    explanation: "which tools the arm called, with what arguments, and how each answered",
  },
  state_changes: {
    label: "State changes",
    explanation: "which calls moved this arm's world",
  },
};

export const DEFINITION_TYPE: LabelMap<SandboxPinSchema["definition_type"]> = {
  shop: { label: "Shop" },
  customer_profile: { label: "Customer profile" },
  support_identity: { label: "Support identity" },
  ticket: { label: "Ticket" },
  scenario: { label: "Scenario" },
  objective_block: { label: "Objective block" },
  mutation_block: { label: "Mutation block" },
  agent_configuration: { label: "Agent configuration" },
  judge_configuration: { label: "Judge configuration" },
};

export const TOOL_OUTCOME: LabelMap<ToolOutcome> = {
  success: { label: "Success" },
  refused: { label: "Refused" },
  failed: { label: "Failed" },
};

export const PAYMENT_STATUS: LabelMap<PaymentStatus> = {
  pending: { label: "Pending" },
  authorized: { label: "Authorized" },
  paid: { label: "Paid" },
  refunded: { label: "Refunded" },
};

export const FULFILMENT_STATUS: LabelMap<FulfilmentStatus> = {
  unfulfilled: { label: "Unfulfilled" },
  partially_fulfilled: { label: "Partially fulfilled" },
  fulfilled: { label: "Fulfilled" },
};

export const ORDER_EVENT_KIND: LabelMap<OrderEventKind> = {
  placed: { label: "Placed" },
  payment_authorized: { label: "Payment authorized" },
  payment_captured: { label: "Payment captured" },
  payment_refunded: { label: "Payment refunded" },
  shipped: { label: "Shipped" },
  delivered: { label: "Delivered" },
  address_updated: { label: "Address updated" },
  support_contact: { label: "Support contact" },
};

export const TICKET_STATUS: LabelMap<TicketStatus> = {
  open: { label: "Open" },
  resolved: { label: "Resolved" },
};

/**
 * Where an incident was opened from, spelled for the middle of a sentence.
 *
 * "from order page" is how the ticket header reads it, so these stay lowercase where the
 * statuses above are capitalized: the case belongs to the position the word is written in.
 */
export const TICKET_ORIGIN_KIND: LabelMap<TicketOriginKind> = {
  product_page: { label: "product page" },
  order_page: { label: "order page" },
  checkout: { label: "checkout" },
  faq: { label: "FAQ" },
  support_entry: { label: "support entry" },
};

/**
 * Where an experiment stands, as History's status chips and pills read it.
 *
 * Keyed on `ExperimentHistoryEntrySchema["status"]` because the contracts package names no
 * `ExperimentStatus` type — the union `openapi.yaml` publishes under that name, as `Currency`
 * is spelled off the schema that carries it. The sweep looks it up by that name.
 */
export const EXPERIMENT_STATUS: LabelMap<ExperimentHistoryEntrySchema["status"]> = {
  running: { label: "Running" },
  completed: { label: "Completed" },
  failed: { label: "Failed" },
};

export const TICKET_AUTHOR: LabelMap<TicketAuthor> = {
  customer: { label: "Customer" },
  support_agent: { label: "Past support agent" },
};

/**
 * Also mid-sentence: "suggested policy", "suggested FAQ".
 *
 * The one union in this tree with a second table: `DOCUMENT_LABELS` in `lib/scenarios.ts`
 * spells the same three at length for the scenario editor's context documents. The lengths
 * are deliberate and the design-direction list names the exception; merging them means
 * deciding which length each surface is owed, not deleting one.
 */
export const SHOP_DOCUMENT_KIND: LabelMap<ShopDocumentKind> = {
  policy: { label: "policy" },
  support_guideline: { label: "guideline" },
  faq_entry: { label: "FAQ" },
};

/**
 * The dimensions two arms can differ along, as the comparison copy reads them.
 *
 * Lowercase, because every surface writes them inside a sentence the page owns — "changed
 * tone of voice", "support identity differs" — rather than as a heading of their own.
 */
export const COMPARISON_DIMENSION: LabelMap<ComparisonDimension> = {
  framework: { label: "framework" },
  architecture: { label: "architecture" },
  model: { label: "model" },
  prompt: { label: "prompt" },
  tools: { label: "tools" },
  support_identity: { label: "support identity" },
  tone_of_voice: { label: "tone of voice" },
};

export const OBJECTIVE_SEVERITY: LabelMap<ObjectiveSeverity> = {
  required: { label: "Required", explanation: "the objective fails when missed" },
  expected: { label: "Expected", explanation: "a visible warning, without failing the run" },
};

export const BLOCK_PARAMETER_KIND: LabelMap<BlockParameterKind> = {
  document_reference: {
    label: "Document",
    explanation: "a shop policy, guideline, or FAQ entry",
  },
  entity_reference: { label: "Entity", explanation: "an order, customer, or product" },
  data_reference: { label: "Data", explanation: "a named field of a shop object" },
  tool_reference: { label: "Tool", explanation: "a versioned tool the lab exposes" },
  severity: { label: "Severity", explanation: "required or expected" },
  timing: { label: "Timing", explanation: "when a mutation fires" },
  duration: { label: "Duration", explanation: "a span of sandbox time" },
  text: { label: "Text", explanation: "free authored text" },
};

/**
 * Every map above, under the contract schema name it spells.
 *
 * The key is the name as `openapi.yaml` publishes it, because that is what the sweep looks
 * the members up by: a registry keyed on anything else could pass while describing a union
 * that no longer exists. Adding a map means adding it here — and `enumLabels.test.ts` reads
 * this module's own exports back to prove that every `LabelMap` it publishes is in this
 * table, so a map left out of it is a test failure rather than a map nothing sweeps.
 */
export const ENUM_LABELS = {
  AttributeType: ATTRIBUTE_TYPE,
  BackgroundKind: BACKGROUND_KIND,
  BlockParameterKind: BLOCK_PARAMETER_KIND,
  ComparisonDimension: COMPARISON_DIMENSION,
  Currency: CURRENCY,
  DefinitionType: DEFINITION_TYPE,
  ExperimentStatus: EXPERIMENT_STATUS,
  FulfilmentStatus: FULFILMENT_STATUS,
  JudgeEvidenceScope: JUDGE_EVIDENCE_SCOPE,
  ObjectiveSeverity: OBJECTIVE_SEVERITY,
  OrderEventKind: ORDER_EVENT_KIND,
  PaymentMethodKind: PAYMENT_METHOD_KIND,
  PaymentStatus: PAYMENT_STATUS,
  PolicyKind: POLICY_KIND,
  ProductStatus: PRODUCT_STATUS,
  ShopDocumentKind: SHOP_DOCUMENT_KIND,
  SupportChannel: SUPPORT_CHANNEL,
  SupportPermission: SUPPORT_PERMISSION,
  TicketAuthor: TICKET_AUTHOR,
  TicketOriginKind: TICKET_ORIGIN_KIND,
  TicketStatus: TICKET_STATUS,
  ToolOutcome: TOOL_OUTCOME,
  VariantAvailability: VARIANT_AVAILABILITY,
} as const satisfies Record<string, LabelMap<string>>;

export type LabelledEnum = keyof typeof ENUM_LABELS;

export const LABELLED_ENUMS = Object.keys(ENUM_LABELS) as LabelledEnum[];
