import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChipListField } from "./components/ChipListField";
import { CHIP_LABEL_MAX_LENGTH } from "./lib/fieldRules";
import { normalizeTag } from "./lib/tickets";

function Harness({
  initial = [] as string[],
  normalize,
  maxLength = CHIP_LABEL_MAX_LENGTH,
  onWrite,
}: {
  initial?: string[];
  normalize?: (value: string) => string;
  maxLength?: number;
  onWrite?: (values: string[]) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <ChipListField
      legend="Values"
      label="New value"
      hint="One value per chip. Every variant chooses one of these, and each must be different."
      addLabel="Add value"
      empty="No value yet."
      values={values}
      normalize={normalize}
      maxLength={maxLength}
      takenPlace="a value of this option"
      onChange={(next) => {
        setValues(next);
        onWrite?.(next);
      }}
    />
  );
}

function group() {
  return within(screen.getByRole("group", { name: "Values" }));
}

describe("ChipListField", () => {
  it("adds one value at a time, keeping the order they were entered in", async () => {
    const user = userEvent.setup();
    const written: string[][] = [];
    render(<Harness onWrite={(values) => written.push(values)} />);

    await user.type(group().getByLabelText("New value"), "Ocean Blue");
    await user.click(group().getByRole("button", { name: "Add value" }));
    await user.type(group().getByLabelText("New value"), "Charcoal");
    await user.click(group().getByRole("button", { name: "Add value" }));

    expect(written.at(-1)).toEqual(["Ocean Blue", "Charcoal"]);
    expect(group().getByLabelText("New value")).toHaveValue("");
  });

  it("adds on Enter, and does not submit the form it is nested in", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <Harness />
        <button type="submit">Add option</button>
      </form>,
    );

    await user.type(group().getByLabelText("New value"), "Ocean Blue{Enter}");

    expect(group().getByRole("button", { name: "Remove Ocean Blue" })).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a duplicate in words, and adds nothing when it is pressed anyway", async () => {
    const user = userEvent.setup();
    const written: string[][] = [];
    render(<Harness initial={["Ocean Blue"]} onWrite={(values) => written.push(values)} />);

    await user.type(group().getByLabelText("New value"), "Ocean Blue");

    const field = group().getByLabelText("New value");
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(/Ocean Blue is already a value of this option\./);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ocean Blue is already a value of this option.",
    );

    await user.click(group().getByRole("button", { name: "Add value" }));
    expect(written).toEqual([]);
    expect(group().getAllByRole("button", { name: "Remove Ocean Blue" })).toHaveLength(1);
  });

  it("names every remove button after the value it removes", async () => {
    const user = userEvent.setup();
    const written: string[][] = [];
    render(
      <Harness initial={["Ocean Blue", "Charcoal"]} onWrite={(values) => written.push(values)} />,
    );

    // The glyph is decorative; the name is the sentence a reader hears.
    expect(group().getByRole("button", { name: "Remove Ocean Blue" })).toBeVisible();
    expect(group().getByRole("button", { name: "Remove Charcoal" })).toBeVisible();

    await user.click(group().getByRole("button", { name: "Remove Ocean Blue" }));
    expect(written.at(-1)).toEqual(["Charcoal"]);
  });

  it("keeps its ✕ grey until hovered, then in the warm red a removal reads in (ADR 0075)", () => {
    render(<Harness initial={["Charcoal"]} />);

    const remove = group().getByRole("button", { name: "Remove Charcoal" });
    expect(remove.className.split(" ")).toEqual(
      expect.arrayContaining(["text-admin-muted", "hover:text-lab-error"]),
    );
    expect(remove.className).not.toContain("hover:text-admin-ink");
  });

  it("says when it holds nothing", () => {
    render(<Harness />);

    expect(group().getByText("No value yet.")).toBeVisible();
  });

  it("stores what was written where the caller respells nothing", async () => {
    const user = userEvent.setup();
    const written: string[][] = [];
    render(<Harness onWrite={(values) => written.push(values)} />);

    await user.type(group().getByLabelText("New value"), "  Ocean Blue  ");
    await user.click(group().getByRole("button", { name: "Add value" }));

    // Trimmed, because surrounding space is never what was meant — but not lowercased and
    // not hyphenated, because a persona trait reads "mildly anxious".
    expect(written.at(-1)).toEqual(["Ocean Blue"]);
  });

  it("previews the respelling where the caller has one, and compares against it", async () => {
    const user = userEvent.setup();
    const written: string[][] = [];
    render(
      <Harness
        initial={["address-change"]}
        normalize={normalizeTag}
        onWrite={(values) => written.push(values)}
      />,
    );

    await user.type(group().getByLabelText("New value"), "Wrong Address");
    expect(group().getByLabelText("New value")).toHaveAccessibleDescription(
      /Saved as wrong-address\./,
    );

    await user.click(group().getByRole("button", { name: "Add value" }));
    expect(written.at(-1)).toEqual(["address-change", "wrong-address"]);

    // The duplicate is the *stored* spelling, which is the comparison the lab makes.
    await user.type(group().getByLabelText("New value"), "Address Change");
    expect(group().getByLabelText("New value")).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "address-change is already a value of this option.",
    );
  });

  it("stops at the cap the contract puts on one entry", async () => {
    const user = userEvent.setup();
    const written: string[][] = [];
    render(<Harness maxLength={8} onWrite={(values) => written.push(values)} />);

    await user.type(group().getByLabelText("New value"), "Ocean Blue");
    await user.click(group().getByRole("button", { name: "Add value" }));

    // Refused at the keyboard rather than accepted, chipped, and refused at save.
    expect(written.at(-1)).toEqual(["Ocean Bl"]);
  });

  it("adds nothing for an empty field, and says nothing about it", async () => {
    const user = userEvent.setup();
    const written: string[][] = [];
    render(<Harness onWrite={(values) => written.push(values)} />);

    await user.click(group().getByRole("button", { name: "Add value" }));
    await user.type(group().getByLabelText("New value"), "   {Enter}");

    expect(written).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
