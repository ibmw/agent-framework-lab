import { Link } from "react-router-dom";
import { Card } from "../components/WorkspaceChrome";
import { GLOSSARY_TERMS } from "../lib/glossary";
import { LabSurface, useLabSurface } from "../shell/LabSurface";

/**
 * What the lab can currently explain about itself: the vocabulary, and where the next step
 * comes from.
 *
 * The written setup guide — the whole chain in dependency order, with `make seed` named as the
 * fast path at its top — is the piece of work after this one. Saying so is better than a page
 * that implied the guide is here.
 */
export function GuidesPage() {
  const surface = useLabSurface();
  return (
    <LabSurface
      surface={surface}
      title="Guides"
      description="The path from an empty database to a two-arm comparison, and the words the application uses along the way — beside the lab's settings rather than inside a shop."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)]">
        <Card title="Glossary">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            {GLOSSARY_TERMS.length} terms: what a definition, a block, a snapshot, an arm and a
            judge mean in this lab. Several of them are narrower here than they are in a commerce
            admin, and the difference is usually what an experiment pins.
          </p>
          <p className="text-[13px]">
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/guides/glossary"
            >
              Open the glossary
            </Link>
          </p>
        </Card>

        <Card title="The setup path">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            With guide mode on, a band at the top of the shops index and each shop's home names the
            one step that unblocks the chain, with the publish gate's own reason underneath when
            something is blocking it. Nothing about that reading is stored: a step is complete
            because the thing it asks for exists in a listing, so a lab filled by hand and one
            filled in a different order read the same.
          </p>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            The written walk-through of that chain — eight kinds of definition and twelve published
            versions in dependency order — is the next piece of work rather than something this
            build already does. Until it lands,{" "}
            <code className="font-mono">docs/development.md</code> documents{" "}
            <code className="font-mono">make seed</code>, which fills an empty database with one
            complete worked example, and the three commands that reset it. Run it in a terminal:
            there is no button anywhere in this application that populates the lab, and a running
            lab must never be one request away from being overwritten with a fixture.
          </p>
          <p className="text-[13px] text-admin-ink-soft">
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/settings"
            >
              Lab settings
            </Link>{" "}
            reports what this build can run, and carries the same guide-mode choices the band
            offers.
          </p>
        </Card>
      </div>
    </LabSurface>
  );
}
