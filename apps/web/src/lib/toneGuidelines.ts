import type { ToneOfVoiceSchema } from "@agent-lab/contracts";
import { isSlug } from "./entryIds";
import {
  alreadyTakenMessage,
  TONE_GUIDANCE_RULE,
  TONE_ID_RULE,
  TONE_NAME_RULE,
} from "./fieldRules";
import type { ItemRefusal } from "./itemForm";
import { pythonStrip } from "./pythonText";

/**
 * The shop's tone-of-voice guidelines as the form below *Guidelines* holds them (ADR 0074): one
 * builder, called by the form's Add and its *Save changes* alike, and one refusal, the first rule
 * the form breaks in the order its fields ask.
 *
 * Which guideline is the shop default is the list's answer — the radio on the item — and never
 * the form's, so the fields carry no `is_default`: the builder is handed it beside them.
 */
export interface ToneFields {
  name: string;
  id: string;
  guidance: string;
}

export type ToneField = keyof ToneFields;

/** The form's fields in the order it asks them, which is the order its rules are said in. */
export const TONE_FORM_FIELDS: readonly ToneField[] = ["name", "id", "guidance"];

export const BLANK_TONE: ToneFields = { name: "", id: "", guidance: "" };

/** Completes `alreadyTakenMessage` for an ID another guideline of the draft holds. */
export const TONE_TAKEN_PLACE = "in the draft";

export function toneFields(guideline: ToneOfVoiceSchema): ToneFields {
  return { name: guideline.name, id: guideline.id, guidance: guideline.guidance };
}

/**
 * The name, the ID while adding, then the guidance. `_require_label` refuses a name that is
 * empty or only padding; `_require_slug` an ID that is not kebab-case, which `taken` adds the
 * workspace's own rule to — another guideline's ID would make the two one key in the change
 * summary; `_require_text` guidance left empty. `editing` is the ID the form was opened on, which
 * is fixed and so asks nothing.
 */
export function toneRefusal(
  fields: ToneFields,
  taken: readonly string[],
  editing: string | null,
): ItemRefusal<ToneField> | null {
  if (pythonStrip(fields.name) === "") {
    return { field: "name", reason: TONE_NAME_RULE };
  }
  if (editing === null) {
    if (!isSlug(fields.id)) {
      return { field: "id", reason: TONE_ID_RULE };
    }
    if (taken.includes(fields.id)) {
      return { field: "id", reason: alreadyTakenMessage(fields.id, TONE_TAKEN_PLACE) };
    }
  }
  if (pythonStrip(fields.guidance) === "") {
    return { field: "guidance", reason: TONE_GUIDANCE_RULE };
  }
  return null;
}

/** The guideline the draft stores, both texts stripped as the lab strips them. */
export function toneEntry(id: string, fields: ToneFields, isDefault: boolean): ToneOfVoiceSchema {
  return {
    id,
    name: pythonStrip(fields.name),
    guidance: pythonStrip(fields.guidance),
    is_default: isDefault,
  };
}
