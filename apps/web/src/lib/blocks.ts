import type {
  BlockParameterKind,
  BlockParameterSchema,
  MutationBlockPayloadSchema,
  MutationEffect,
  ObjectiveAssessment,
  ObjectiveBlockPayloadSchema,
  ObjectiveEvidence,
} from "@agent-lab/contracts";
import { BLOCK_PARAMETER_KIND, optionsOf } from "./enumLabels";
import { PARAMETER_LABEL_RULE } from "./fieldRules";
import type { ItemRefusal } from "./itemForm";
import { pythonStrip } from "./pythonText";

/**
 * Client-side rules for authoring a block template.
 *
 * The editor holds only templates the lab would take, the same rule the order and ticket
 * editors follow: an author never sees a parameter row the backend would refuse, and the
 * shop-binding rule on screen is the one the backend derives rather than a second copy of it.
 */

export type BlockPayload = ObjectiveBlockPayloadSchema | MutationBlockPayloadSchema;

/** Mirrors `MAX_BLOCK_PARAMETERS`, so the form stops where the contract does. */
export const MAX_PARAMETERS = 8;

/** Mirrors the contract's `MAX_BLOCK_PARAMETERS` refusal, in the workspace's words. */
export const PARAMETERS_FULL = `A template carries at most ${MAX_PARAMETERS} parameters.`;

/**
 * Mirrors the backend's `MAX_SLUG_LENGTH`, minus room for a `_2` uniqueness suffix. A name
 * the contract would refuse must never reach the payload: the row offers no rename, so the
 * author's only recovery from a refused save would be to remove the parameter and retype it.
 */
const MAX_NAME_LENGTH = 60;

/** Mirrors `SHOP_BOUND_PARAMETER_KINDS`: what a scenario must resolve inside its own shop. */
const SHOP_BOUND_KINDS: readonly BlockParameterKind[] = [
  "document_reference",
  "entity_reference",
  "data_reference",
];

/** Mirrors `LITERAL_PARAMETER_KINDS`: the kinds a template may carry a default for. */
const LITERAL_KINDS: readonly BlockParameterKind[] = ["severity", "timing", "duration", "text"];

/**
 * The kinds a parameter may take, each explained on its own option row.
 *
 * The words come from the contract-held table in `enumLabels.ts`; this list is the shape the
 * picker reads them in, so a kind the contract gains cannot reach the select unnamed.
 */
export const PARAMETER_KINDS: readonly { kind: BlockParameterKind; label: string }[] = optionsOf(
  BLOCK_PARAMETER_KIND,
).map((entry) => ({ kind: entry.value, label: entry.option }));

/**
 * The three closed sets a template's type axis is chosen from, each option explained on its
 * own row.
 *
 * Here rather than on one screen because two screens ask: the editor, and the create page
 * each library gained in PLAN-UX Slice 13. They are not `enumLabels.ts` entries — that
 * module holds one `LabelMap` per contract union, keyed and swept, and these carry a
 * sentence of explanation on each option rather than a noun, which is what makes them the
 * picker's copy rather than the workspace's word for the value.
 */
export const ASSESSMENTS: readonly { value: ObjectiveAssessment; label: string }[] = [
  { value: "deterministic", label: "Deterministic — an encoded rule decides" },
  { value: "judge", label: "Judge — an LLM scores a rubric dimension" },
];

export const DETERMINISTIC_EVIDENCE: readonly { value: ObjectiveEvidence; label: string }[] = [
  { value: "event", label: "Event — a recorded tool call or read" },
  { value: "policy", label: "Policy — an encoded rule over state and events" },
  { value: "state", label: "State — the sandbox the run ended in" },
  { value: "forbidden", label: "Forbidden — something that must never occur" },
];

export const EFFECTS: readonly { value: MutationEffect; label: string }[] = [
  { value: "entity_mutation", label: "Entity mutation — an out-of-band write bumps a version" },
  { value: "tool_fault", label: "Tool fault — a tool fails or times out" },
  { value: "clock_shift", label: "Clock shift — sandbox time jumps forward" },
  { value: "service_outage", label: "Service outage — a dependency is unavailable" },
];

/**
 * A judged objective is scored on a rubric dimension and nothing else, so the evidence moves
 * with the assessment rather than leaving a pairing the publish gate refuses. Read by the
 * editor and by the create page, so the two cannot answer it differently.
 */
