/**
 * Text as the lab reads it, where Python and JavaScript disagree about what whitespace is.
 *
 * The lab's rules are written in Python: `require_label` refuses a name that `str.strip()`
 * empties or changes, `require_text` a text that `str.strip()` changes. A page that checks or
 * trims with JavaScript's `trim()` agrees with them on ordinary spaces and disagrees at the
 * edges, so it passes what the lab refuses. Every such check reads this module instead.
 */

/**
 * Python's `str.isspace()` set, which `str.strip()` removes and JavaScript's `trim()` does not
 * match: it includes the four information separators `\x1c`–`\x1f` and NEL `\x85`, and it
 * excludes the byte-order mark `\ufeff`, which `trim()` removes and the server keeps.
 */
const PYTHON_WHITESPACE =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PYTHON_STRIP = new RegExp(`^[${PYTHON_WHITESPACE}]+|[${PYTHON_WHITESPACE}]+$`, "g");

/** `value` with what Python's `str.strip()` removes taken off both ends, as the server strips it. */
export function pythonStrip(value: string): string {
  return value.replace(PYTHON_STRIP, "");
}
