import type { ModelConnectionTestResponse } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
// The contract's own generated types, as text: a union is erased at runtime, so its members
// only exist to a reader that goes and looks at the source that declares them. The same read
// `lib/enumLabels.test.ts` makes, for the same reason — a table this workspace keeps is only
// held to the contract if something reads the contract.
import generated from "../../../../packages/contracts/src/generated/v1.ts?raw";
// Written from, and held to, the backend's `normalize_base_url` by its own suite.
import spellingsFixture from "../../../api/tests/fixtures/base_url_spellings.json?raw";
import {
  CONNECTION_SOURCES,
  CUSTOM_PRESET_ID,
  describeProbe,
  describeSource,
  describeZoneSource,
  ENDPOINT_PRESETS,
  foldEndpoint,
  PROBE_OUTCOMES,
  presetForBaseUrl,
  pythonStrip,
  sameEndpoint,
} from "./modelConnections";

/** The members `openapi.yaml` publishes for one string enum, read out of the generated file. */
function contractEnum(name: string): string[] {
  const declaration = new RegExp(`^ {4}${name}:((?:\\s*\\|?\\s*"[^"\\n]*")+);$`, "m");
  const match = generated.match(declaration);
  if (match === null) {
    throw new Error(`${name} is not an enum the generated contract declares`);
  }
  return [...match[1].matchAll(/"([^"]*)"/g)].map(([, member]) => member);
}

describe("the unions this zone reads", () => {
  it("are readable from the generated types, or nothing below proves anything", () => {
    // A sweep over a set that silently became empty reports as passing (ADR 0023), so the
    // shape of the parse is asserted before anything is compared against it.
    expect(contractEnum("ModelConnectionSource")).toEqual([
      "saved",
      "saved_unreadable",
      "environment",
      "none",
    ]);
    expect(contractEnum("ModelEndpointOutcome")).toEqual(["reachable", "refused", "unreachable"]);
  });

  it("have a sentence for every member of ModelConnectionSource, and no member the contract lacks", () => {
    // The typecheck catches the same mistake first — the table is a `Record` over the
    // contract union — and this says which member, in a sentence. A fifth source arrives
    // with a sentence or it arrives with a failure.
    expect([...CONNECTION_SOURCES].sort()).toEqual(
      [...contractEnum("ModelConnectionSource")].sort(),
    );
  });

  it("have a sentence for every member of ModelEndpointOutcome, and no member the contract lacks", () => {
    expect([...PROBE_OUTCOMES].sort()).toEqual([...contractEnum("ModelEndpointOutcome")].sort());
  });
});

describe("what the read-only zone says about the source in force", () => {
  it.each(CONNECTION_SOURCES)(
    "%s is written for a reader, and never in the wire's words",
    (source) => {
      const reading = describeSource(source);
      expect(reading.sentence.trim()).not.toBe("");
      if (source.includes("_")) {
        // The rule `enumLabels.test.ts` states, read here about a sentence rather than a
        // label: a wire spelling is punctuation nobody reads. `environment` and `none` are
        // ordinary English and may of course appear; `AGENT_LAB_OPENAI_API_KEY` is quoted on
        // purpose, because it is the variable an operator sets.
        expect(reading.sentence).not.toContain(source);
      }
    },
  );

  it("names a remedy only where there is something to do about it", () => {
    // The two states an operator chose need no instruction; the two that reach nothing do.
    expect(describeSource("saved").remedy).toBeNull();
    expect(describeSource("environment").remedy).toBeNull();
    expect(describeSource("none").remedy).not.toBeNull();
    expect(describeSource("saved_unreadable").remedy).not.toBeNull();
  });

  it("tells a lab that cannot read its key from a lab that was never configured", () => {
    // The whole reason the enum has four members rather than two. `key_configured` reports a
    // key's presence and never its readability, so without this sentence an operator whose
    // AGENT_LAB_CREDENTIAL_KEY has moved reads *Offline* beside a key the page says is
    // installed, and has nothing to act on (ADR 0052, amendment of 2026-09-22).
    const unreadable = describeSource("saved_unreadable");
    expect(unreadable.sentence).toMatch(/cannot read its key back/);
    expect(unreadable.remedy).toMatch(/Save the key again/);
    expect(unreadable.remedy).toMatch(/AGENT_LAB_CREDENTIAL_KEY/);
    expect(describeSource("none").sentence).not.toMatch(/key back/);
    expect(describeSource("none").remedy).not.toMatch(/Save the key again/);
  });

  it("says nothing about a key beyond which configuration won", () => {
    for (const source of CONNECTION_SOURCES) {
      const reading = describeSource(source);
      const written = `${reading.sentence} ${reading.remedy ?? ""}`;
      // No prefix, suffix, length, hash or mask — of anything. The dotted mask the prototype
      // draws is the shape this rule exists to keep off the page.
      expect(written).not.toMatch(/•|\*{2,}|…[a-z0-9]{4}/i);
      expect(written).not.toMatch(/\bmask(ed)?\b|\bdigits?\b|\bcharacters\b|\bhash\b/i);
    }
  });
});

