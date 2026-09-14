import type { ToolArgumentSchema } from "@agent-lab/contracts";

/**
 * How a published tool's argument table is read by a person rather than by an adapter.
 *
 * Not a `lib/enumLabels.ts` table, and the difference is the same one `lib/countries.ts`
 * records: that module holds one table per closed set the *contract* publishes, keyed to the
 * generated union and swept against it. An argument's name is not a union member — it is a
 * string each tool declares for itself, and the set grows every time a tool is published — so
 * a table here would be a list nothing holds to the contract and a new tool's argument would
 * arrive with no words. A function over the spelling the lab already chose has no such gap.
 *
 * `ToolArgumentKind` *is* a contract union and still has no table, for the other reason that
 * module gives: nothing renders it. It picks a control, the way `KINDS` in
 * `ExperimentTracesPage` picks a span name, and a value nobody reads needs no spelling.
 */

/**
 * `order_reference` as "Order reference": the wire spelling, capitalized like a field label.
 *
 * `_id` becomes "ID" rather than "Id" because that is how the workspace writes it everywhere
 * else (`EntryId`, "Guideline ID", "Option key"), and a label reading "Order Id" beside one
 * reading "Order ID" is the kind of small inconsistency a reader has to stop at.
 */
export function argumentLabel(name: string): string {
  const words = name.split("_").map((word) => (word === "id" ? "ID" : word));
  const [first = "", ...rest] = words;
  const head = first === "ID" ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return [head, ...rest].join(" ");
}

/** Which control a declared kind gets. `enum` is the only one that is not a text box. */
export type ArgumentControl = "select" | "text";

export function argumentControl(kind: ToolArgumentSchema["kind"]): ArgumentControl {
  return kind === "enum" ? "select" : "text";
}

/**
 * The input attributes a kind earns, and deliberately none it does not.
 *
 * `uuid` is the kind with no HTML type to take, and it is left as text rather than dressed in
 * one. A `pattern` was the alternative and is wrong here: the lab's own check is `UUID(value)`
 * in `sandbox_tools.py`, which takes the hyphenless form, braces and a `urn:uuid:` prefix as
 * well as the canonical spelling, so any pattern short enough to write would refuse in the
 * browser values the tool accepts — the objection `CountryField` raised against a select. What
 * it gets instead is what actually helps: the browser told not to autofill or spellcheck an
 * identifier, and a mono face so two of them can be told apart.
 *
 * `required` is the contract's own flag, and it is a real refusal here because the console's
 * arguments sit in a `<form>` with a submit button: constraint validation stops the call
 * rather than painting the box red and sending it anyway.
 */
export function argumentInputProps(argument: ToolArgumentSchema): {
  required: boolean;
  autoComplete?: "off";
  spellCheck?: false;
} {
  return argument.kind === "uuid"
    ? { required: argument.required, autoComplete: "off", spellCheck: false }
    : { required: argument.required };
}
