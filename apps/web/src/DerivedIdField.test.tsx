import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { DerivedIdField } from "./components/DerivedIdField";
import { SLUG_MAX_LENGTH, uniqueSuggestion } from "./lib/entryIds";
import { tooLongMessage } from "./lib/fieldRules";

/**
 * A suggestion that is not derived from what the operator is typing but from something still
 * loading — the shop's ticket or order list. `pending` says the list has not arrived.
 */
function Loading({
  pending,
  suggested,
  value = "",
  onChange = () => {},
}: {
  pending: boolean;
  suggested: string;
  value?: string;
  onChange?: (next: string) => void;
}) {
  return (
    <DerivedIdField
      label="Reference"
      hint="How the ticket is named in scenarios."
      value={value}
      suggested={suggested}
      pending={pending}
      takenPlace="used by a ticket in this shop"
      maxLength={SLUG_MAX_LENGTH}
      required
      onChange={onChange}
    />
  );
}

/** A keystroke as the DOM sees it first: the value is there before React has been told. */
function typeAheadOfReact(text: string) {
  const input = document.querySelector("input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, text);
}

/**
 * The field across a create, with a probe that reads the DOM in each commit as it lands.
 *
 * The commit under test is the one that *reopens* the field: `pending` drops and a new
 * `suggested` arrives together, and the input must already hold it. A `waitFor` cannot see
 * that commit — it resolves a macrotask later, by which time the follow effect has filled the
 * field in and the evidence is gone — so the probe runs in a layout effect instead.
 */
function Reopening({
  pending,
  suggested,
  emptied,
  probe,
}: {
  pending: boolean;
  suggested: string;
  /** The create emptied the field, as both create forms do the moment one succeeds. */
  emptied: boolean;
  probe: (seen: { value: string; disabled: boolean }) => void;
}) {
  const [typed, setTyped] = useState("");
  useLayoutEffect(() => {
    const input = document.querySelector("input");
    if (input) {
      probe({ value: input.value, disabled: input.disabled });
    }
  });
  return (
    <DerivedIdField
      label="Reference"
      hint="How the ticket is named in scenarios."
      value={emptied ? "" : typed}
      suggested={suggested}
      pending={pending}
      takenPlace="used by a ticket in this shop"
      maxLength={SLUG_MAX_LENGTH}
      required
      onChange={setTyped}
    />
  );
}

/**
 * The field with a keystroke landing in the gap the browser really leaves: a layout effect
 * runs after the commit and before that commit's passive effects, which is exactly where an
 * `input` event that React has not yet re-rendered for sits.
 */
function Racing({ suggested }: { suggested: string }) {
  const [value, setValue] = useState("");
  useLayoutEffect(() => {
    if (suggested !== "") {
      typeAheadOfReact("T-204");
    }
  }, [suggested]);
  return (
    <DerivedIdField
      label="Reference"
      hint="How the ticket is named in scenarios."
      value={value}
      suggested={suggested}
      maxLength={SLUG_MAX_LENGTH}
      required
      onChange={setValue}
    />
  );
}

/**
 * A field handed a suggestion past its cap. `nextReference` cuts its prefix so its own never
 * is, but the field does not take that on trust: a value the page wrote is refused on the
 * field in words whatever wrote it, as one `normalize` lengthened is.
 */
function Series({
  suggested,
  taken,
  onSubmit,
}: {
  suggested: string;
  taken: readonly string[];
  onSubmit: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <DerivedIdField
        label="Reference"
        hint="Uppercase letters and digits joined by hyphens."
        value={value}
        suggested={suggested}
        taken={taken}
        maxLength={SLUG_MAX_LENGTH}
        required
        normalize={(next) => next.toUpperCase()}
        onChange={setValue}
      />
      <button type="submit">Create</button>
    </form>
  );
}

function Harness({
  source,
  taken = [],
  takenPlace = "in the draft",
  onSubmit = () => {},
}: {
  source: string;
  taken?: readonly string[];
  takenPlace?: string;
  onSubmit?: () => void;
}) {
  const { value: suggested, takenBase } = uniqueSuggestion(source, taken);
  const [value, setValue] = useState(suggested);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <DerivedIdField
        label="Handle"
        hint="Lowercase with hyphens. Follows the title until you edit it."
        value={value}
        suggested={suggested}
        taken={taken}
        takenBase={takenBase}
        takenPlace={takenPlace}
        maxLength={SLUG_MAX_LENGTH}
        required
        onChange={setValue}
      />
      <button type="submit">Save</button>
    </form>
  );
}

