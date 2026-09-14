import type { ObjectiveBlockPayloadSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptsDefault,
  addParameter,
  bindsShopObject,
  moveParameter,
  removeParameter,
  retypeParameter,
  shopBoundCount,
  toIdentifier,
  toSlug,
  uniqueParameterName,
  updateParameter,
} from "./blocks";

function payload(
  overrides: Partial<ObjectiveBlockPayloadSchema> = {},
): ObjectiveBlockPayloadSchema {
  return {
    name: "read-required-document",
    statement: "Read document",
    description: "Passes when the arm reads the bound document through its tool.",
    assessment: "deterministic",
    evidence: "event",
    parameters: [
      {
        name: "doc_ref",
        kind: "document_reference",
        description: "The shop document the arm has to read.",
        required: true,
        default: null,
        shop_bound: true,
      },
      {
        name: "severity",
        kind: "severity",
        description: "Whether missing the read fails the objective.",
        required: true,
        default: "required",
        shop_bound: false,
      },
    ],
    ...overrides,
  };
}

describe("parameter kinds", () => {
  it("mirrors the backend's shop-binding rule", () => {
    expect(bindsShopObject("document_reference")).toBe(true);
    expect(bindsShopObject("entity_reference")).toBe(true);
    expect(bindsShopObject("data_reference")).toBe(true);
    // A tool belongs to the lab, and a literal names nothing at all.
    expect(bindsShopObject("tool_reference")).toBe(false);
    expect(bindsShopObject("severity")).toBe(false);
  });

  it("only lets a literal kind carry a default", () => {
    expect(acceptsDefault("severity")).toBe(true);
    expect(acceptsDefault("timing")).toBe(true);
    expect(acceptsDefault("document_reference")).toBe(false);
    expect(acceptsDefault("tool_reference")).toBe(false);
  });

  it("counts the bindings a scenario will have to resolve in its own shop", () => {
    expect(shopBoundCount(payload())).toBe(1);
  });
});

describe("identifiers", () => {
  it("derives a snake_case name from what the author typed", () => {
    expect(toIdentifier("Doc ref")).toBe("doc_ref");
    expect(toIdentifier("Entité référencée")).toBe("entite_referencee");
    // A parameter name must start with a letter.
    expect(toIdentifier("2nd ref")).toBe("nd_ref");
    expect(toIdentifier("!!!")).toBe("parameter");
  });

  it("keeps a block slug's leading digit, which the contract allows", () => {
    expect(toSlug("Read required document")).toBe("read-required-document");
    expect(toSlug("24h response")).toBe("24h-response");
    expect(toSlug("Entité référencée")).toBe("entite-referencee");
    expect(toSlug("!!!")).toBe("block");
  });

  it("never derives a name the contract would refuse for its length", () => {
    // The row offers no rename, so a refused save would leave the author with nothing to
    // correct — the cap has to bite before the value reaches the payload.
    const long = "a".repeat(200);

    expect(toIdentifier(long)).toHaveLength(60);
    expect(toSlug(long)).toHaveLength(60);
    expect(toIdentifier(`${"ab ".repeat(40)}`).endsWith("_")).toBe(false);
    expect(toSlug(`${"ab ".repeat(40)}`).endsWith("-")).toBe(false);
  });

  it("keeps two parameters from sharing a name", () => {
    expect(uniqueParameterName("doc_ref", ["doc_ref"])).toBe("doc_ref_2");
    expect(uniqueParameterName("doc_ref", ["doc_ref", "doc_ref_2"])).toBe("doc_ref_3");
  });
});

describe("editing parameters", () => {
  it("adds a parameter with a derived, unique name", () => {
    const next = addParameter(payload(), "Doc ref", "document_reference");

    expect(next.parameters.map((entry) => entry.name)).toEqual([
      "doc_ref",
      "severity",
      "doc_ref_2",
    ]);
    expect(next.parameters[2].shop_bound).toBe(true);
    expect(next.parameters[2].default).toBeNull();
  });

  it("uses the same fallback identifier the preview must show when a label yields no letters", () => {
    const first = addParameter(payload(), "!!!", "document_reference");
    expect(first.parameters.at(-1)?.name).toBe("parameter");
    expect(addParameter(first, "!!!", "document_reference").parameters.at(-1)?.name).toBe(
      "parameter_2",
    );
  });

  it("drops a default the new kind cannot carry when a parameter is retyped", () => {
    // Otherwise the form would keep showing a default the backend refuses with
    // `reference_parameter_with_default`, and offer no way to clear it.
    const next = retypeParameter(payload(), "severity", "entity_reference");
    const [, severity] = next.parameters;

    expect(severity.kind).toBe("entity_reference");
    expect(severity.default).toBeNull();
    expect(severity.shop_bound).toBe(true);
    // An optional parameter with no default is a publish-gate error, and the default just went.
    expect(severity.required).toBe(true);
  });

  it("keeps a default when the new kind is still a literal", () => {
    const next = retypeParameter(payload(), "severity", "text");

    expect(next.parameters[1].default).toBe("required");
  });

  it("updates only the named parameter", () => {
    const next = updateParameter(payload(), "doc_ref", { description: "Something else." });

    expect(next.parameters[0].description).toBe("Something else.");
    expect(next.parameters[1]).toEqual(payload().parameters[1]);
  });

  it("removes a parameter by name", () => {
    expect(removeParameter(payload(), "doc_ref").parameters.map((e) => e.name)).toEqual([
      "severity",
    ]);
  });

  it("moves a parameter, because order is what a scenario binds in", () => {
    const moved = moveParameter(payload(), "severity", -1);

    expect(moved.parameters.map((entry) => entry.name)).toEqual(["severity", "doc_ref"]);
  });

  it("leaves the order alone at either end", () => {
    const first = payload();

    expect(moveParameter(first, "doc_ref", -1)).toEqual(first);
    expect(moveParameter(first, "severity", 1)).toEqual(first);
    expect(moveParameter(first, "missing", 1)).toEqual(first);
  });
});
