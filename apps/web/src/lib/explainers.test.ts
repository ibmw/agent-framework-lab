import { describe, expect, it } from "vitest";
import { SETUP_GUIDE_STEPS } from "../routes/SetupGuidePage";
import { EXPLAINERS, type ExplainerId } from "./explainers";
import { glossaryTerm, parseGlossaryProse, referencedTerms } from "./glossary";
import { SETUP_CHAIN } from "./setupPath";

/**
 * Every piece of copy in this application written in `[[term-id]]` markup, in one list.
 *
 * The guide's steps are read here beside the notes because `GlossaryTermLink` renders a bare
 * word when a reference resolves to nothing: copy left out of this loop is copy where that
 * can happen unnoticed, whichever surface it is on.
 */
const MARKED_UP_COPY: [string, readonly string[]][] = [
  ...Object.entries(EXPLAINERS).map(
    ([id, explainer]) => [`explainer ${id}`, explainer.body] as [string, readonly string[]],
  ),
  ...Object.entries(SETUP_GUIDE_STEPS).map(
    ([id, step]) => [`guide step ${id}`, [...step.body, step.gate]] as [string, readonly string[]],
  ),
];

/**
 * The explainers claim to define the vocabulary they use. These assertions are what make the
 * claim checkable: a term added to a note without a definition fails here rather than
 * rendering as a link into the glossary that lands nowhere (ADR 0044).
 */

/** The five surfaces ADR 0044 names, as the six notes they need. */
const NAMED_SURFACES: ExplainerId[] = [
  "objective-blocks",
  "mutation-blocks",
  "scenario",
  "snapshots",
  "bench",
  "results",
];

describe("the inline explainers", () => {
  it("covers every surface whose vocabulary is not transferable from a commerce admin", () => {
    for (const id of NAMED_SURFACES) {
      expect(EXPLAINERS[id], `${id} has no note`).toBeDefined();
      expect(EXPLAINERS[id].body.length).toBeGreaterThan(0);
    }
  });

  it("names only vocabulary the glossary defines, here and in the written guide", () => {
    const referenced = MARKED_UP_COPY.flatMap(([where, paragraphs]) =>
      paragraphs.flatMap((paragraph) =>
        referencedTerms(paragraph).map((id) => [where, id] as const),
      ),
    );

    expect(referenced.length).toBeGreaterThan(20);
    for (const [where, id] of referenced) {
      expect(glossaryTerm(id), `${where} names ${id}, which has no definition`).toBeDefined();
    }
  });

  it("points at the definitions rather than restating them", () => {
    // `glossary.ts` exists so a term has one definition. Copy that repeated one would be the
    // second copy that module was written to prevent.
    for (const [where, paragraphs] of MARKED_UP_COPY) {
      for (const paragraph of paragraphs) {
        for (const term of referencedTerms(paragraph)) {
          const sentence = (glossaryTerm(term)?.definition ?? "").split(". ")[0];
          expect(paragraph, `${where} restates ${term}`).not.toContain(sentence);
        }
      }
    }
  });

  it("speaks the vocabulary the chain's own steps speak", () => {
    // The explainers and the setup path are two readings of one chain, so a word that appears
    // in a note and in no step — or the other way round — is a sign they have drifted apart.
    const inNotes = new Set(
      Object.values(EXPLAINERS).flatMap((explainer) => explainer.body.flatMap(referencedTerms)),
    );
    const inChain = new Set(SETUP_CHAIN.flatMap((step) => step.terms));

    for (const term of ["objective-block", "mutation-block", "scenario", "sandbox-snapshot"]) {
      expect(inNotes.has(term), `${term} is missing from the notes`).toBe(true);
      expect(inChain.has(term as never), `${term} is missing from the chain`).toBe(true);
    }
  });
});

describe("guide copy", () => {
  it("splits a reference out of the prose around it", () => {
    expect(parseGlossaryProse("A [[scenario]] is a recipe.")).toEqual([
      "A ",
      { id: "scenario", label: "scenario" },
      " is a recipe.",
    ]);
  });

  it("uses the word as the sentence writes it when the sentence says so", () => {
    expect(parseGlossaryProse("Two [[run|arms]]")).toEqual(["Two ", { id: "run", label: "arms" }]);
  });

  it("leaves prose with no references alone", () => {
    expect(parseGlossaryProse("Nothing is defined here.")).toEqual(["Nothing is defined here."]);
    expect(referencedTerms("Nothing is defined here.")).toEqual([]);
  });
});
