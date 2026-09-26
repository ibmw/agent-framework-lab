import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PrimaryAction, RefusalLine } from "./components/PrimaryAction";
import { blockedButtonClasses, buttonVariantClasses } from "./lib/ui";
import { expectRefused } from "./test/refused";

const REASON = "Name the thing first.";
const refusal = { id: "why", reason: REASON };

/**
 * The browser's implicit submission, which jsdom does not implement.
 *
 * HTML: Enter in a text field "must cause the user agent to fire a click event at that default
 * button", the default button being the form's first submit button in tree order — whether it
 * is nested in the form or associated with it by `form=`. `user-event` models only the nested
 * case (it `querySelector`s inside the form), so this finds the default button the way the
 * specification does and fires the click at it. It asserts that the button it found is the
 * refused one, so the test cannot pass by clicking something else.
 */
function submitImplicitly(form: HTMLFormElement, expected: HTMLElement) {
  const defaultButton = Array.from(form.elements).find(
    (element) =>
      (element instanceof HTMLButtonElement && element.type === "submit") ||
      (element instanceof HTMLInputElement && element.type === "submit"),
  );
  expect(defaultButton).toBe(expected);
  fireEvent.click(defaultButton as HTMLElement);
}

describe("PrimaryAction, refused", () => {
  it("is reachable, named, described and titled by its reason, in the dashed weight", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PrimaryAction variant="accent" type="button" refusal={refusal}>
          Create
        </PrimaryAction>
        <RefusalLine id="why">{REASON}</RefusalLine>
      </>,
    );
    const button = screen.getByRole("button", { name: "Create" });
    expectRefused(button, REASON);
    expect(button.className).toBe(blockedButtonClasses);
    button.blur();
    await user.tab();
    expect(button).toHaveFocus();
  });

  it("keeps a description the caller gave, after its reason", () => {
    render(
      <>
        <PrimaryAction variant="ink" type="button" refusal={refusal} aria-describedby="more">
          Publish
        </PrimaryAction>
        <RefusalLine id="why">{REASON}</RefusalLine>
        <p id="more">And something else.</p>
      </>,
    );
    expect(screen.getByRole("button", { name: "Publish" })).toHaveAccessibleDescription(
      `${REASON} And something else.`,
    );
  });

  it("ignores a pointer click, Enter and Space", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <PrimaryAction variant="accent" type="button" refusal={refusal} onClick={onClick}>
        Save
      </PrimaryAction>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("submits no form it sits in, by a click, a key, or Enter in one of its fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form aria-label="Nested" onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <input aria-label="Name" />
        <PrimaryAction variant="accent" type="submit" refusal={refusal}>
          Add
        </PrimaryAction>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Add" });
    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    // `user-event` finds a nested submit and clicks it, which is the browser's own route.
    await user.type(screen.getByRole("textbox", { name: "Name" }), "x{Enter}");
    submitImplicitly(screen.getByRole("form", { name: "Nested" }) as HTMLFormElement, button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits no form it names with form=, by a click, a key, or implicit submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <>
        {/* The button comes first in tree order, as `CreatePage`'s header does. */}
        <PrimaryAction variant="accent" type="submit" form="outside" refusal={refusal}>
          Create
        </PrimaryAction>
        <form
          id="outside"
          aria-label="Outside"
          onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}
        >
          <input aria-label="Name" />
        </form>
      </>,
    );
    const button = screen.getByRole("button", { name: "Create" });
    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    submitImplicitly(screen.getByRole("form", { name: "Outside" }) as HTMLFormElement, button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps focus when it becomes refused under the reader", () => {
    const { rerender } = render(
      <PrimaryAction variant="accent" type="button">
        Save
      </PrimaryAction>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    rerender(
      <>
        <PrimaryAction variant="accent" type="button" refusal={refusal}>
          Save
        </PrimaryAction>
        <RefusalLine id="why">{REASON}</RefusalLine>
      </>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBe(button);
    expect(button).toHaveFocus();
    expectRefused(button, REASON);
  });
});

describe("PrimaryAction, refused and busy at once", () => {
  it("lets the press in flight win, and goes back to the refusal when it ends", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <>
        <PrimaryAction variant="accent" type="button" busy refusal={refusal} onClick={onClick}>
          Creating…
        </PrimaryAction>
        <RefusalLine id="why">{REASON}</RefusalLine>
      </>,
    );
    // The name was cleared while "Creating…" ran: the button says it is busy, and nothing else.
    const button = screen.getByRole("button", { name: "Creating…" });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("title");
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(button.className).toBe(buttonVariantClasses.accent);

    rerender(
      <>
        <PrimaryAction variant="accent" type="button" refusal={refusal} onClick={onClick}>
          Create
        </PrimaryAction>
        <RefusalLine id="why">{REASON}</RefusalLine>
      </>,
    );
    expectRefused(screen.getByRole("button", { name: "Create" }), REASON);
  });
});

describe("PrimaryAction, free to proceed", () => {
  it("wears its own weight and runs its handler and its form", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <PrimaryAction variant="ink" type="submit" onClick={onClick}>
          Publish
        </PrimaryAction>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Publish" });
    expect(button.className).toBe(buttonVariantClasses.ink);
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("title");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("is natively disabled while a press is in flight, with nothing to explain", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <PrimaryAction variant="accent" type="button" busy onClick={onClick}>
        Saving…
      </PrimaryAction>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("title");
    expect(button).not.toHaveAccessibleDescription(/./);
    expect(button.className).toBe(buttonVariantClasses.accent);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
