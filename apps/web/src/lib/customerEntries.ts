import type {
  AddressSchema,
  BackgroundEntrySchema,
  BackgroundKind,
  HiddenFactSchema,
} from "@agent-lab/contracts";
import { COUNTRY_PATTERN } from "./countries";
import {
  ADDRESS_FIELDS_RULE,
  BACKGROUND_DATE_RULE,
  BACKGROUND_NOTE_RULE,
  COUNTRY_RULE,
  HIDDEN_FACT_RULE,
} from "./fieldRules";
import type { ItemRefusal } from "./itemForm";
import { pythonStrip } from "./pythonText";

/**
 * A customer profile's three lists as the forms below them hold them (ADR 0074): the address
 * book, the background and the hidden simulator facts. Each has one builder, called by the
 * form's Add and its *Save changes* alike, so the two paths cannot write different payloads,
 * and one refusal, the first rule the form breaks in the order its fields ask.
 *
 * The identifier is a builder's first argument: derived once, when the entry is added, and
 * handed back unchanged by an edit, which is what makes an edit read as one updated entry
 * rather than a removal and an addition in the draft's change summary.
 */

const blank = (value: string) => pythonStrip(value) === "";

/**
 * The questions an address answers. The two optional lines are held as text and stored as
 * nothing when left empty; the country is `null` while it follows the profile's locale, which
 * it does on an address being added until the author types one.
 */
export interface AddressFields {
  label: string;
  recipient: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  region: string;
  country: string | null;
}

export type AddressField = keyof AddressFields;

/**
 * The fields the address form asks, in the order it asks them: every field the entry stores
 * while editing; while adding, what a new entry cannot do without, since the recipient is the
 * customer until the entry is corrected. The form draws its fields from this list and the
 * refusal reads it, so the order a rule is said in is the order the fields stand in.
 */
export const ADDRESS_FORM_FIELDS: Record<"adding" | "editing", readonly AddressField[]> = {
  adding: ["label", "line1", "postalCode", "city", "country"],
  editing: ["label", "recipient", "line1", "line2", "postalCode", "city", "region", "country"],
};

/** The address fields the lab refuses empty (`require_label`): every one but the two optional. */
const REQUIRED_ADDRESS_TEXT: ReadonlySet<AddressField> = new Set([
  "label",
  "recipient",
  "line1",
  "postalCode",
  "city",
]);

export const BLANK_ADDRESS: AddressFields = {
  label: "",
  recipient: "",
  line1: "",
  line2: "",
  postalCode: "",
  city: "",
  region: "",
  country: null,
};

export function addressFields(entry: AddressSchema): AddressFields {
  return {
    label: entry.label,
    recipient: entry.recipient,
    line1: entry.line1,
    line2: entry.line2 ?? "",
    postalCode: entry.postal_code,
    city: entry.city,
    region: entry.region ?? "",
    country: entry.country,
  };
}

/**
 * What the address holds once the form's two stand-ins are resolved: the recipient an address
 * being added ships to — the customer — and the country the profile's locale names while the
 * author has not typed one.
 */
export function resolvedAddress(
  fields: AddressFields,
  { recipient, country }: { recipient?: string; country: string },
): AddressFields & { country: string } {
  return {
    ...fields,
    recipient: recipient ?? fields.recipient,
    country: fields.country ?? country,
  };
}

/**
 * The first rule the address form breaks, in the order it asks (`ADDRESS_FORM_FIELDS`): a
 * required line empty or only spaces, in the lab's one sentence for all five; a country that is
 * not two uppercase letters (`require_country_code`). The recipient of an address being added
 * is not asked, and an empty one — a profile with no name yet — is said with no field marked.
 */
