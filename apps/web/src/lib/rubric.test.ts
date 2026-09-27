import { describe, expect, it } from "vitest";
// The gate's own source, as text: the pattern mirrored here only exists in the file that
// declares it, so the file is what has to be read (`fieldRules.test.ts` does the same).
import judgeCapabilities from "../../../api/src/capability_lab/application/judge_capabilities.py?raw";
import tablesSource from "../../../api/tests/fixtures/rubric_mentions.json?raw";
import { mentionMatcher, namedTerms, rubricMentions, termPattern } from "./rubric";

/**
 * The editor's rubric line, held to the gate by `test_rubric_mentions.py`'s table.
 *
 * That module writes the table from the backend and holds every row of it to the backend; this
 * file holds `rubric.ts` to every row. So neither side can move without the other failing: the
 * gate's answers for real rubrics, the characters Python's `[\w-]` holds, and the characters
 * Python's `re.IGNORECASE` treats as one, over every code point Python assigns.
 */
interface Tables {
  unicode_version: string;
  reserved_terms: string[];
  rubrics: { rubric: string; named: string[] }[];
  assigned: [number, number][];
  word: [number, number][];
  cased: number[][];
}

const TABLES = JSON.parse(tablesSource) as Tables;

function* pointsOf(ranges: [number, number][]): Generator<number> {
  for (const [first, last] of ranges) {
    for (let point = first; point <= last; point += 1) {
      yield point;
    }
  }
}

describe("the rule the rubric line mirrors", () => {
  it("is `_mentions` as the gate writes it: word boundaries that count a hyphen, any case", () => {
    // Read rather than restated: a boundary that stopped counting the hyphen, or a match that
    // became case-sensitive, fails here before any row below is consulted.
    expect(judgeCapabilities).toContain(
      'return re.search(rf"(?<![\\w-]){re.escape(term)}(?![\\w-])", rubric, re.IGNORECASE) is not None',
    );
    // And the finding is raised once per term that matches, in the reserved terms' order.
    expect(judgeCapabilities).toMatch(/for term in terms\s+if _mentions\(rubric, term\)/);
  });

  it("is swept over a table that is not empty", () => {
    // A sweep over a set that silently became empty reports as passing (ADR 0023).
    expect(TABLES.reserved_terms.length).toBeGreaterThan(0);
    expect(TABLES.rubrics.length).toBeGreaterThan(40);
    expect(TABLES.rubrics.some((row) => row.named.length === 0)).toBe(true);
    expect(TABLES.rubrics.some((row) => row.named.length > 1)).toBe(true);
    expect(TABLES.cased.length).toBeGreaterThan(1000);
  });
});

describe("the reserved terms a rubric names", () => {
  it.each(TABLES.rubrics.map((row) => [JSON.stringify(row.rubric), row] as const))(
    "names what the gate names in %s",
    (_label, row) => {
      expect(namedTerms(row.rubric, TABLES.reserved_terms)).toEqual(row.named);
    },
  );

  it("escapes a term rather than reading it as a pattern", () => {
    // No reserved term carries a metacharacter today; one that did must still be literal.
    expect(rubricMentions("use c++ here", "c++")).toBe(true);
    expect(rubricMentions("use c++x here", "c++")).toBe(false);
    expect(rubricMentions("axb", "a.b")).toBe(false);
    expect(rubricMentions("x(y) and [z]", "x(y)")).toBe(true);
    expect(rubricMentions("a/b", "a/b")).toBe(true);
    expect(rubricMentions("$1", "$1")).toBe(true);
  });

  it("tries every start, so an occurrence its neighbours refuse hides none that overlaps it", () => {
    // `re.search` tries each position; a walk over non-overlapping matches would stop at the
    // first "x x" and never try the one it overlaps.
    expect(rubricMentions("x x-", "x x")).toBe(false);
    expect(rubricMentions("ax x x", "x x")).toBe(true);
    expect(rubricMentions("fakefake fake", "fake")).toBe(true);
  });
});

describe("the characters the boundary counts as part of a word", () => {
  it("is Python's `[\\w-]` at every code point Python assigns", () => {
    const word = new Set(pointsOf(TABLES.word));
    const mentionsFake = mentionMatcher("fake");
    const disagreements: string[] = [];
    let swept = 0;
    for (const point of pointsOf(TABLES.assigned)) {
      const character = String.fromCodePoint(point);
      const expected = !word.has(point);
      if (
        mentionsFake(`${character}fake`) !== expected ||
        mentionsFake(`fake${character}`) !== expected
      ) {
        disagreements.push(`U+${point.toString(16).toUpperCase().padStart(4, "0")}`);
      }
      swept += 1;
    }

    expect(swept).toBeGreaterThan(250_000);
    expect(disagreements).toEqual([]);
  });
});

describe("the characters the match treats as one without regard to case", () => {
  it("is Python's `re.IGNORECASE` between every pair of cased code points", () => {
    const classOf = new Map<number, number>();
    TABLES.cased.forEach((members, index) => {
      for (const member of members) {
        classOf.set(member, index);
      }
    });
    const cased = [...classOf.keys()];
    const disagreements: string[] = [];
    for (const term of cased) {
      const pattern = termPattern(String.fromCodePoint(term));
      for (const other of cased) {
        pattern.lastIndex = 0;
        if (
          pattern.test(String.fromCodePoint(other)) !==
          (classOf.get(term) === classOf.get(other))
        ) {
          disagreements.push(`U+${term.toString(16)} ~ U+${other.toString(16)}`);
        }
      }
    }

    expect(cased.length).toBeGreaterThan(2500);
    expect(disagreements).toEqual([]);
  });

  it("leaves out no pair of assigned code points that JavaScript itself treats as cased", () => {
    // The table's classes are Python's cased points. Two points Python assigns that JavaScript
    // changes into one another, missing from them, would be a pair the sweep above never tried.
    // A partner Python has not assigned is not one: ƛ has a capital in JavaScript's newer
    // database (U+A7DC) and none in Python's, and no rubric Python stores holds that capital as
    // anything but an unassigned character.
    const assigned = new Set(pointsOf(TABLES.assigned));
    const cased = new Set(TABLES.cased.flat());
    const missing: string[] = [];
    for (const point of assigned) {
      const character = String.fromCodePoint(point);
      for (const partner of [character.toLowerCase(), character.toUpperCase()]) {
        const partnerPoint = partner.codePointAt(0) ?? point;
        const single = Array.from(partner).length === 1;
        if (
          partner !== character &&
          single &&
          assigned.has(partnerPoint) &&
          !(cased.has(point) && cased.has(partnerPoint))
        ) {
          missing.push(`U+${point.toString(16)} ~ U+${partnerPoint.toString(16)}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
