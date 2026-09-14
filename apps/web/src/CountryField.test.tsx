import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CountryField } from "./components/CountryField";
import { COUNTRIES } from "./lib/countries";

function Harness({ initial = "", onWrite }: { initial?: string; onWrite?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <CountryField
      value={value}
      onChange={(next) => {
        setValue(next);
        onWrite?.(next);
      }}
    />
  );
}

function suggestions() {
  // `<datalist>` is not an exposed role, so the options are read off the element the field
  // names. What a browser filters is what this list carries.
  const list = document.getElementById(screen.getByLabelText("Country").getAttribute("list") ?? "");
  return [...(list?.querySelectorAll("option") ?? [])];
}

describe("CountryField", () => {
  it("offers every ISO 3166-1 alpha-2 code with the country it names", () => {
    render(<Harness />);

    const options = suggestions();
    expect(options).toHaveLength(COUNTRIES.length);
    const france = options.find((option) => option.value === "FR");
    expect(france).toBeDefined();
    expect(france?.label).toBe("France");
  });

  it("carries the rule in the field's own description rather than only in a tooltip", () => {
    render(<Harness />);

    expect(screen.getByLabelText("Country")).toHaveAccessibleDescription(
      /Pick a country from the list, or type another two-letter code like FR\./,
    );
  });

  it("stores the code and reads the country back beneath the field", async () => {
    const user = userEvent.setup();
    const written: string[] = [];
    render(<Harness onWrite={(value) => written.push(value)} />);

    // Typed as an operator types it; the code is what the address stores.
    await user.type(screen.getByLabelText("Country"), "fr");

    expect(written.at(-1)).toBe("FR");
    expect(screen.getByLabelText("Country")).toHaveValue("FR");
    expect(screen.getByLabelText("Country")).toHaveAccessibleDescription(/France/);
  });

  it("echoes nothing for a code the register does not name", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Country"), "ZZ");

    // The lab takes any two letters; repeating `ZZ` back would read as confirmation.
    expect(screen.getByLabelText("Country")).not.toHaveAccessibleDescription(/ZZ.*ZZ/);
    expect(screen.getByLabelText("Country")).toHaveValue("ZZ");
  });

  it("marks a code that is not two letters as invalid", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const field = screen.getByLabelText("Country");
    await user.type(field, "FRA");
    expect(field).toBeInvalid();

    await user.clear(field);
    await user.type(field, "FR");
    expect(field).toBeValid();
  });
});
