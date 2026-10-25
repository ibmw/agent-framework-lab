import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BusyButton, PrimaryAction, RefusalLine } from "./components/PrimaryAction";
import { useRefusalTouch } from "./lib/refusalTouch";
import { blockedButtonClasses, buttonVariantClasses } from "./lib/ui";
import {
  expectBusy,
  expectNotRefused,
  expectRefusalWeight,
  expectRefused,
  refusalFacts,
  submitWithoutPressing,
} from "./test/refused";

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
        <RefusalLine id="why" touched>
          {REASON}
        </RefusalLine>
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
        <RefusalLine id="why" touched>
          {REASON}
        </RefusalLine>
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
        <RefusalLine id="why" touched>
          {REASON}
        </RefusalLine>
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
        <RefusalLine id="why" touched>
          {REASON}
        </RefusalLine>
      </>,
    );
    // The name was cleared while "Creating…" ran: the button says it is busy, and nothing else.
    const button = screen.getByRole("button", { name: "Creating…" });
    expectBusy(button);
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(button.className).toBe(buttonVariantClasses.accent);
    button.click();
    expect(onClick).not.toHaveBeenCalled();

    rerender(
      <>
        <PrimaryAction variant="accent" type="button" refusal={refusal} onClick={onClick}>
          Create
        </PrimaryAction>
        <RefusalLine id="why" touched>
          {REASON}
        </RefusalLine>
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

  it("is unavailable while a press is in flight, with nothing to explain", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form aria-label="Saving" onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <PrimaryAction variant="accent" type="submit" busy onClick={onClick}>
          Saving…
        </PrimaryAction>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expectBusy(button);
    expect(button).not.toHaveAccessibleDescription(/./);
    expect(button.className).toBe(buttonVariantClasses.accent);
    await user.click(button);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    submitImplicitly(screen.getByRole("form", { name: "Saving" }) as HTMLFormElement, button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the focus of the reader who pressed it, while it runs and after (ADR 0065)", () => {
    const { rerender } = render(
      <PrimaryAction variant="accent" type="button">
        Send
      </PrimaryAction>,
    );
    const button = screen.getByRole("button", { name: "Send" });
    button.focus();
    rerender(
      <PrimaryAction variant="accent" type="button" busy>
        Running…
      </PrimaryAction>,
    );
    // A browser drops focus from a button that becomes natively disabled; this one never is.
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveFocus();
    rerender(
      <PrimaryAction variant="accent" type="button">
        Send
      </PrimaryAction>,
    );
    expect(screen.getByRole("button", { name: "Send" })).toBe(button);
    expect(button).toHaveFocus();
    expectNotRefused(button);
  });
});

/**
 * A secondary control whose press runs long (ADR 0065): busy, it holds focus as a primary one
 * does, and busy wins over the native `disabled` a secondary control is refused with.
 */
