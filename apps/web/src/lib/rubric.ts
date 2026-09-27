/**
 * Which reserved terms a rubric names, as the lab's anonymity gate reads it.
 *
 * `_mentions` in `application/judge_capabilities.py` is the rule:
 * `re.search(rf"(?<![\w-]){re.escape(term)}(?![\w-])", rubric, re.IGNORECASE)` — a term
 * counts when neither neighbour is a word character or a hyphen, in any case. `rubric_names_an_arm`
 * is raised once per term that matches, and the terms are the served `reserved_terms`, so the
 * editor names the same terms the gate will without keeping a list of its own.
 *
 * Two things in that pattern are Python's rather than the regular-expression language's, and
 * each is reproduced here from an enumeration rather than by analogy
 * (`apps/api/tests/fixtures/rubric_mentions.json`, which `rubric.test.ts` sweeps):
 *
 * - **`\w` is Unicode's.** JavaScript's `\w` is ASCII even under `u`; Python's is every
 *   alphanumeric (`str.isalnum`) and the underscore. `[\p{L}\p{N}_]` is that set at every code
 *   point Python's database assigns — combining marks are in neither. Where the two databases
 *   differ is only at code points Python has not assigned yet, which no rubric Python stores can
 *   hold as anything but an unassigned character.
 * - **`re.IGNORECASE` is simple case folding, plus one class.** JavaScript's `iu` matches the
 *   same pairs at every cased code point but four: Python also holds `İ` (U+0130) and `ı`
 *   (U+0131) to be `i` and `I`, which simple folding does not. A term's `i` or `I` is therefore
 *   written as that class.
 */

/**
 * Python's `[\w-]`, tested on one character and never case-folded.
 *
 * Not inside the term's pattern: a JavaScript `i` flag folds a character class too, so U+0345
 * (COMBINING GREEK YPOGEGRAMMENI, which folds to ι) would count as a letter beside a term,
 * where Python's `\w` — a category test that `re.IGNORECASE` leaves alone — does not. The
 * boundary is therefore read here, apart from the case-insensitive match of the term itself.
 */
const WORD = /^[\p{L}\p{N}_-]$/u;

/** Python's case class for `i`, which JavaScript's simple case folding splits in three. */
const DOTTED_I_CLASS = "[iI\u0130\u0131]";

/** What `re.escape` escapes, as far as a JavaScript `u` pattern must: its syntax characters. */
function escapeCharacter(character: string): string {
  if ("iI\u0130\u0131".includes(character)) {
    return DOTTED_I_CLASS;
  }
  return /[\\^$.*+?()[\]{}|/]/.test(character) ? `\\${character}` : character;
}

/** The term alone, matched without regard to case as `re.IGNORECASE` matches it. */
export function termPattern(term: string): RegExp {
  // By code point, so a term outside the Basic Multilingual Plane is one character, as in Python.
  return new RegExp(Array.from(term, escapeCharacter).join(""), "giu");
}

/** The code point that ends just before `index`, or "" at the start. */
function pointBefore(text: string, index: number): string {
  if (index === 0) {
    return "";
  }
  const low = text.charCodeAt(index - 1);
  const high = index >= 2 ? text.charCodeAt(index - 2) : 0;
  const pair = low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff;
  return text.slice(pair ? index - 2 : index - 1, index);
}

/** The code point that starts at `index`, or "" at the end. */
function pointAt(text: string, index: number): string {
  const point = text.codePointAt(index);
  return point === undefined ? "" : String.fromCodePoint(point);
}

/**
 * A matcher for one term: whether a rubric names it as a word rather than inside a longer one.
 *
 * Every start position is tried, as `re.search` tries them, rather than only the non-overlapping
 * matches a global search walks: an occurrence refused by its neighbours must not hide one that
 * overlaps it and is not.
 */
export function mentionMatcher(term: string): (rubric: string) => boolean {
  const pattern = termPattern(term);
  return (rubric) => {
    pattern.lastIndex = 0;
    for (let found = pattern.exec(rubric); found !== null; found = pattern.exec(rubric)) {
      const end = found.index + found[0].length;
      if (!WORD.test(pointBefore(rubric, found.index)) && !WORD.test(pointAt(rubric, end))) {
        return true;
      }
      // One code point on, and never zero: an empty match would otherwise be found forever.
      pattern.lastIndex = found.index + Math.max(1, pointAt(rubric, found.index).length);
    }
    return false;
  };
}

/** Whether a rubric names a term as a word rather than inside a longer one. */
export function rubricMentions(rubric: string, term: string): boolean {
  return mentionMatcher(term)(rubric);
}

/** The reserved terms a rubric names, in the order the gate raises them: the order served. */
export function namedTerms(rubric: string, terms: readonly string[]): string[] {
  return terms.filter((term) => rubricMentions(rubric, term));
}
