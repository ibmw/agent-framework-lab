import { act } from "@testing-library/react";
import { expect } from "vitest";

function literally(text: string): RegExp {
  return new RegExp(text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/**
 * The text of every element a control's `aria-describedby` names, joined — failing if the
 * attribute is absent or any id in it names nothing in the document.
 */
export function describedText(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  expect(ids.length, "aria-describedby names something").toBeGreaterThan(0);
  return ids
    .map((id) => {
      const element = control.ownerDocument.getElementById(id);
      expect(element, `aria-describedby names #${id}, which is not in the document`).not.toBeNull();
      return (element?.textContent ?? "").replaceAll(/\s+/g, " ").trim();
    })
    .join(" ");
}

/**
 * Whether an element is drawn at all: no `hidden` attribute and no `display: none` or
 * `visibility: hidden`, on it or on any ancestor. (`sr-only` is not hiding: it is read.)
 */
function isShown(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.hasAttribute("hidden")) {
      return false;
    }
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }
  }
  return true;
}

/**
 * The refusal's own element: the first id in `aria-describedby`, which is where `PrimaryAction`
 * puts the refusal's `id`, ahead of anything the caller described the control with.
 */
export function refusalElement(control: HTMLElement): HTMLElement {
  const [id] = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  expect(id, "aria-describedby names the refusal's line").toBeDefined();
  const element = control.ownerDocument.getElementById(id);
  expect(element, `the refusal's line #${id} is not in the document`).not.toBeNull();
  return element as HTMLElement;
}

/**
 * A primary action refused for a reason, as ADR 0063 draws it.
 *
 * `toBeDisabled` cannot say this: jest-dom reads the `disabled` attribute only, and a refused
 * action is deliberately *not* natively disabled — it is `aria-disabled`, stays in the tab order,
 * and tells whoever lands on it why. So the four halves are asserted here, once:
 *
 * - `aria-disabled="true"` and no `disabled`;
 * - the reason in `title`;
 * - the reason in the refusal's own line — the element the refusal's id names, which must be
 *   drawn (not `hidden`, `display: none` or `visibility: hidden`, nor inside anything that is) —
 *   and in the text of every element `aria-describedby` names, each of which must exist, and so
 *   in the accessible description a keyboard reader hears on focus;
 * - it takes focus, and keeps it.
 *
 * `reason` is matched as a substring, because a Publish is described by every line
 * `PublishReasons` writes and a reason may be one of several.
 */
export function expectRefused(button: HTMLElement, reason: string | RegExp) {
  const pattern = typeof reason === "string" ? literally(reason) : reason;
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).not.toHaveAttribute("disabled");
  expect(button.getAttribute("title") ?? "").toMatch(pattern);
  // Read off the elements `aria-describedby` names, not off the computed description: that
  // falls back to `title` when the ids resolve to nothing, and would pass on the tooltip alone.
  expect(describedText(button)).toMatch(pattern);
  // The reason is on screen, in the line the refusal names — "inline", not only announced.
  const line = refusalElement(button);
  expect((line.textContent ?? "").replaceAll(/\s+/g, " ")).toMatch(pattern);
  expect(isShown(line), `the refusal's line #${line.id} is hidden`).toBe(true);
  expect(button).toHaveAccessibleDescription(pattern);
  button.focus();
  expect(button).toHaveFocus();
}

/** The same action, free to proceed: neither refused nor natively disabled. */
export function expectNotRefused(button: HTMLElement) {
  expect(button).not.toHaveAttribute("aria-disabled");
  expect(button).toBeEnabled();
}

/**
 * Submits a refused button's form the one way its swallowed click cannot stop:
 * `form.requestSubmit(button)` fires `submit` with the button as submitter and no click. What is
 * left to refuse it is the form's own handler (ADR 0063), which is what this reaches.
 */
export async function submitWithoutPressing(button: HTMLElement) {
  const form = (button as HTMLButtonElement).form;
  expect(form, "the button submits a form").not.toBeNull();
  await act(async () => {
    form?.requestSubmit(button as HTMLButtonElement);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
