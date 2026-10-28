import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The interface copy is American English (PLAN-UX Milestone 13): *behavior*, *color*,
 * *labeled*, *fulfillment*.
 *
 * Enumerated, not listed: every `.ts` and `.tsx` file under `src` that is not a test or a test
 * helper is parsed, and every string it ships — a string literal, each piece of a template, and
 * the text between JSX tags — is read for the British forms. Comments are not strings, so they
 * are never read, and identifiers are not either: a name such as `mark_colour` is the contract's
 * and stays as the contract spells it. A string that is wholly a key is skipped for the same
 * reason — one joined like `"mark_colour"` or `-mark-colour` anywhere, and a bare word such as
 * `"fulfilment"` only where the source puts it in a key's place — and one that carries the
 * word inside copy is not.
 */

const sources = import.meta.glob(
  ["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx", "!../test/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** A British form anywhere in a string: "colour-coded", "coloured" and "well-labelled" too. */
const BRITISH = /behaviour|colour|labell|fulfilment/i;

/**
 * A string that is a key and nothing else — `mark_colour`, `-mark-colour`, a finding code, a
 * field path — is the contract's spelling, not copy. It is joined by `_`, `.` or `-`, which
 * prose of one word never is.
 */
const KEY_SHAPED = /^-?[a-z0-9]+([_.-][a-z0-9]+)+$/;

/**
 * A bare lowercase word is a key only where the source puts it in a key's place: a literal type
 * (`OrderContentSchema["fulfilment"]`), an index, a property's name, or one of the JSX
 * attributes below, none of which a reader is shown. Anywhere else — a label, a title, the text
 * between tags — the same word is copy, and is read.
 */
const BARE_WORD = /^[a-z0-9]+$/;
const KEY_ATTRIBUTES = new Set(["tone", "key", "id", "data-tour"]);

function inKeyPosition(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isLiteralTypeNode(parent) ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isJsxAttribute(parent) && KEY_ATTRIBUTES.has(parent.name.getText()))
  );
}

interface Finding {
  file: string;
  line: number;
  text: string;
  keyPosition: boolean;
}

function shippedStrings(file: string, source: string): Finding[] {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      found.push({ file, line: line + 1, text: node.text, keyPosition: inKeyPosition(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const strings = Object.entries(sources).flatMap(([file, source]) => shippedStrings(file, source));

describe("the interface's spelling", () => {
  it("reads the shipped source, and its copy with it", () => {
    // A sweep that read nothing would pass anything: it must see the files and the copy in them.
    expect(Object.keys(sources)).toContain("./comparison.ts");
    expect(Object.keys(sources)).toContain("../routes/ScenarioEditorPage.tsx");
    expect(Object.keys(sources).some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
    expect(strings.some(({ text }) => text.includes("so the behavior here is attributable"))).toBe(
      true,
    );
  });

  it("ships no string spelled behaviour, colour, labelled or fulfilment", () => {
    const british = strings
      .filter(
        ({ text, keyPosition }) =>
          BRITISH.test(text) && !KEY_SHAPED.test(text) && !(keyPosition && BARE_WORD.test(text)),
      )
      .map(({ file, line, text }) => `${file}:${line}: ${text}`);
    expect(british).toEqual([]);
  });
});
