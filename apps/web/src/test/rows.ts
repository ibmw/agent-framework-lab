import { within } from "@testing-library/react";
import { expect } from "vitest";
import {
  addFormClasses,
  fieldRowClasses,
  fieldRowControlClasses,
  fieldRowLabelClasses,
  fieldRowWideControlClasses,
  readOnlyTextClasses,
  readOnlyValueClasses,
} from "../lib/ui";
import { mainCardElements } from "./panel";

/**
 * The row the reference pages (`ShopSetupPages.tsx`) draw every field on: label and hint in the
 * left column, the control in the right. `Field` draws it as a `<div>` and `FieldGroup` as a
 * `<fieldset>`, which also sets `min-w-0` so a wide group can still wrap.
 */
const ROW_CLASSES = new Set([fieldRowClasses, `${fieldRowClasses} min-w-0`]);

function isRow(element: Element): boolean {
  return ROW_CLASSES.has(element.getAttribute("class") ?? "");
}

/** The right column, beside its label or — `Field`'s `wide` — under it. */
const CONTROL_COLUMN_CLASSES = new Set([fieldRowControlClasses, fieldRowWideControlClasses]);

/** The row a control is drawn on, or `null` where it stands outside one. */
function rowOf(control: HTMLElement): HTMLElement | null {
  let node = control.parentElement;
  while (node !== null && !isRow(node)) {
    node = node.parentElement;
  }
  return node;
}

/**
 * The control a label names, held to be on a row: in the right column, with the label — bound
 * to it by `for`/`id` rather than by wrapping — and any hint in the left.
 */
export function expectFieldRow(control: HTMLElement, label: string): void {
  const row = rowOf(control);
  expect(row, `the control labelled "${label}" is on a field row`).not.toBeNull();
  const [left, right] = Array.from((row as HTMLElement).children) as HTMLElement[];
  expect(left.className).toBe(fieldRowLabelClasses);
  expect(CONTROL_COLUMN_CLASSES.has(right.className), `"${label}"'s right column`).toBe(true);
  expect(right, `"${label}" is drawn in the row's right column`).toContainElement(control);
  const bound = within(left).getByText(label, { exact: true, selector: "label" });
  expect(bound, `"${label}" names its control by for/id`).toHaveAttribute("for", control.id);
}

/** A group of controls, held to be a row: a `<fieldset>` named by the text in its left column. */
export function expectGroupRow(group: HTMLElement, label: string): void {
  expect(group.tagName).toBe("FIELDSET");
  expect(isRow(group), `the group "${label}" is a field row`).toBe(true);
  expect(group).toHaveAccessibleName(label);
  const [left] = Array.from(group.children) as HTMLElement[];
  expect(left.className).toBe(fieldRowLabelClasses);
  expect(left).toHaveTextContent(label);
}

/**
 * Every control of a card that could hold a value of the draft, found by the element rather
 * than the role so a date or a number input is not missed — and every value the editor shows
 * rather than asks, which the rule puts on a row as an `<output>`.
 */
const FIELD_SELECTOR = [
  "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset])",
  "select",
  "textarea",
  "output",
].join(", ");

/** A shown value drawn in the read-only box without being an `<output>` is swept too. */
const READ_ONLY_CLASSES = new Set([readOnlyValueClasses, readOnlyTextClasses]);

