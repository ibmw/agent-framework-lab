import { Link } from "react-router-dom";
import { Card } from "../components/WorkspaceChrome";
import { GLOSSARY_TERMS } from "../lib/glossary";
import { LabSurface, useLabSurface } from "../shell/LabSurface";

/**
 * The lab's vocabulary, rendered from the one module that carries it.
 *
 * These words are `docs/PLAN.md`'s stable target vocabulary, which until now was defined
 * nowhere a reader of the application could reach. The page holds no definitions of its own:
 * a term has one definition, and the explainers that will hover it read the same module
 * (ADR 0044).
 */
export function GlossaryPage() {
  const surface = useLabSurface();
  return (
    <LabSurface
      surface={surface}
      title="Glossary"
      description="The words this application uses on screen. Several of them mean something narrower here than they do in a commerce admin, and the difference is usually what an experiment pins."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,760px)]">
        <Card title="Vocabulary">
          <dl className="grid gap-3">
            {GLOSSARY_TERMS.map((entry) => (
              <div
                key={entry.id}
                className="grid gap-1 border-b border-admin-border pb-3 last:border-b-0 last:pb-0"
              >
                <dt id={entry.id} className="text-[13px] font-semibold text-admin-ink">
                  {entry.term}
                </dt>
                <dd className="text-[13px] leading-relaxed text-admin-ink-soft">
                  {entry.definition}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <p className="text-[13px] text-admin-ink-soft">
          <Link
            className="font-semibold text-lab-ink underline-offset-2 hover:underline"
            to="/guides"
          >
            Back to guides
          </Link>
        </p>
      </div>
    </LabSurface>
  );
}