describe("DerivedIdField", () => {
  it("follows the source until it is edited", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness source="alpine-shell-jacket" />);

    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket");
    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /saved as alpine-shell-jacket/i,
    );

    rerender(<Harness source="alpine-jacket" />);
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-jacket");

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    rerender(<Harness source="alpine-shell-jacket" />);
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-custom");
  });

  it("lets clear-then-type start a new value rather than appending to the suggestion", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-shell-jacket" />);

    await user.clear(screen.getByLabelText("Handle"));
    expect(screen.getByLabelText("Handle")).toHaveValue("");
    await user.type(screen.getByLabelText("Handle"), "harbour");
    expect(screen.getByLabelText("Handle")).toHaveValue("harbour");
  });

  it("restores the suggestion on blur while empty", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-shell-jacket" />);

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    await user.clear(screen.getByLabelText("Handle"));
    expect(screen.getByLabelText("Handle")).toHaveValue("");

    await user.tab();
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket");
  });

  it("follows the source again on the next source change once emptied", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness source="alpine-shell-jacket" />);

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    await user.clear(screen.getByLabelText("Handle"));
    expect(screen.getByLabelText("Handle")).toHaveValue("");

    rerender(<Harness source="alpine-jacket" />);
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-jacket");
  });

  it("offers the next free id and says why when the source is taken", () => {
    render(<Harness source="alpine-shell-jacket" taken={["alpine-shell-jacket"]} />);

    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket-2");
    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /saved as alpine-shell-jacket-2.*alpine-shell-jacket is already in the draft/i,
    );
  });

  it("hides why the source was taken once the value no longer is the suggestion", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-shell-jacket" taken={["alpine-shell-jacket"]} />);

    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /alpine-shell-jacket is already in the draft/i,
    );
    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    expect(screen.getByLabelText("Handle")).not.toHaveAccessibleDescription(
      /alpine-shell-jacket is already in the draft/i,
    );
  });

  it("refuses a value already taken rather than submitting it", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-jacket" taken={["alpine-shell-jacket"]} />);

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-shell-jacket");

    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /alpine-shell-jacket is already in the draft/i,
    );
    expect(screen.getByLabelText("Handle")).toBeInvalid();
    const extraId = screen
      .getByLabelText("Handle")
      .getAttribute("aria-describedby")
      ?.split(" ")
      .at(-1);
    expect(document.getElementById(extraId ?? "")).toHaveClass("text-lab-error");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket");
    expect(screen.getByLabelText("Handle")).toBeInvalid();
  });

  it("stops where the lab would refuse, whatever is typed or pasted", async () => {
    const user = userEvent.setup();
    const submitted: string[] = [];
    render(<Harness source="alpine-jacket" onSubmit={() => submitted.push("save")} />);
    const field = screen.getByLabelText("Handle");

    await user.clear(field);
    await user.type(field, "a".repeat(SLUG_MAX_LENGTH + 6));
    expect(field).toHaveValue("a".repeat(SLUG_MAX_LENGTH));
    await user.clear(field);
    await user.paste("b".repeat(SLUG_MAX_LENGTH + 6));
    expect(field).toHaveValue("b".repeat(SLUG_MAX_LENGTH));
    expect(field).toBeValid();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submitted).toEqual(["save"]);
  });

  it("refuses a suggestion past the cap on the field, and holds the form back", async () => {
    const user = userEvent.setup();
    const submitted: string[] = [];
    // One character past the 64 the lab keeps.
    const suggested = `N${"S".repeat(60)}-100`;
    expect(suggested).toHaveLength(SLUG_MAX_LENGTH + 1);
    render(
      <Series
        suggested={suggested}
        taken={[`N${"S".repeat(60)}-99`]}
        onSubmit={() => submitted.push("create")}
      />,
    );
    const field = screen.getByLabelText("Reference");

    await waitFor(() => expect(field).toHaveValue(suggested));
    const refusal = tooLongMessage(SLUG_MAX_LENGTH + 1, SLUG_MAX_LENGTH);
    expect(field).toHaveAccessibleDescription(new RegExp(refusal));
    expect(field).toBeInvalid();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(refusal)).toHaveClass("text-lab-error");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(submitted).toEqual([]);

    // Shortened by the operator, it is theirs and within the cap.
    await user.type(field, "{Backspace}");
    expect(field).toBeValid();
    expect(field).not.toHaveAccessibleDescription(new RegExp(refusal));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(submitted).toEqual(["create"]);
  });

  it("takes nothing while its suggestion is still coming", () => {
    render(<Loading pending suggested="" />);

    // An empty field that is about to fill itself is the one thing this component must not
    // offer: whatever is typed into it in that moment is thrown away when the suggestion lands.
    expect(screen.getByLabelText("Reference")).toBeDisabled();
    expect(screen.getByLabelText("Reference")).toHaveAccessibleDescription(
      /reading what is already used by a ticket in this shop/i,
    );
  });

  it("shows the suggestion itself rather than waiting to be told it back", () => {
    // The parent stores nothing here, which is the state every parent is in for the commit
    // between the suggestion becoming known and the effect reporting it back. The field is
    // already on screen and already usable in that commit, so it has to be right in it.
    render(<Loading pending={false} suggested="T-1" />);

    expect(screen.getByLabelText("Reference")).toBeEnabled();
    expect(screen.getByLabelText("Reference")).toHaveValue("T-1");
  });

  it("keeps a keystroke React has not heard about yet", () => {
    const { rerender } = render(<Racing suggested="" />);

    // The suggestion arrives, and the operator's keystroke lands in the same breath — after
    // the render that carries the suggestion, before the effect that reports it back. `edited`
    // is still false there, because the render that would set it has not happened yet.
    //
    // This is the effect's *decision* under test, not the whole browser race: no `input` event
    // is dispatched, so the parent never hears the keystroke and nothing re-renders. What it
    // proves is that the effect declines rather than writing the suggestion over the DOM — in
    // a browser the event React is about to be told about then lands on top.
    rerender(<Racing suggested="T-1" />);

    expect(screen.getByLabelText("Reference")).toHaveValue("T-204");
  });

  it("comes back unclaimed after a create, even when the operator typed the last one", async () => {
    const user = userEvent.setup();
    const seen: { value: string; disabled: boolean }[] = [];
    const probe = (state: { value: string; disabled: boolean }) => {
      seen.push(state);
    };
    const { rerender } = render(
      <Reopening pending={false} suggested="T-204" emptied={false} probe={probe} />,
    );

    // Typed rather than accepted — which is what the ticket and order journeys both do, and
    // the only path on which the field is the operator's when the create starts.
    await user.clear(screen.getByLabelText("Reference"));
    await user.type(screen.getByLabelText("Reference"), "T-204");
    rerender(<Reopening pending suggested="T-204" emptied probe={probe} />);
    expect(screen.getByLabelText("Reference")).toBeDisabled();

    // The reload lands: the field reopens and a new suggestion arrives in the same commit.
    seen.length = 0;
    rerender(<Reopening pending={false} suggested="T-205" emptied probe={probe} />);

    // That commit, not the one after it. A field still marked as the operator's would show
    // their emptied value here and fill itself in a commit later — open, empty, and about to
    // be written over, which is the state this component exists to never be in.
    expect(seen[0]).toEqual({ value: "T-205", disabled: false });
  });
});
