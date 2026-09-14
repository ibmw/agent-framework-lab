import { describe, expect, it } from "vitest";
import { argumentControl, argumentInputProps, argumentLabel } from "./tools";

describe("argumentLabel", () => {
  it.each([
    ["order_reference", "Order reference"],
    ["order_id", "Order ID"],
    ["document_id", "Document ID"],
    ["address_id", "Address ID"],
    ["confirmation", "Confirmation"],
    ["kind", "Kind"],
    ["query", "Query"],
    ["handle", "Handle"],
  ])("spells %s as %s", (name, label) => {
    expect(argumentLabel(name)).toBe(label);
  });

  it("leaves a name that is only an identifier readable", () => {
    // Nothing declares one today; the rule still has to be total, because the table this
    // reads is every tool's, not a list kept here.
    expect(argumentLabel("id")).toBe("ID");
  });
});

describe("argumentControl", () => {
  it("gives a closed set the select it declares, and everything else a text box", () => {
    expect(argumentControl("enum")).toBe("select");
    expect(argumentControl("text")).toBe("text");
    // No HTML type matches what `UUID(value)` accepts, so the kind takes none.
    expect(argumentControl("uuid")).toBe("text");
  });
});

describe("argumentInputProps", () => {
  const argument = { name: "order_id", description: "", required: false, choices: [] };

  it("carries the contract's required flag onto the control", () => {
    expect(argumentInputProps({ ...argument, kind: "text", required: true }).required).toBe(true);
    expect(argumentInputProps({ ...argument, kind: "text" }).required).toBe(false);
  });

  it("keeps the browser's autofill and spellcheck off an identifier, and adds no pattern", () => {
    const props = argumentInputProps({ ...argument, kind: "uuid" });
    expect(props).toEqual({ required: false, autoComplete: "off", spellCheck: false });
    expect(props).not.toHaveProperty("pattern");
  });

  it("adds nothing to free text beyond what the contract says", () => {
    expect(argumentInputProps({ ...argument, kind: "text" })).toEqual({ required: false });
  });
});
