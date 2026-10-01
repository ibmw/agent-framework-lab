import type {
  AttributeSchema,
  MediaReferenceSchema,
  OptionSchema,
  ReviewSchema,
} from "@agent-lab/contracts";
import { isSlug } from "./entryIds";
import {
  ATTRIBUTE_BOOLEAN_RULE,
  ATTRIBUTE_LABEL_RULE,
  ATTRIBUTE_MEASUREMENT_RULE,
  ATTRIBUTE_NEEDS_CHOICE,
  ATTRIBUTE_NUMBER_RULE,
  ATTRIBUTE_UNIT_RULE,
  ATTRIBUTE_VALUE_AMONG_CHOICES_RULE,
  ATTRIBUTE_VALUE_RULE,
  alreadyTakenMessage,
  ENTRY_KEY_RULE,
  MEDIA_ALT_TEXT_RULE,
  MEDIA_NEEDS_REFERENCE,
  OPTION_NAME_RULE,
  OPTION_NEEDS_VALUE,
  REVIEW_AUTHOR_RULE,
  REVIEW_BODY_RULE,
} from "./fieldRules";
import type { ItemRefusal } from "./itemForm";
import { pythonStrip } from "./pythonText";

/**
 * A product's four lists as the forms below them hold them (ADR 0074): options, media
 * references, typed attributes and reviews. Each has one builder, called by the form's Add and
 * its *Save changes* alike, and one refusal, the first rule the form breaks in the order its
 * fields ask.
 *
 * Where an entry has an identifier of its own — an option key, an attribute key, a review ID —
 * it is the builder's first argument: derived once, when the entry is added, and handed back
 * unchanged by an edit. A media reference has none: its key *is* its reference, which is why it
 * is the one key the form still asks while editing.
 */

const blank = (value: string) => pythonStrip(value) === "";

/** Completes `alreadyTakenMessage` for an option or attribute key the product already holds. */
export const KEY_TAKEN_PLACE = "in the draft";

/** Completes `alreadyTakenMessage` for a reference another media entry of the product holds. */
export const MEDIA_TAKEN_PLACE = "a media reference of this product";

/**
 * A key the form asks while adding: a slug no other entry of the list holds. Once the entry is
 * added the key is fixed, so an edit asks nothing of it.
 */
function keyRefusal(key: string, taken: readonly string[]): string | null {
  if (!isSlug(key)) {
    return ENTRY_KEY_RULE;
  }
  return taken.includes(key) ? alreadyTakenMessage(key, KEY_TAKEN_PLACE) : null;
}

// Options -------------------------------------------------------------------------------------

export interface OptionFields {
  name: string;
  key: string;
  values: string[];
}

export type OptionField = keyof OptionFields;

export const BLANK_OPTION: OptionFields = { name: "", key: "", values: [] };

export function optionFields(option: OptionSchema): OptionFields {
  return { name: option.name, key: option.key, values: option.values };
}

/**
 * The name, the key while adding, then the values: a variant chooses one value of each option
 * (`OptionDefinition` refuses an option with none).
 */
export function optionRefusal(
  fields: OptionFields,
  taken: readonly string[],
  editing: string | null,
): ItemRefusal<OptionField> | null {
  if (blank(fields.name)) {
    return { field: "name", reason: OPTION_NAME_RULE };
  }
  const key = editing === null ? keyRefusal(fields.key, taken) : null;
  if (key !== null) {
    return { field: "key", reason: key };
  }
  if (fields.values.length === 0) {
    return { field: "values", reason: OPTION_NEEDS_VALUE };
  }
  return null;
}

export function optionEntry(key: string, fields: OptionFields): OptionSchema {
  return { key, name: pythonStrip(fields.name), values: fields.values };
}

// Media references ----------------------------------------------------------------------------

export interface MediaFields {
  reference: string;
  altText: string;
}

export type MediaField = keyof MediaFields;

export const BLANK_MEDIA: MediaFields = { reference: "", altText: "" };

export function mediaFields(entry: MediaReferenceSchema): MediaFields {
  return { reference: entry.reference, altText: entry.alt_text };
}

/**
 * The reference — present, and held by no other entry — then the alt text. `editing` is the
 * reference the form was opened on, which its own entry holds and so never collides with.
 */
export function mediaRefusal(
  fields: MediaFields,
  taken: readonly string[],
  editing: string | null,
): ItemRefusal<MediaField> | null {
  const reference = pythonStrip(fields.reference);
  if (reference === "") {
    return { field: "reference", reason: MEDIA_NEEDS_REFERENCE };
  }
  if (reference !== editing && taken.includes(reference)) {
    return { field: "reference", reason: alreadyTakenMessage(reference, MEDIA_TAKEN_PLACE) };
  }
  if (blank(fields.altText)) {
    return { field: "altText", reason: MEDIA_ALT_TEXT_RULE };
  }
  return null;
}

