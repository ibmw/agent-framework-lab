import type { ObjectiveBlockPayloadSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptsDefault,
  addedParameter,
  addParameter,
  BLANK_PARAMETER,
  bindingSentence,
  bindsShopObject,
  MAX_PARAMETERS,
  moveParameter,
  PARAMETERS_FULL,
  parameterEntry,
  parameterFields,
  parameterFormFields,
  parameterRefusal,
  removeParameter,
  replaceParameter,
  retypedFields,
  shopBoundCount,
  toIdentifier,
  toSlug,
  uniqueParameterName,
  withParameter,
} from "./blocks";
import blocksDomain from "../../../api/src/capability_lab/domain/blocks.py?raw";
import contentDomain from "../../../api/src/capability_lab/domain/content.py?raw";
import { SLUG_MAX_LENGTH } from "./entryIds";
import { PARAMETER_LABEL_RULE } from "./fieldRules";

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

  it("makes room for the suffix inside the identifier cap rather than running past it", () => {
    // `require_identifier` keeps at most `MAX_SLUG_LENGTH` (64) characters.
    expect(blocksDomain).toMatch(/_require_identifier\(self\.name, "block parameter name"\)/);
    expect(contentDomain).toMatch(new RegExp(`^MAX_SLUG_LENGTH = ${SLUG_MAX_LENGTH}$`, "m"));
    const atCap = `a${"b".repeat(SLUG_MAX_LENGTH - 1)}`;
    const twin = uniqueParameterName(atCap, [atCap]);
    expect(twin).toBe(`${atCap.slice(0, SLUG_MAX_LENGTH - 2)}_2`);
    const taken = [atCap];
    for (let count = 0; count < 9; count += 1) {
      taken.push(uniqueParameterName(atCap, taken));
    }
    expect(taken.at(-1)).toBe(`${atCap.slice(0, SLUG_MAX_LENGTH - 3)}_10`);
    const tenth = uniqueParameterName(atCap, taken);
    expect(tenth).toBe(`${atCap.slice(0, SLUG_MAX_LENGTH - 3)}_11`);
    for (const name of [twin, ...taken, tenth]) {
      expect(name.length, name).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    }
    // A cut that would end on the separator drops it, so the name stays snake_case.
    const underscored = `${"a".repeat(SLUG_MAX_LENGTH - 3)}_bc`;
    expect(uniqueParameterName(underscored, [underscored])).toBe(
      `${"a".repeat(SLUG_MAX_LENGTH - 3)}_2`,
    );
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
    const severity = payload().parameters[1];
    const next = replaceParameter(
      payload(),
      "severity",
      retypedFields(parameterFields(severity), "entity_reference"),
    ).parameters[1];

    expect(next.kind).toBe("entity_reference");
    expect(next.default).toBeNull();
    expect(next.shop_bound).toBe(true);
    // An optional parameter with no default is a publish-gate error, and the default just went.
    expect(next.required).toBe(true);
  });

  it("holds the kind's rules in the builder, whatever the fields it is handed say", () => {
    const entry = parameterEntry("ref", {
      kind: "entity_reference",
      description: "",
      required: false,
      default: "leaked",
    });

    expect(entry).toEqual({
      name: "ref",
      kind: "entity_reference",
      description: "",
      required: true,
      default: null,
      shop_bound: true,
    });
  });

  it("keeps a default when the new kind is still a literal", () => {
    const severity = payload().parameters[1];
    const next = replaceParameter(
      payload(),
      "severity",
      retypedFields(parameterFields(severity), "text"),
    );

    expect(next.parameters[1].default).toBe("required");
  });

  it("replaces only the named parameter, where it stands", () => {
    const next = replaceParameter(payload(), "doc_ref", {
      ...parameterFields(payload().parameters[0]),
      description: "Something else.",
    });

    expect(next.parameters[0].description).toBe("Something else.");
    expect(next.parameters[1]).toEqual(payload().parameters[1]);
  });

  it("writes a saved parameter's fields as they stand while its kind has not moved", () => {
    // A draft authored through the API may carry an optional reference; a description edit
    // is not the place to rewrite it. The gate says what it thinks of it meanwhile.
    const saved = {
      name: "ref",
      kind: "entity_reference" as const,
      description: "",
      required: false,
      default: null,
      shop_bound: true,
    };

    expect(
      parameterEntry("ref", { ...parameterFields(saved), description: "The order." }, saved),
    ).toEqual({ ...saved, description: "The order." });
    // Moving the kind is what brings the kind's rules to bear.
    expect(
      parameterEntry("ref", { ...parameterFields(saved), kind: "document_reference" }, saved)
        .required,
    ).toBe(true);
  });

  it("adds exactly what an open row saving the same answers writes", () => {
    const [added] = addedParameter([], "Order", "entity_reference");

    expect(parameterEntry("order", parameterFields(added), added)).toEqual(added);
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

describe("the editor's parameter form", () => {
  it("refuses at the cap before an empty label while adding, and the cap marks no field", () => {
    const named = { ...BLANK_PARAMETER, label: "Policy" };
    for (const [fields, count, expected] of [
      [named, 0, null],
      [named, MAX_PARAMETERS - 1, null],
      [BLANK_PARAMETER, MAX_PARAMETERS - 1, { field: "label", reason: PARAMETER_LABEL_RULE }],
      [{ ...named, label: " \x85" }, 2, { field: "label", reason: PARAMETER_LABEL_RULE }],
      [named, MAX_PARAMETERS, { field: null, reason: PARAMETERS_FULL }],
      [BLANK_PARAMETER, MAX_PARAMETERS, { field: null, reason: PARAMETERS_FULL }],
    ] as const) {
      expect(parameterRefusal(fields, count, null), `${count} with "${fields.label}"`).toEqual(
        expected,
      );
    }
  });

  it("asks nothing of an edit, whose name is fixed and which the cap is not about", () => {
    const editing = parameterFormFields(payload().parameters[0]);
    expect(editing.label).toBe("doc_ref");
    expect(parameterRefusal(editing, MAX_PARAMETERS, "doc_ref")).toBeNull();
    expect(parameterRefusal({ ...editing, label: "" }, MAX_PARAMETERS, "doc_ref")).toBeNull();
  });

  it("adds every field the form asks, under a derived name, stored stripped", () => {
    const [, , added] = withParameter(payload().parameters, "Doc ref", {
      kind: "timing",
      description: "  When it fires. ",
      required: false,
      default: " after_first_read\x85",
    });

    expect(added).toEqual({
      name: "doc_ref_2",
      kind: "timing",
      description: "When it fires.",
      required: false,
      default: "after_first_read",
      shop_bound: false,
    });
  });

  it("stores a default of nothing but spaces as no default", () => {
    const [, , added] = withParameter(payload().parameters, "note", {
      kind: "text",
      description: "",
      required: true,
      default: "   ",
    });

    expect(added.default).toBeNull();
  });
});

describe("how a parameter is bound", () => {
  it("says a scenario must bind only a required literal with no default, as `check_bindings` holds", () => {
    expect(bindingSentence({ kind: "text", required: true, default: null })).toBe(
      "A scenario must bind this.",
    );
    expect(bindingSentence({ kind: "text", required: true, default: "x" })).toBe(
      "A scenario may leave it to the default.",
    );
    expect(bindingSentence({ kind: "text", required: false, default: "x" })).toBe(
      "A scenario may leave it to the default.",
    );
    expect(bindingSentence({ kind: "entity_reference", required: true, default: null })).toBe(
      "Always bound by the scenario — a template cannot default an object.",
    );
    expect(bindingSentence({ kind: "text", required: false, default: null })).toBe(
      "A scenario may leave it unbound.",
    );
    // `binding_missing` ignores the kind: a reference that is not required may be left unbound.
    expect(bindingSentence({ kind: "entity_reference", required: false, default: null })).toBe(
      "A scenario may leave it unbound.",
    );
  });
});