export function evidenceFor(
  assessment: ObjectiveAssessment,
  current: ObjectiveEvidence,
): ObjectiveEvidence {
  if (assessment === "judge") {
    return "dimension";
  }
  return current === "dimension" ? "event" : current;
}

export function bindsShopObject(kind: BlockParameterKind): boolean {
  return SHOP_BOUND_KINDS.includes(kind);
}

export function acceptsDefault(kind: BlockParameterKind): boolean {
  return LITERAL_KINDS.includes(kind);
}

/**
 * How a scenario binds a parameter, as its item says it. `check_bindings` (`domain/blocks.py`)
 * raises `binding_missing` only for a parameter that is required *and* has no default, whatever
 * its kind: a required parameter with a default may be left to it, and one that is not required
 * may be left unbound — a reference too, which an API-authored draft can hold.
 */
export function bindingSentence(
  parameter: Pick<BlockParameterSchema, "kind" | "required" | "default">,
): string {
  if (parameter.required && parameter.default === null) {
    return acceptsDefault(parameter.kind)
      ? "A scenario must bind this."
      : "Always bound by the scenario — a template cannot default an object.";
  }
  return parameter.default === null
    ? "A scenario may leave it unbound."
    : "A scenario may leave it to the default.";
}

export function shopBoundCount(payload: BlockPayload): number {
  return payload.parameters.filter((entry) => bindsShopObject(entry.kind)).length;
}

/** Strip combining marks so "Écoles" and "Ecoles" reduce to the same characters. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** A snake_case identifier derived from a typed label, so an author never has to spell one. */
export function toIdentifier(value: string, fallback = "parameter"): string {
  return (
    fold(value)
      .replace(/[^a-z0-9]+/g, "_")
      // A parameter name must start with a letter; a block slug may start with a digit, so
      // this trim belongs to the identifier path only.
      .replace(/^[^a-z]+/, "")
      .replace(/_+$/g, "")
      .slice(0, MAX_NAME_LENGTH)
      .replace(/_+$/g, "") || fallback
  );
}

/** A kebab-case block name. Unlike an identifier, the contract allows it to start with a digit. */
export function toSlug(value: string, fallback = "block"): string {
  return (
    fold(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_NAME_LENGTH)
      .replace(/-+$/g, "") || fallback
  );
}