export function mediaEntry(fields: MediaFields): MediaReferenceSchema {
  return { reference: pythonStrip(fields.reference), alt_text: pythonStrip(fields.altText) };
}

// Typed attributes ----------------------------------------------------------------------------

export interface AttributeFields {
  label: string;
  key: string;
  attributeType: AttributeSchema["attribute_type"];
  value: string;
  unit: string;
  choices: string[];
}

export type AttributeField = keyof AttributeFields;

export const BLANK_ATTRIBUTE: AttributeFields = {
  label: "",
  key: "",
  attributeType: "text",
  value: "",
  unit: "",
  choices: [],
};

export function attributeFields(entry: AttributeSchema): AttributeFields {
  return {
    label: entry.label,
    key: entry.key,
    attributeType: entry.attribute_type,
    value: entry.value,
    unit: entry.unit ?? "",
    choices: entry.choices,
  };
}

/**
 * Text `Decimal` reads as a finite number (`require_decimal_text`). Narrower than Python's
 * reader, which also takes digit-grouping underscores: the form refuses what the lab might
 * accept rather than letting through what it would not.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * The label, the key while adding, the value, then what the type brings with it: a number or a
 * measurement's value is a decimal, a yes-or-no's is `true` or `false`, a measurement has its
 * unit, and a choice has its choices with the value among them — the rules `TypedAttribute`
 * holds the entry to, in the order the form asks its fields.
 */
export function attributeRefusal(
  fields: AttributeFields,
  taken: readonly string[],
  editing: string | null,
): ItemRefusal<AttributeField> | null {
  if (blank(fields.label)) {
    return { field: "label", reason: ATTRIBUTE_LABEL_RULE };
  }
  const key = editing === null ? keyRefusal(fields.key, taken) : null;
  if (key !== null) {
    return { field: "key", reason: key };
  }
  const value = pythonStrip(fields.value);
  if (value === "") {
    return { field: "value", reason: ATTRIBUTE_VALUE_RULE };
  }
  const type = fields.attributeType;
  if (type === "number" && !DECIMAL.test(value)) {
    return { field: "value", reason: ATTRIBUTE_NUMBER_RULE };
  }
  if (type === "measurement" && !DECIMAL.test(value)) {
    return { field: "value", reason: ATTRIBUTE_MEASUREMENT_RULE };
  }
  if (type === "boolean" && value !== "true" && value !== "false") {
    return { field: "value", reason: ATTRIBUTE_BOOLEAN_RULE };
  }
  if (type === "measurement" && blank(fields.unit)) {
    return { field: "unit", reason: ATTRIBUTE_UNIT_RULE };
  }
  if (type === "choice" && fields.choices.length === 0) {
    return { field: "choices", reason: ATTRIBUTE_NEEDS_CHOICE };
  }
  if (type === "choice" && !fields.choices.includes(value)) {
    return { field: "choices", reason: ATTRIBUTE_VALUE_AMONG_CHOICES_RULE };
  }
  return null;
}

export function attributeEntry(key: string, fields: AttributeFields): AttributeSchema {
  return {
    key,
    label: pythonStrip(fields.label),
    attribute_type: fields.attributeType,
    value: pythonStrip(fields.value),
    // A unit belongs to a measurement and choices to a choice; anything else the form was
    // holding when the type moved is not part of the entry either path writes.
    unit: fields.attributeType === "measurement" ? pythonStrip(fields.unit) : null,
    choices: fields.attributeType === "choice" ? fields.choices : [],
  };
}

// Reviews -------------------------------------------------------------------------------------

export interface ReviewFields {
  author: string;
  rating: number;
  body: string;
}

export type ReviewField = keyof ReviewFields;

/** Five stars, the default the add form has always opened on: there is no "no rating". */
export const BLANK_REVIEW: ReviewFields = { author: "", rating: 5, body: "" };

export function reviewFields(review: ReviewSchema): ReviewFields {
  return { author: review.author_display_name, rating: review.rating, body: review.body };
}

/** The author, then the body; the rating is one of five stars and cannot be missing. */
export function reviewRefusal(fields: ReviewFields): ItemRefusal<ReviewField> | null {
  if (blank(fields.author)) {
    return { field: "author", reason: REVIEW_AUTHOR_RULE };
  }
  if (blank(fields.body)) {
    return { field: "body", reason: REVIEW_BODY_RULE };
  }
  return null;
}

export function reviewEntry(id: string, fields: ReviewFields): ReviewSchema {
  return {
    id,
    author_display_name: pythonStrip(fields.author),
    rating: fields.rating,
    body: pythonStrip(fields.body),
  };
}
