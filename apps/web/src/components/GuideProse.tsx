import { Link } from "react-router-dom";
import { glossaryTerm, parseGlossaryProse } from "../lib/glossary";

/**
 * Guide copy, with the words the glossary defines rendered as hover definitions.
 *
 * The copy itself is plain text carrying `[[term-id]]` references (`lib/glossary.ts`), which is
 * what lets a test read every word a tour step or a guide step sends a reader to the glossary for
 * and check that each of them resolves. A term that resolved to nothing would otherwise render as
 * a link to an anchor nobody wrote, which is exactly the failure ADR 0044 asked to be caught by a
 * test rather than by a reader.
 *
 * The definition shown on hover is the same sentence `/glossary` renders — there is one copy
 * of it, in the module both read.
 */

/**
 * One defined word, in the sentence that uses it.
 *
 * The hover definition is the element's own `title`, which the browser places and which no
 * surface can clip. A panel of this project's own would have to be positioned against a word
 * that can sit anywhere on a line, inside cards that hide their overflow and a content column
 * that scrolls — and the first thing it would need is a layout rule this slice is not entitled
 * to invent (ADR 0044). Hover is also not the only way in: the word is a link to its full
 * entry, so a reader with no pointer, or one who wants the rest of the vocabulary, gets there
 * the ordinary way.
 */
export function GlossaryTermLink({ id, label }: { id: string; label: string }) {
  const term = glossaryTerm(id);
  if (term === undefined) {
    // Unreachable while the tests over this copy hold; rendering the bare word is still better
    // than rendering a link into the glossary that lands nowhere.
    return <>{label}</>;
  }
  return (
    <Link
      className="font-semibold text-lab-ink underline decoration-dotted underline-offset-2"
      title={`${term.term} — ${term.definition}`}
      to={`/glossary#${term.id}`}
    >
      {label}
    </Link>
  );
}

/** A paragraph of guide copy: prose, with its defined words hovered. */
export function GuideProse({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className ?? "text-[12.5px] leading-relaxed text-admin-ink-soft"}>
      {parseGlossaryProse(text).map((segment, index) =>
        typeof segment === "string" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity of a segment
          <span key={index}>{segment}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same word may occur twice
          <GlossaryTermLink key={index} id={segment.id} label={segment.label} />
        ),
      )}
    </p>
  );
}
