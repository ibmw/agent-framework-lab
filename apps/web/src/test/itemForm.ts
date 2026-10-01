import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";
import { describedText, expectNotRefused, expectRefused, refusalElement } from "./refused";

/** The visible label a form control is asked by, without the "(optional)" marker. */
function labelOf(control: HTMLElement): string {
  const label = (control as HTMLInputElement).labels?.[0]?.textContent ?? "";
  return label.replace(/\s*\(optional\)$/, "").trim();
}

/**
 * A form below a list refuses its submit with the first rule it breaks, in the order its fields
 * stand (ADR 0074), in one line after its buttons.
 *
 * Bound to the order by enumeration rather than by a list the test writes: the form's controls
 * are read in document order, every control a rule is given for is emptied, and then, control by
 * control, the submit must be refused with that control's rule, that control alone marked, the
 * line after the submit — and the control is answered before the next. A control no rule is
 * given for must be one that breaks none: a select, or a field marked "(optional)". Every rule
 * given must name a control the form asks.
 */
export async function expectRulesInFieldOrder(
  user: UserEvent,
  form: HTMLElement,
  submit: HTMLElement,
  rules: Record<string, { rule: string; answer: string }>,
) {
  const controls = Array.from(
    form.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea"),
  );
  const labels = controls.map(labelOf);
  expect(labels.filter((label) => label in rules).sort()).toEqual(Object.keys(rules).sort());
  for (const control of controls) {
    if (!(labelOf(control) in rules)) {
      const optional = /\(optional\)$/.test(
        (control as HTMLInputElement).labels?.[0]?.textContent ?? "",
      );
      expect(control.tagName === "SELECT" || optional, `"${labelOf(control)}" breaks no rule`).toBe(
        true,
      );
    }
  }
  const asked = controls.filter((control) => labelOf(control) in rules);
  for (const control of asked) {
    await user.clear(control);
  }
  for (const control of asked) {
    const { rule, answer } = rules[labelOf(control)];
    expectRefused(submit, rule);
    expect(
      submit.compareDocumentPosition(refusalElement(submit)) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the rule is said after the submit",
    ).toBeTruthy();
    expect(control, `"${labelOf(control)}" is the field the rule marks`).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // Described by the line itself, not merely by a hint that happens to say the same rule,
    // and the rule heard once: a hint saying it too stays out of the description.
    const described = (control.getAttribute("aria-describedby") ?? "").split(/\s+/);
    expect(described, `"${labelOf(control)}" is described by the refusal's line`).toContain(
      refusalElement(submit).id,
    );
    expect(
      describedText(control).split(rule).length - 1,
      `"${labelOf(control)}" is told the rule once`,
    ).toBe(1);
    for (const other of controls.filter((candidate) => candidate !== control)) {
      expect(other, `"${labelOf(other)}" is not marked`).not.toHaveAttribute("aria-invalid");
    }
    expect(control).not.toBeRequired();
    await user.type(control, answer);
  }
  expectNotRefused(submit);
}
