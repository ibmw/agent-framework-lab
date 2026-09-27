import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { type ToggleChip, ToggleChipGroup } from "./components/ToggleChipGroup";

type Channel = "chat" | "email" | "phone";

const CHANNELS: ToggleChip<Channel>[] = [
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

function Harness({
  initial = ["chat"],
  options = CHANNELS,
  keepOne,
  arrangement,
  writes = [],
}: {
  initial?: Channel[];
  options?: ToggleChip<Channel>[];
  keepOne?: string;
  arrangement?: "row" | "stacked";
  writes?: Channel[][];
}) {
  const [value, setValue] = useState<Channel[]>(initial);
  return (
    <ToggleChipGroup
      label="Answers on"
      hint="The last channel left on stays on."
      arrangement={arrangement}
      options={options}
      value={value}
      keepOne={keepOne}
      onChange={(next) => {
        writes.push(next);
        setValue(next);
      }}
    />
  );
}

function group() {
  return screen.getByRole("group", { name: "Answers on" });
}

function chip(name: string) {
  return within(group()).getByRole("checkbox", { name });
}

describe("ToggleChipGroup", () => {
  it.each(["row", "stacked"] as const)(
    "is one named group of native checkboxes, described by its rule, drawn as a %s",
    (arrangement) => {
      render(<Harness arrangement={arrangement} />);

      expect(group().tagName).toBe("FIELDSET");
      expect(group()).toHaveAccessibleDescription(/the last channel left on stays on/i);
      const boxes = within(group()).getAllByRole("checkbox");
      expect(boxes.map((box) => box.getAttribute("type"))).toEqual([
        "checkbox",
        "checkbox",
        "checkbox",
      ]);
      expect(chip("Chat")).toBeChecked();
      expect(chip("Email")).not.toBeChecked();
    },
  );

  it("draws a chip on as the prototype's pine chip with a check, and off as a plain one", () => {
    render(<Harness />);

    const on = chip("Chat").closest("label") as HTMLElement;
    const off = chip("Email").closest("label") as HTMLElement;
    // "✓ Chat" to the eye; the check is not part of the name.
    expect(on).toHaveTextContent("✓Chat");
    expect(within(on).getByText("✓")).toHaveAttribute("aria-hidden", "true");
    expect(off).toHaveTextContent(/^Email$/);
    for (const token of ["border-admin-chip-border", "bg-admin-chip", "text-lab-primary"]) {
      expect(on.className).toContain(token);
      expect(off.className).not.toContain(token);
    }
    expect(off.className).toContain("border-admin-field-border");
    // The input is hidden and the label is the chip, so the ring is drawn on the label.
    expect(chip("Chat")).toHaveClass("opacity-0", "absolute", "inset-0");
    expect(on.className).toContain("has-focus-visible:outline-lab-primary");
  });

  it("appends a chip turned on and drops one turned off, in the order they were turned on", async () => {
    const user = userEvent.setup();
    const writes: Channel[][] = [];
    render(<Harness initial={["phone"]} writes={writes} />);

    await user.click(chip("Chat"));
    await user.click(chip("Email"));
    await user.click(chip("Phone"));

    expect(writes).toEqual([
      ["phone", "chat"],
      ["phone", "chat", "email"],
      ["chat", "email"],
    ]);
  });

  it("moves by Tab from chip to chip and toggles the focused one with Space", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["chat", "email"]} />);

    await user.tab();
    expect(chip("Chat")).toHaveFocus();
    await user.tab();
    expect(chip("Email")).toHaveFocus();
    await user.keyboard(" ");
    expect(chip("Email")).not.toBeChecked();
    await user.tab();
    expect(chip("Phone")).toHaveFocus();
    await user.keyboard(" ");
    expect(chip("Phone")).toBeChecked();
    // Focus stays on the chip that was pressed, however its look changed.
    expect(chip("Phone")).toHaveFocus();
  });

  it("keeps the last chip on where the set may not be emptied, and titles it with why", async () => {
    const user = userEvent.setup();
    const writes: Channel[][] = [];
    render(<Harness keepOne="A shop answers on at least one channel." writes={writes} />);

    const last = chip("Chat");
    expect(last).toBeChecked();
    expect(last).toBeDisabled();
    expect(last.closest("label")).toHaveAttribute(
      "title",
      "A shop answers on at least one channel.",
    );
    expect(last).toHaveAccessibleDescription("A shop answers on at least one channel.");
    await user.click(last);
    expect(last).toBeChecked();
    expect(writes).toEqual([]);

    // A second chip on frees the first.
    await user.click(chip("Email"));
    expect(chip("Chat")).toBeEnabled();
    expect(chip("Chat").closest("label")).not.toHaveAttribute("title");
  });

  it("lets every chip go where nothing keeps one on", async () => {
    const user = userEvent.setup();
    const writes: Channel[][] = [];
    render(<Harness writes={writes} />);

    expect(chip("Chat")).toBeEnabled();
    await user.click(chip("Chat"));
    expect(writes).toEqual([[]]);
  });

  it("disables a chip with a reason of its own, and says the reason beside it", async () => {
    const user = userEvent.setup();
    const writes: Channel[][] = [];
    render(
      <Harness
        initial={["chat"]}
        options={[
          CHANNELS[0],
          CHANNELS[1],
          { ...CHANNELS[2], disabledReason: "Phone has completed." },
        ]}
        writes={writes}
      />,
    );

    const phone = chip("Phone");
    expect(phone).toBeDisabled();
    expect(phone.closest("label")).toHaveAttribute("title", "Phone has completed.");
    expect(phone).toHaveAccessibleDescription("Phone has completed.");
    // Named by the line, not only by the title a description falls back to.
    const described = (phone.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(
      "Phone has completed.",
    );
    expect(screen.getByText("Phone has completed.")).toBeVisible();
    // Faded, since it cannot be turned on.
    expect(phone.closest("label")?.className).toContain("opacity-55");
    await user.click(phone);
    expect(writes).toEqual([]);
    // A chip with no reason of its own is described by nothing of the kind.
    expect(chip("Email")).not.toHaveAccessibleDescription();
  });

  it("marks a chip the gate finds against invalid, says the finding, and refuses nothing", async () => {
    const user = userEvent.setup();
    const writes: Channel[][] = [];
    const finding = "variant NS-1 is priced in EUR, which the shop does not sell in";
    render(
      <Harness
        initial={["chat"]}
        options={[CHANNELS[0], { ...CHANNELS[1], findings: [finding] }, CHANNELS[2]]}
        writes={writes}
      />,
    );

    const email = chip("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(finding);
    expect(email.closest("label")?.className).toContain("border-lab-error");
    const line = screen.getByText(finding).closest("p") as HTMLElement;
    // Polite, not an alert: nothing was refused.
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).not.toHaveAttribute("role", "alert");
    expect(chip("Chat")).not.toHaveAttribute("aria-invalid");
    await user.click(email);
    expect(writes).toEqual([["chat", "email"]]);
  });

  it("keeps the finding line mounted while it holds nothing, so a later finding is heard", () => {
    const finding = "variant NS-1 is priced in EUR, which the shop does not sell in";
    const { rerender } = render(<Harness />);

    const line = group().querySelector('[id$="-findings"]') as HTMLElement;
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).toHaveClass("sr-only");
    expect(line).toBeEmptyDOMElement();

    rerender(<Harness options={[CHANNELS[0], { ...CHANNELS[1], findings: [finding] }]} />);
    // The same element, now saying it.
    expect(group().querySelector('[id$="-findings"]')).toBe(line);
    expect(line).toHaveTextContent(finding);
  });

  it("names a chip by more than it shows where the caller asks", () => {
    render(
      <Harness
        options={[
          { value: "chat", label: "Chat", spoken: "— live chat" },
          CHANNELS[1],
          CHANNELS[2],
        ]}
      />,
    );

    const chat = within(group()).getByRole("checkbox", { name: "Chat — live chat" });
    expect(chat.closest("label")).toHaveTextContent(/^✓Chat$/);
  });
});