export function uniqueParameterName(base: string, taken: readonly string[]): string {
  let candidate = base;
  let suffix = 2;
  while (taken.includes(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * A parameter's authored fields — everything but its name, which is derived once when it is
 * added and keys the entry from then on — as the add form and an open row both hold them.
 */
export interface ParameterFields {
  kind: BlockParameterKind;
  description: string;
  required: boolean;
  default: string | null;
}

export function parameterFields(parameter: BlockParameterSchema): ParameterFields {
  return {
    kind: parameter.kind,
    description: parameter.description,
    required: parameter.required,
    default: parameter.default,
  };
}

/**
 * What a parameter's fields become when its kind moves.
 *
 * A default the new kind cannot carry goes: otherwise the form would keep showing a default the
 * backend refuses with `reference_parameter_with_default`, and offer no way to clear it. And an
 * optional parameter with no default is a publish-gate error, so a kind that takes the default
 * away makes the parameter required again.
 */
export function retypedFields<FieldsT extends ParameterFields>(
  fields: FieldsT,
  kind: BlockParameterKind,
): FieldsT {
  const literal = acceptsDefault(kind);
  return {
    ...fields,
    kind,
    default: literal ? fields.default : null,
    required: literal ? fields.required : true,
  };
}

/**
 * The one function that turns a parameter's fields into the entry the template stores, called
 * by the add form (`addedParameter`) and by an open row's Save alike, so the two paths cannot
 * write different payloads. `shop_bound` is the server's echo of the kind and is derived here
 * rather than carried.
 *
 * The kind's rules (`retypedFields`) hold only where the kind is being chosen: on a new
 * parameter, and on a saved one whose kind moved. `saved` is the entry an open row was opened
 * on; while its kind is unchanged the fields are written as they stand, so a description edit
 * never rewrites what the draft already held — a draft authored through the API keeps its own
 * `required` and `default` until the author moves the kind, and the gate says what it thinks of
 * them meanwhile.
 */
export function parameterEntry(
  name: string,
  fields: ParameterFields,
  saved?: BlockParameterSchema,
): BlockParameterSchema {
  const held =
    saved !== undefined && saved.kind === fields.kind ? fields : retypedFields(fields, fields.kind);
  // Stored stripped as the lab strips them: `_require_text` refuses surrounding whitespace on
  // both, and a default of nothing but spaces is no default.
  const stripped = held.default === null ? "" : pythonStrip(held.default);
  return {
    name,
    kind: held.kind,
    description: pythonStrip(held.description),
    required: held.required,
    default: stripped === "" ? null : stripped,
    shop_bound: bindsShopObject(held.kind),
  };
}

/**
 * One more parameter on a list of them.
 *
 * The list rather than the payload, because the create page holds its parameters before
 * there is a payload to put them in: `/lab/objective-blocks/new` collects them, and the
 * `POST` that makes the block carries a name and nothing else (PLAN-UX Slice 13). The
 * payload-shaped helper below is this one with the payload rebuilt around it, so the create
 * page and the editor cannot come to disagree about what adding a parameter means.
 *
 * The add form asks the label and the kind; a new parameter is required, undescribed and
 * undefaulted until its row is opened.
 */
export function addedParameter(
  parameters: readonly BlockParameterSchema[],
  name: string,
  kind: BlockParameterKind,
): BlockParameterSchema[] {
  return withParameter(parameters, name, { kind, description: "", required: true, default: null });
}

/**
 * One more parameter on a list of them, with every field the editor's form asks: the label is
 * derived to an identifier no other parameter holds, and the fields go through `parameterEntry`
 * as a new parameter's do.
 */
export function withParameter(
  parameters: readonly BlockParameterSchema[],
  label: string,
  fields: ParameterFields,
): BlockParameterSchema[] {
  return [
    ...parameters,
    parameterEntry(
      uniqueParameterName(
        toIdentifier(label),
        parameters.map((entry) => entry.name),
      ),
      fields,
    ),
  ];
}

export function withoutParameter(
  parameters: readonly BlockParameterSchema[],
  name: string,
): BlockParameterSchema[] {
  return parameters.filter((entry) => entry.name !== name);
}

export function addParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
  kind: BlockParameterKind,
): PayloadT {
  return { ...payload, parameters: addedParameter(payload.parameters, name, kind) };
}

/** An open row's Save: the named parameter replaced where it stands, through `parameterEntry`. */
export function replaceParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
  fields: ParameterFields,
): PayloadT {
  return {
    ...payload,
    parameters: payload.parameters.map((entry) =>
      entry.name === name ? parameterEntry(name, fields, entry) : entry,
    ),
  };
}

export function removeParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
): PayloadT {
  return { ...payload, parameters: withoutParameter(payload.parameters, name) };
}

/** Moving a parameter is an authored change: order is what the editor and a binding follow. */
export function moveParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
  direction: -1 | 1,
): PayloadT {
  const index = payload.parameters.findIndex((entry) => entry.name === name);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= payload.parameters.length) {
    return payload;
  }
  const parameters = [...payload.parameters];
  const [moved] = parameters.splice(index, 1);
  parameters.splice(target, 0, moved);
  return { ...payload, parameters };
}

/**
 * What the editor's one parameter form holds (ADR 0074): the label it derives a new parameter's
 * identifier from, and the parameter's fields. While editing the label is the parameter's name,
 * shown and fixed, because a scenario binds by it.
 */
export interface ParameterFormFields extends ParameterFields {
  label: string;
}

export type ParameterFormField = keyof ParameterFormFields;

export const BLANK_PARAMETER: ParameterFormFields = {
  label: "",
  kind: "document_reference",
  description: "",
  required: true,
  default: null,
};

export function parameterFormFields(parameter: BlockParameterSchema): ParameterFormFields {
  return { label: parameter.name, ...parameterFields(parameter) };
}

/**
 * The form's refusal, adding only: the template's cap, which is about the list and marks no
 * field, then an empty label, which leaves nothing to derive an identifier from. An edit asks
 * nothing the lab would refuse — the label is fixed, the kind is a closed set, a description may
 * be empty, a default is optional — and the gate's `optional_parameter_without_default` is a
 * finding said under the checkbox, not a refusal (ADR 0063's lab amendment).
 */
export function parameterRefusal(
  fields: ParameterFormFields,
  count: number,
  editing: string | null,
): ItemRefusal<ParameterFormField> | null {
  if (editing !== null) {
    return null;
  }
  if (count >= MAX_PARAMETERS) {
    return { field: null, reason: PARAMETERS_FULL };
  }
  if (pythonStrip(fields.label) === "") {
    return { field: "label", reason: PARAMETER_LABEL_RULE };
  }
  return null;
}
