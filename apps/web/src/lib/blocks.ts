import type {
  BlockParameterKind,
  BlockParameterSchema,
  MutationBlockPayloadSchema,
  ObjectiveBlockPayloadSchema,
} from "@agent-lab/contracts";
import { BLOCK_PARAMETER_KIND, optionsOf } from "./enumLabels";

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

export function bindsShopObject(kind: BlockParameterKind): boolean {
  return SHOP_BOUND_KINDS.includes(kind);
}

export function acceptsDefault(kind: BlockParameterKind): boolean {
  return LITERAL_KINDS.includes(kind);
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

export function addParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
  kind: BlockParameterKind,
): PayloadT {
  const parameter: BlockParameterSchema = {
    name: uniqueParameterName(
      toIdentifier(name),
      payload.parameters.map((entry) => entry.name),
    ),
    kind,
    description: "",
    required: true,
    default: null,
    shop_bound: bindsShopObject(kind),
  };
  return { ...payload, parameters: [...payload.parameters, parameter] };
}

/**
 * Retyping a parameter drops a default the new kind cannot carry.
 *
 * Without this the editor would keep showing a default the backend refuses with
 * `reference_parameter_with_default`, and the author would read a finding about a value the
 * form no longer offers a way to clear.
 */
export function retypeParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
  kind: BlockParameterKind,
): PayloadT {
  return {
    ...payload,
    parameters: payload.parameters.map((entry) =>
      entry.name === name
        ? {
            ...entry,
            kind,
            shop_bound: bindsShopObject(kind),
            default: acceptsDefault(kind) ? entry.default : null,
            // An optional parameter with no default is a publish-gate error, and the
            // default is what just went away.
            required: acceptsDefault(kind) ? entry.required : true,
          }
        : entry,
    ),
  };
}

export function updateParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
  next: Partial<BlockParameterSchema>,
): PayloadT {
  return {
    ...payload,
    parameters: payload.parameters.map((entry) =>
      entry.name === name ? { ...entry, ...next } : entry,
    ),
  };
}

export function removeParameter<PayloadT extends BlockPayload>(
  payload: PayloadT,
  name: string,
): PayloadT {
  return { ...payload, parameters: payload.parameters.filter((entry) => entry.name !== name) };
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
