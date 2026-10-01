import type { GuidanceNoteSchema } from "@agent-lab/contracts";
import { GUIDANCE_BODY_RULE, GUIDANCE_TITLE_RULE } from "./fieldRules";
import type { ItemRefusal } from "./itemForm";
import { pythonStrip } from "./pythonText";

/**
 * A support identity's guidance notes as the form below *Guidance* holds them (ADR 0074): one
 * builder, called by the form's Add and its *Save changes* alike, and one refusal, the first
 * rule the form breaks in the order its fields ask.
 */
export interface GuidanceFields {
  title: string;
  body: string;
}

export type GuidanceField = keyof GuidanceFields;

/** The form's fields in the order it asks them, which is the order its rules are said in. */
export const GUIDANCE_FORM_FIELDS: readonly GuidanceField[] = ["title", "body"];

export const BLANK_GUIDANCE: GuidanceFields = { title: "", body: "" };

export function guidanceFields(note: GuidanceNoteSchema): GuidanceFields {
  return { title: note.title, body: note.body };
}

const RULES: Record<GuidanceField, string> = {
  title: GUIDANCE_TITLE_RULE,
  body: GUIDANCE_BODY_RULE,
};

/**
 * The first field left empty or only spaces, in the form's order: `GuidanceNote` refuses an empty
 * title (`require_label`) and an empty body (`require_text`).
 */
export function guidanceRefusal(fields: GuidanceFields): ItemRefusal<GuidanceField> | null {
  const field = GUIDANCE_FORM_FIELDS.find((name) => pythonStrip(fields[name]) === "");
  return field === undefined ? null : { field, reason: RULES[field] };
}

/** The note the draft stores, both texts stripped as the lab strips them. */
export function guidanceEntry(id: string, fields: GuidanceFields): GuidanceNoteSchema {
  return { id, title: pythonStrip(fields.title), body: pythonStrip(fields.body) };
}