export function addressRefusal(
  fields: AddressFields & { country: string },
  mode: "adding" | "editing",
): ItemRefusal<AddressField> | null {
  const asked = ADDRESS_FORM_FIELDS[mode];
  for (const field of asked) {
    if (field === "country") {
      if (!new RegExp(`^${COUNTRY_PATTERN}$`).test(fields.country)) {
        return { field, reason: COUNTRY_RULE };
      }
    } else if (REQUIRED_ADDRESS_TEXT.has(field) && blank(fields[field])) {
      return { field, reason: ADDRESS_FIELDS_RULE };
    }
    if (mode === "adding" && field === "label" && blank(fields.recipient)) {
      return { field: null, reason: ADDRESS_FIELDS_RULE };
    }
  }
  return null;
}

/**
 * The entry the book stores. Every text is stored stripped as the lab strips it — `AddressEntry`
 * refuses padding (`require_label`) — and an optional line left empty is stored as none rather
 * than as an empty string the lab would refuse. Which entry is the default is the caller's
 * answer, never the form's. Only call it once `addressRefusal` has nothing to say.
 */
export function addressEntry(
  id: string,
  fields: AddressFields & { country: string },
  isDefault: boolean,
): AddressSchema {
  const optional = (value: string) => (blank(value) ? null : pythonStrip(value));
  return {
    id,
    label: pythonStrip(fields.label),
    recipient: pythonStrip(fields.recipient),
    line1: pythonStrip(fields.line1),
    line2: optional(fields.line2),
    postal_code: pythonStrip(fields.postalCode),
    city: pythonStrip(fields.city),
    region: optional(fields.region),
    country: fields.country,
    is_default: isDefault,
  };
}

/** A background entry's fields, in the order the form asks them. */
export interface BackgroundFields {
  kind: BackgroundKind;
  occurredOn: string;
  note: string;
}

export type BackgroundField = keyof BackgroundFields;

/** The form's fields in its order; the kind is a select of the contract's and breaks no rule. */
export const BACKGROUND_FORM_FIELDS: readonly BackgroundField[] = ["kind", "occurredOn", "note"];

export function backgroundFields(entry: BackgroundEntrySchema): BackgroundFields {
  return { kind: entry.kind, occurredOn: entry.occurred_on, note: entry.note };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The first rule the background form breaks, in the order it asks: the day, then the note. */
export function backgroundRefusal(fields: BackgroundFields): ItemRefusal<BackgroundField> | null {
  if (!ISO_DATE.test(fields.occurredOn)) {
    return { field: "occurredOn", reason: BACKGROUND_DATE_RULE };
  }
  if (blank(fields.note)) {
    return { field: "note", reason: BACKGROUND_NOTE_RULE };
  }
  return null;
}

/** The entry the profile stores: the note stripped, which `require_text` refuses padded. */
export function backgroundEntry(id: string, fields: BackgroundFields): BackgroundEntrySchema {
  return { id, kind: fields.kind, occurred_on: fields.occurredOn, note: pythonStrip(fields.note) };
}

/** How an entry is named on its item and its controls: "2026-05-02 · Support contact". */
export function backgroundName(entry: BackgroundEntrySchema, kindLabel: string): string {
  return `${entry.occurred_on} · ${kindLabel}`;
}

/** A hidden fact's fields, in the order the form asks them. */
export interface HiddenFactFields {
  note: string;
  revealedWhen: string;
}

export type HiddenFactField = keyof HiddenFactFields;

export const HIDDEN_FACT_FORM_FIELDS: readonly HiddenFactField[] = ["note", "revealedWhen"];

export function hiddenFactFields(fact: HiddenFactSchema): HiddenFactFields {
  return { note: fact.note, revealedWhen: fact.revealed_when };
}

/** The first rule the hidden-fact form breaks: the fact itself; what reveals it is optional. */
export function hiddenFactRefusal(fields: HiddenFactFields): ItemRefusal<HiddenFactField> | null {
  return blank(fields.note) ? { field: "note", reason: HIDDEN_FACT_RULE } : null;
}

/** The fact the profile stores, both texts stripped: `require_text` refuses either padded. */
export function hiddenFactEntry(id: string, fields: HiddenFactFields): HiddenFactSchema {
  return { id, note: pythonStrip(fields.note), revealed_when: pythonStrip(fields.revealedWhen) };
}