describe("BusyButton", () => {
  it("runs its handler when it is neither busy nor disabled", async () => {
    const onClick = vi.fn();
    render(
      <BusyButton type="button" busy={false} onClick={onClick}>
        Replay
      </BusyButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("holds focus while it runs, swallows every press, and comes back with focus", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <BusyButton type="button" busy={false} onClick={onClick}>
        Replay
      </BusyButton>,
    );
    const button = screen.getByRole("button", { name: "Replay" });
    button.focus();
    rerender(
      <BusyButton type="button" busy onClick={onClick}>
        Replaying…
      </BusyButton>,
    );
    expectBusy(button);
    await user.click(button);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
    rerender(
      <BusyButton type="button" busy={false} onClick={onClick}>
        Replay
      </BusyButton>,
    );
    expect(button).toHaveFocus();
    expectNotRefused(button);
  });

  it("lets busy win over a native refusal that arrives meanwhile, and keeps that refusal after", () => {
    const { rerender } = render(
      <BusyButton type="button" busy disabled>
        Replaying…
      </BusyButton>,
    );
    const button = screen.getByRole("button", { name: "Replaying…" });
    expectBusy(button);
    rerender(
      <BusyButton type="button" busy={false} disabled>
        Replay
      </BusyButton>,
    );
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
  });
});

/**
 * A form as every adopter draws one (ADR 0078): `watch` on the form, a field, a chip, the
 * refused submit, and the line it names.
 */
function TouchedForm({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const touch = useRefusalTouch();
  return (
    <form
      aria-label="Tag"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      {...touch.watch}
    >
      <input aria-label="Tag name" />
      <button type="button" aria-pressed={false}>
        Pinned
      </button>
      <PrimaryAction variant="outline" type="submit" refusal={refusal}>
        Add tag
      </PrimaryAction>
      <RefusalLine id="why" touched={touch.touched}>
        {REASON}
      </RefusalLine>
      <button type="button" onClick={touch.reset}>
        Start again
      </button>
    </form>
  );
}

describe("RefusalLine, muted until touched (ADR 0078)", () => {
  it("is a hint on a form nobody has touched, and the validation message after an edit", async () => {
    const user = userEvent.setup();
    render(<TouchedForm />);
    const add = screen.getByRole("button", { name: "Add tag" });
    expectRefused(add, REASON);
    expectRefusalWeight(add, "hint");
    const before = refusalFacts(add);

    await user.type(screen.getByRole("textbox", { name: "Tag name" }), "x");
    expectRefusalWeight(add, "touched");
    // Only the weight moved: the button says the same thing to whoever reaches it.
    expect(refusalFacts(add)).toEqual(before);
    expectRefused(add, REASON);
  });

  it("turns at a press on the refused action, which still submits nothing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TouchedForm onSubmit={onSubmit} />);
    const add = screen.getByRole("button", { name: "Add tag" });
    const before = refusalFacts(add);

    await user.click(add);
    expectRefusalWeight(add, "touched");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(refusalFacts(add)).toEqual(before);
  });

  it("turns at Enter on the focused action, and at Enter in a field", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TouchedForm />);
    screen.getByRole("button", { name: "Add tag" }).focus();
    await user.keyboard("{Enter}");
    expectRefusalWeight(screen.getByRole("button", { name: "Add tag" }), "touched");
    unmount();

    render(<TouchedForm />);
    const add = screen.getByRole("button", { name: "Add tag" });
    // The browser's implicit submission is a click on the default button, which is the press.
    submitImplicitly(screen.getByRole("form", { name: "Tag" }) as HTMLFormElement, add);
    expectRefusalWeight(add, "touched");
  });

  it("is not touched by a submission that arrives without a press", async () => {
    const onSubmit = vi.fn();
    render(<TouchedForm onSubmit={onSubmit} />);
    const add = screen.getByRole("button", { name: "Add tag" });
    // `requestSubmit` fires the form's submit with no click: no operator made it.
    await submitWithoutPressing(add);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expectRefusalWeight(add, "hint");
  });

  it("counts a press on a control in the form, and not a click into a field", async () => {
    const user = userEvent.setup();
    render(<TouchedForm />);
    const add = screen.getByRole("button", { name: "Add tag" });

    await user.click(screen.getByRole("textbox", { name: "Tag name" }));
    expectRefusalWeight(add, "hint");
    await user.click(screen.getByRole("button", { name: "Pinned" }));
    expectRefusalWeight(add, "touched");
  });

  it("is a hint again once the attempt starts over, and latches what the page knows was edited", () => {
    const { result, rerender } = renderHook(({ edited }) => useRefusalTouch(edited), {
      initialProps: { edited: false },
    });
    expect(result.current.touched).toBe(false);
    act(() => result.current.touch());
    expect(result.current.touched).toBe(true);
    act(() => result.current.reset());
    expect(result.current.touched).toBe(false);

    // A draft made dirty is an edit; it stays one after the draft is saved.
    rerender({ edited: true });
    expect(result.current.touched).toBe(true);
    rerender({ edited: false });
    expect(result.current.touched).toBe(true);
  });
});

describe("PrimaryAction's onRefusedPress", () => {
  it("reports a press it swallowed for a refusal, and not one it ran or held for a press in flight", async () => {
    const user = userEvent.setup();
    const onRefusedPress = vi.fn();
    const onClick = vi.fn();
    const { rerender } = render(
      <PrimaryAction
        variant="accent"
        type="button"
        refusal={refusal}
        onRefusedPress={onRefusedPress}
        onClick={onClick}
      >
        Create
      </PrimaryAction>,
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onRefusedPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    rerender(
      <PrimaryAction
        variant="accent"
        type="button"
        refusal={refusal}
        busy
        onRefusedPress={onRefusedPress}
        onClick={onClick}
      >
        Create
      </PrimaryAction>,
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    rerender(
      <PrimaryAction
        variant="accent"
        type="button"
        onRefusedPress={onRefusedPress}
        onClick={onClick}
      >
        Create
      </PrimaryAction>,
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onRefusedPress).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