function fieldsOf(card: HTMLElement): HTMLElement[] {
  const fields = new Set(card.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
  for (const element of card.querySelectorAll<HTMLElement>("*")) {
    if (READ_ONLY_CLASSES.has(element.getAttribute("class") ?? "")) {
      fields.add(element);
    }
  }
  return Array.from(fields);
}

/**
 * The words a row names its field by: a `Field` row's label, bound to the control by `for`, or
 * a `FieldGroup` row's name, drawn in its left column. Empty where the row names nothing — a
 * control standing in a row's right column that the row's label is not for.
 */
function rowName(row: HTMLElement, field: HTMLElement): string {
  const [left] = Array.from(row.children) as HTMLElement[];
  if (row.tagName === "FIELDSET") {
    const labelId = row.getAttribute("aria-labelledby") ?? "";
    const name = left.querySelector(`[id="${labelId}"]`);
    return name?.textContent?.trim() ?? "";
  }
  const label = Array.from(left.querySelectorAll("label")).find(
    (candidate) => candidate.htmlFor !== "" && candidate.htmlFor === field.id,
  );
  return label?.textContent?.trim() ?? "";
}

/**
 * Every field of a card stands on a row that names it, save the ones inside `except`. A bare
 * checkbox list stands on no row, and a textarea named by its `aria-label` alone is named by no
 * row's label, so either fails. Returns the fields it checked.
 */
function sweepCard(card: HTMLElement, except: HTMLElement[]): HTMLElement[] {
  const fields = fieldsOf(card).filter(
    (field) => !except.some((container) => container.contains(field)),
  );
  for (const field of fields) {
    const said =
      field.getAttribute("aria-label") ?? field.closest("label")?.textContent?.trim() ?? field.id;
    const name = `${field.tagName.toLowerCase()} "${said}"`;
    const row = rowOf(field);
    expect(row, `${name} stands on a row`).not.toBeNull();
    expect(rowName(row as HTMLElement, field), `${name}'s row names it`).not.toBe("");
  }
  return fields;
}

/**
 * The add forms below a card's lists (`addFormClasses`, alone or followed by the form's own
 * columns, as the variants' `sm:grid-cols-2`), whose labels the rule leaves stacked: "stacked
 * labels only inside an add form". A form that opens a row in place is not one.
 */
function addForms(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>("form")).filter((form) => {
    const classes = form.getAttribute("class") ?? "";
    return classes === addFormClasses || classes.startsWith(`${addFormClasses} `);
  });
}

/**
 * Every card of an editor's main column, beside the side panel `panel`, swept as
 * `sweepCard` sweeps one — enumerated, so a card added to the column is swept without
 * anyone naming it. Each card's add forms stand off the rows by the rule and are left out;
 * `except` names, per card, anything else that does, with the caller's reason — a
 * self-labelling list's own legend. Returns each card's name with the number of fields it
 * checked, for the caller to hold, so a card whose fields went unseen says so instead of
 * passing empty.
 */
export function expectEditorOnRows(
  panel: HTMLElement,
  except: Record<string, (card: HTMLElement) => HTMLElement[]> = {},
): Record<string, number> {
  const swept: Record<string, number> = {};
  for (const card of mainCardElements(panel)) {
    const name = card.getAttribute("aria-label") ?? "";
    swept[name] = sweepCard(card, [...addForms(card), ...(except[name]?.(card) ?? [])]).length;
  }
  for (const name of Object.keys(except)) {
    expect(Object.keys(swept), `the exception for "${name}" names a card`).toContain(name);
  }
  return swept;
}

/** `FieldRows`' own class: the variant that drops the rule of the run's first child. */
const RUN_CLASS = "[&>:first-child]:border-t-0";

/**
 * Every run of rows in a card opens on a row, so the rule `FieldRows` drops from its first
 * child is the first row's own top rule and not a wrapper's, which has none — the row inside a
 * wrapper would keep its rule under the card's heading. jsdom evaluates no variant, so what is
 * held is that the row is the element the variant selects. Returns the first rows.
 */
export function expectRunsOpenOnARow(card: HTMLElement): HTMLElement[] {
  const runs = Array.from(card.getElementsByClassName(RUN_CLASS)) as HTMLElement[];
  expect(runs.length, "the card holds a run of rows").toBeGreaterThan(0);
  return runs.map((run) => {
    const first = run.firstElementChild as HTMLElement;
    expect(
      isRow(first),
      `the run's first child is a row, not <${first.tagName.toLowerCase()} class="${first.className}">`,
    ).toBe(true);
    return first;
  });
}