describe("what the Model provider zone says above its form", () => {
  it("speaks only where the form alone would read as pointed nowhere", () => {
    // With nothing saved the form opens on Custom and an empty Base URL, whichever of the two
    // unsaved sources is in force. A saved connection is its own statement, and an unreadable
    // key is said on the key row, where it is remedied.
    expect(describeZoneSource("saved")).toBeNull();
    expect(describeZoneSource("saved_unreadable")).toBeNull();
    expect(describeZoneSource("environment")).toMatch(/AGENT_LAB_OPENAI_API_KEY/);
    expect(describeZoneSource("none")).toMatch(/reaches no provider/);
  });

  it.each(CONNECTION_SOURCES)("%s says nothing about a key but where it comes from", (source) => {
    const written = describeZoneSource(source) ?? "";
    expect(written).not.toMatch(/•|\*{2,}|…[a-z0-9]{4}/i);
    expect(written).not.toMatch(/\bmask(ed)?\b|\bdigits?\b|\bcharacters\b|\bhash\b/i);
  });
});

describe("what one probe is read as", () => {
  function answer(over: Partial<ModelConnectionTestResponse>): ModelConnectionTestResponse {
    return { outcome: "reachable", latency_ms: 312, status_class: "2xx", ...over };
  }

  it("writes the round trip, which is the only quantity the answer carries", () => {
    expect(describeProbe(answer({}))).toEqual({
      tone: "good",
      sentence: "Answered and accepted the key · 312 ms · 2xx",
    });
  });

  it("calls a rejected credential a rejection rather than a failure", () => {
    expect(
      describeProbe(answer({ outcome: "refused", latency_ms: 180, status_class: "4xx" })),
    ).toEqual({ tone: "bad", sentence: "Answered and rejected the key · 180 ms · 4xx" });
  });

  it("leaves the status out where nothing answered, and says so", () => {
    // An endpoint that said 404 and a host that said nothing at all are different facts, and
    // only one of them has a status to report.
    expect(
      describeProbe(answer({ outcome: "unreachable", latency_ms: 5001, status_class: null })),
    ).toEqual({ tone: "bad", sentence: "Nothing usable answered · 5001 ms" });
  });

  it.each(PROBE_OUTCOMES)("%s never quotes the endpoint's own words", (outcome) => {
    // The route never serves the upstream body, and nothing here invents one: what is drawn
    // is the classification and the class of the status (ADR 0052).
    const reading = describeProbe(answer({ outcome }));
    expect(reading.sentence.trim()).not.toBe("");
    expect(reading.sentence).not.toContain(outcome);
  });
});

/**
 * One spelling, the endpoint the lab stores it as, and the preset that endpoint is.
 *
 * Read from a fixture the backend's own suite holds true: `test_model_connections.py` runs
 * `normalize_base_url` over every row and asserts the stored value (or the refusal) and the
 * preset it maps to, so this table cannot drift from the function it describes without that
 * suite failing. A chip lit for a spelling the lab stores as a different endpoint is the page
 * claiming a preset it does not hold, so the fold is held to the server's answer rather than
 * to a reading of it.
 */
interface Spelling {
  readonly case: string;
  readonly input: string;
  readonly stored: string | null;
  readonly preset: string;
}
const FIXTURE = JSON.parse(spellingsFixture) as {
  presets: Record<string, string>;
  spellings: Spelling[];
};
const SPELLINGS = FIXTURE.spellings.map(
  (row) => [row.case, JSON.stringify(row.input).slice(0, 48), row] as const,
);

