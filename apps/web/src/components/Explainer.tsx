import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { EXPLAINERS, type ExplainerId } from "../lib/explainers";
import { useGuideMode } from "../lib/guide";
import { labNoteClasses } from "../lib/ui";
import { GuideProse } from "./GuideProse";

/**
 * The inline explainer: what this screen is, in the lab's own words, while guide mode is on.
 *
 * It is the setup strip's band at a smaller size and with nothing to act on — these surfaces
 * are where the work is done, so a note above them that offered an action would be offering
 * the page underneath it. What it carries instead is vocabulary: the words this screen uses,
 * each one hovering the single definition `/guides/glossary` renders.
 *
 * Guide mode is the one from `lib/guide.ts` — derived from the record, overridden by an
 * operator's stored disagreement — and not a second mode of its own. An operator who turned
 * the guide off has turned this off too, on every surface at once (ADR 0044).
 */
export function Explainer({ id }: { id: ExplainerId }) {
  const on = useGuideMode();
  if (!on) {
    return null;
  }
  const explainer = EXPLAINERS[id];
  return (
    <section
      aria-label={`Guide note: ${explainer.title}`}
      className={`mb-4 flex items-start gap-3 border-l-[3px] border-l-lab-ink px-4 py-3 ${labNoteClasses}`}
    >
      <BookOpen className="mt-0.5 flex-none text-lab-ink" size={15} aria-hidden />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="text-[10.5px] font-bold tracking-[0.06em] text-lab-ink-soft uppercase">
          {explainer.title}
        </div>
        {explainer.body.map((paragraph, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: position is a paragraph's identity
          <GuideProse key={index} text={paragraph} />
        ))}
      </div>
      <Link
        className="flex-none text-[12.5px] font-semibold text-lab-ink underline-offset-2 hover:underline"
        to="/guides/setup"
      >
        Setup guide
      </Link>
    </section>
  );
}
