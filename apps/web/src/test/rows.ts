import { within } from "@testing-library/react";
import { expect } from "vitest";
import { fieldRowClasses, fieldRowControlClasses, fieldRowLabelClasses } from "../lib/ui";

/**
 * The row the reference pages (`ShopSetupPages.tsx`) draw every field on: label and hint in the
 * left column, the control in the right. `Field` draws it as a `<div>` and `FieldGroup` as a
 * `<fieldset>`, which also sets `min-w-0` so a wide group can still wrap.
 */
const ROW_CLASSES = new Set([fieldRowClasses, `${fieldRowClasses} min-w-0`]);

function isRow(element: Element): boolean {
  return ROW_CLASSES.has(element.getAttribute("class") ?? "");
}

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
  expect(right.className).toBe(fieldRowControlClasses);
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
 * than the role so a date or a number input is not missed.
 */
const FIELD_SELECTOR = [
  "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset])",
  "select",
  "textarea",
].join(", ");

/**
 * Every field of a card stands on a row, save the ones inside `except` — an add form, whose
 * labels stay stacked (`docs/design-direction.md`, *The form language*), or a control the brief
 * leaves where it is. Returns the fields it checked, so a caller can see the sweep found some.
 */
export function expectCardOnRows(card: HTMLElement, except: HTMLElement[] = []): HTMLElement[] {
  const fields = Array.from(card.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (field) => !except.some((container) => container.contains(field)),
  );
  expect(fields.length, "the card holds fields to check").toBeGreaterThan(0);
  for (const field of fields) {
    const name = field.getAttribute("aria-label") ?? field.id;
    expect(rowOf(field), `${field.tagName.toLowerCase()} "${name}" stands on a row`).not.toBeNull();
  }
  return fields;
}
