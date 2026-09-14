import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CurrencyField } from "./components/CurrencyField";
import type { Currency } from "./lib/currencies";

function Harness({
  initial = ["GBP"] as Currency[],
  suggested,
  onWrite,
}: {
  initial?: Currency[];
  suggested?: Currency;
  onWrite?: (currencies: Currency[]) => void;
}) {
  const [value, setValue] = useState<Currency[]>(initial);
  return (
    <CurrencyField
      value={value}
      suggested={suggested}
      onChange={(currencies) => {
        setValue(currencies);
        onWrite?.(currencies);
      }}
    />
  );
}

function group() {
  return within(screen.getByRole("group", { name: "Currencies" }));
}

describe("CurrencyField", () => {
  it("names every currency the lab can express, coded and spelled", () => {
    render(<Harness />);

    const boxes = group().getAllByRole("checkbox");
    expect(boxes).toHaveLength(10);
    expect(boxes[0]).toHaveAccessibleName("USD — US dollar");
    expect(group().getByRole("checkbox", { name: "EUR — Euro" })).toBeInTheDocument();
  });

  it("puts the set's rule on the group rather than on one box", () => {
    render(<Harness />);

    expect(screen.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /variants may only be priced in these; the first is the default/i,
    );
  });

  it("names the currency that is the default, and moves it when the first one changes", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["CHF", "EUR"]} />);

    expect(screen.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /default: CHF — Swiss franc/i,
    );

    // Untick the first and the second becomes the default; retick it and it goes to the back
    // of the set. Without this line the group claims a default the screen cannot point at.
    await user.click(group().getByRole("checkbox", { name: "CHF — Swiss franc" }));
    expect(screen.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /default: EUR — Euro/i,
    );

    await user.click(group().getByRole("checkbox", { name: "CHF — Swiss franc" }));
    expect(screen.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /default: EUR — Euro/i,
    );
  });

  it("says a shop sells in at least one, which the disabled box cannot say itself", () => {
    render(<Harness initial={["GBP"]} />);

    expect(screen.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /a shop sells in at least one/i,
    );
    expect(group().getByRole("checkbox", { name: "GBP — Pound sterling" })).toBeDisabled();
  });

  it("keeps the ticking order, because the first currency is the shop's default", async () => {
    const user = userEvent.setup();
    const written: Currency[][] = [];
    render(<Harness initial={["CHF"]} onWrite={(value) => written.push(value)} />);

    await user.click(group().getByRole("checkbox", { name: "EUR — Euro" }));

    // Not the table's order, which would put EUR first and quietly change the default.
    expect(written.at(-1)).toEqual(["CHF", "EUR"]);
  });

  it("unticks a currency, and promotes the next one to default", async () => {
    const user = userEvent.setup();
    const written: Currency[][] = [];
    render(<Harness initial={["CHF", "EUR"]} onWrite={(value) => written.push(value)} />);

    await user.click(group().getByRole("checkbox", { name: "CHF — Swiss franc" }));

    expect(written.at(-1)).toEqual(["EUR"]);
  });

  it("holds the last currency ticked, which a shop cannot be saved without", async () => {
    const user = userEvent.setup();
    const written: Currency[][] = [];
    render(<Harness initial={["GBP"]} onWrite={(value) => written.push(value)} />);

    const last = group().getByRole("checkbox", { name: "GBP — Pound sterling" });
    expect(last).toBeChecked();
    expect(last).toBeDisabled();
    await user.click(last);

    expect(last).toBeChecked();
    expect(written).toEqual([]);
  });

  it("ticks the suggestion, and follows it while nothing has been chosen", () => {
    const { rerender } = render(<Harness initial={[]} suggested="GBP" />);

    expect(group().getByRole("checkbox", { name: "GBP — Pound sterling" })).toBeChecked();

    rerender(<Harness initial={[]} suggested="CHF" />);
    expect(group().getByRole("checkbox", { name: "CHF — Swiss franc" })).toBeChecked();
    expect(group().getByRole("checkbox", { name: "GBP — Pound sterling" })).not.toBeChecked();
  });

  it("stops following once the operator has ticked something themselves", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness initial={["GBP"]} suggested="GBP" />);

    await user.click(group().getByRole("checkbox", { name: "USD — US dollar" }));
    rerender(<Harness initial={["GBP"]} suggested="JPY" />);

    // A shop priced for a market it does not speak the language of is a real thing to author.
    expect(group().getByRole("checkbox", { name: "USD — US dollar" })).toBeChecked();
    expect(group().getByRole("checkbox", { name: "JPY — Japanese yen" })).not.toBeChecked();
  });

  it("leaves the standing answer alone where nothing is suggested", () => {
    const { rerender } = render(<Harness initial={["GBP"]} suggested="GBP" />);

    rerender(<Harness initial={["GBP"]} suggested={undefined} />);

    expect(group().getByRole("checkbox", { name: "GBP — Pound sterling" })).toBeChecked();
  });
});
