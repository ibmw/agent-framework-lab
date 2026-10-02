import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChipListField } from "./components/ChipListField";
import { CHIP_LABEL_MAX_LENGTH } from "./lib/fieldRules";
import { normalizeTag } from "./lib/tickets";
import { controlHeightClasses, itemFormGridClasses, itemFormTracksClasses } from "./lib/ui";

function Harness({
  initial = [] as string[],
  normalize,
  maxLength = CHIP_LABEL_MAX_LENGTH,
  placement = "card",
  onWrite,
}: {
  initial?: string[];
  normalize?: (value: string) => string;
  maxLength?: number;
  placement?: "card" | "item-form";
  onWrite?: (values: string[]) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <ChipListField
      legend="Values"
      label="New value"
      hint="One value per chip. Every variant chooses one of these, and each must be different."
      addLabel="Add value"
      {...(placement === "card" ? { placement, empty: "No value yet." } : { placement })}
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

  it("draws no line of its own for an empty list in the form below a list, which says it", async () => {
    const user = userEvent.setup();
    render(<Harness placement="item-form" />);

    // The option form's refusal line names the missing value; the list says nothing twice.
    expect(group().queryByRole("list")).toBeNull();
    expect(group().queryByText("No value yet.")).toBeNull();

    // The chips still show where the line would have been.
    await user.type(group().getByLabelText("New value"), "Ocean Blue{Enter}");
    expect(group().getByRole("list")).toContainElement(
      group().getByRole("button", { name: "Remove Ocean Blue" }),
    );
  });

  it("draws one label over its input, and names the input with the drawn words first", () => {
    render(<Harness />);

    const field = group().getByLabelText("New value");
    // WCAG 2.5.3: the name starts with "Values", the label a sighted reader sees over it.
    expect(field).toHaveAccessibleName("Values New value");
    const label = document.querySelector(`label[for="${field.id}"]`);
    expect(label).toHaveClass("sr-only");
    expect(screen.getByText("Values").tagName).toBe("LEGEND");
    expect(screen.getByText("Values")).not.toHaveClass("sr-only");
  });

  it.each(["card", "item-form"] as const)(
    "on a %s, puts Add beside the input, top-aligned, with the hint under the input alone",
    (placement) => {
      render(<Harness placement={placement} />);

      const field = group().getByLabelText("New value");
      const add = group().getByRole("button", { name: "Add value" });
      const hint = group().getByText(/One value per chip/);
      // The input's column and the button are the two items of one row; the hint lives inside
      // the input's column, so it can never push the button off the input's top edge.
      const row = add.parentElement as HTMLElement;
      const column = [...row.children].find((child) => child.contains(field)) as HTMLElement;
      expect(column).not.toBe(add);
      expect(column).toContainElement(hint);
      expect(field.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect([...row.children]).toEqual([column, add]);
      expect(row).toHaveClass("items-start");
      expect(row).not.toHaveClass("items-end");
      // The input's height, so top-aligned is level.
      expect(add).toHaveClass(controlHeightClasses);
      expect(field).toHaveClass(controlHeightClasses);
      expect(add).not.toHaveClass("min-h-8");
    },
  );

  it("in the form below a list, lays the input in the first of the form grid's own tracks", () => {
    render(<Harness placement="item-form" />);

    const add = group().getByRole("button", { name: "Add value" });
    const row = add.parentElement as HTMLElement;
    expect(row.className).toBe(itemFormTracksClasses);
    expect(add).toHaveClass("justify-self-start");
    // The same tracks as the fields above it, so the input is as wide as "Option name".
    expect(itemFormTracksClasses).toBe(itemFormGridClasses.replace("auto-fit", "auto-fill"));
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
