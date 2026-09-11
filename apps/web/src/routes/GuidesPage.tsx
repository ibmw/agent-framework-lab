import { Link } from "react-router-dom";
import { Card } from "../components/WorkspaceChrome";
import { LabSurface, useLabSurface } from "../shell/LabSurface";

/**
 * The route placement and its shell, and deliberately nothing else yet.
 *
 * The guides themselves — the derived next step, the explainers and the glossary — arrive in
 * the two slices after this one. A page that fake-populated them now would be promising a
 * reader something this build does not do, which is the one thing a guide must never do.
 */
export function GuidesPage() {
  const surface = useLabSurface();
  return (
    <LabSurface
      surface={surface}
      title="Guides"
      description="Where the written path from an empty database to a two-arm comparison will live, beside the lab's settings rather than inside a shop."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)]">
        <Card title="Not written yet">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            There are no guides on this page yet. Setting up a lab by hand means eight kinds of
            definition and twelve published versions in dependency order, and writing that down is
            the next piece of work rather than something this build already does.
          </p>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            What lands here next is a setup guide covering that chain, a next step derived from what
            the lab already holds rather than from stored progress, and a glossary of the words the
            application uses on screen. Until then,{" "}
            <code className="font-mono">docs/development.md</code> documents{" "}
            <code className="font-mono">make seed</code>, which fills an empty database with one
            complete worked example, and the three commands that reset it.
          </p>
          <p className="text-[13px] text-admin-ink-soft">
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/settings"
            >
              Lab settings
            </Link>{" "}
            reports what this build can run in the meantime.
          </p>
        </Card>
      </div>
    </LabSurface>
  );
}