describe("the endpoint presets", () => {
  it("offers the six ADR 0052 names, with Custom as the general case", () => {
    expect(ENDPOINT_PRESETS.map((preset) => preset.label)).toEqual([
      "OpenAI",
      "Ollama",
      "vLLM",
      "OpenRouter",
      "Together AI",
      "Custom",
    ]);
    expect(ENDPOINT_PRESETS.at(-1)?.id).toBe(CUSTOM_PRESET_ID);
    // Custom carries no endpoint: it is what an unmatched base URL resolves to rather than a
    // sixth suggestion.
    expect(ENDPOINT_PRESETS.at(-1)?.baseUrl).toBe("");
  });

  it("names no model anywhere, because the connection holds none", () => {
    for (const preset of ENDPOINT_PRESETS) {
      expect(preset.note, preset.label).not.toMatch(/\bgpt-|\bllama3|\bqwen|\bdefault model\b/i);
    }
  });

  it("lights the chip the endpoint in the field belongs to", () => {
    expect(presetForBaseUrl("http://localhost:11434/v1").label).toBe("Ollama");
    expect(presetForBaseUrl("https://api.openai.com/v1").label).toBe("OpenAI");
  });

  it("is held to a table that is there, and to the presets this page offers", () => {
    // A sweep over a set that silently became empty reports as passing (ADR 0023).
    expect(SPELLINGS.length).toBeGreaterThan(40);
    expect(
      Object.fromEntries(
        ENDPOINT_PRESETS.filter((preset) => preset.baseUrl !== "").map((preset) => [
          preset.id,
          preset.baseUrl,
        ]),
      ),
    ).toEqual(FIXTURE.presets);
  });

  it.each(SPELLINGS)("%s: %s lights the chip of what the server stores", (_, __, row) => {
    expect(presetForBaseUrl(row.input).id).toBe(row.preset);
  });

  it.each(SPELLINGS)("%s: %s folds to what the server stores, or to nothing", (_, __, row) => {
    // The fold may decline a spelling — an IP literal, a host outside ASCII — and the page then
    // compares it as written. What it may never do is name an endpoint the lab would store as
    // another, which is what holds the `stored` column on this side too.
    const folded = foldEndpoint(row.input);
    if (folded !== null) {
      expect(folded).toBe(row.stored);
    }
  });

  it("counts a value's length in code points, as the server does", () => {
    // Every row of the case is over 2048 UTF-16 units; the shorter is 2048 code points and
    // stored, so a fold counting units would decline an endpoint the lab accepts as written.
    const rows = FIXTURE.spellings.filter(
      (row) => row.case === "length in code points, not UTF-16 units",
    );
    expect(rows.map((row) => row.stored === null)).toEqual([false, true]);
    for (const row of rows) {
      expect(row.input.length).toBeGreaterThan(2048);
      expect(foldEndpoint(row.input)).toBe(row.stored);
    }
  });

  it.each(SPELLINGS.filter(([, , row]) => row.preset !== "custom"))(
    "%s: %s is no change from the preset the server stores it as",
    (_, __, row) => {
      // The dirty check reads the same fold, so a spelling the server would store as the saved
      // endpoint offers nothing to save.
      expect(sameEndpoint(row.input, FIXTURE.presets[row.preset])).toBe(true);
    },
  );

  it("tells two endpoints apart, and compares what it cannot read as written", () => {
    expect(sameEndpoint("https://api.openai.com/V1", "https://api.openai.com/v1")).toBe(false);
    expect(sameEndpoint("http://[::1]:11434/v1", "http://[::1]:11434/v1")).toBe(true);
    expect(sameEndpoint("http://[::1]:11434/v1", "http://localhost:11434/v1")).toBe(false);
    expect(sameEndpoint("", "https://api.openai.com/v1")).toBe(false);
  });

  it("strips what Python's strip removes, and nothing JavaScript's trim adds", () => {
    expect(pythonStrip("\x85\x1c\x1f \u00a0")).toBe("");
    expect(pythonStrip("\ufeffx\ufeff")).toBe("\ufeffx\ufeff");
  });

  it("compares against the endpoint as the lab stored it, never a fold of that", () => {
    // A value stored before the server's fold was its own fixed point: saving it again would
    // store another spelling, so it is a change even retyped exactly as held.
    expect(sameEndpoint("http://localhost:11434/v1 ", "http://localhost:11434/v1 ")).toBe(false);
    expect(sameEndpoint("http://localhost:11434/v1 ", "http://localhost:11434/v1")).toBe(true);
    // What the fold cannot read is compared as written once the server's strip has run: a
    // no-break space after it is stored away, and a byte-order mark, which Python keeps, is not.
    expect(sameEndpoint("http://[::1]/a%2F\u00a0", "http://[::1]/a%2F")).toBe(true);
    expect(sameEndpoint("\u3000http://[::1]:11434/v1", "http://[::1]:11434/v1")).toBe(true);
    expect(sameEndpoint("http://[::1]/a%2F\ufeff", "http://[::1]/a%2F")).toBe(false);
    expect(sameEndpoint("http://[::1]/a%2F", "http://[::1]/a%2F\u00a0")).toBe(false);
  });

  it("falls back to Custom for an endpoint no preset names, and for none at all", () => {
    expect(presetForBaseUrl("https://gateway.internal/openai/v1").id).toBe(CUSTOM_PRESET_ID);
    expect(presetForBaseUrl("").id).toBe(CUSTOM_PRESET_ID);
  });
});
