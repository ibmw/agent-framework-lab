import { Link } from "react-router-dom";
import { Card } from "../components/WorkspaceChrome";
import { GLOSSARY_TERMS } from "../lib/glossary";
import { SETUP_CHAIN } from "../lib/setupPath";
import { LabSurface, useLabSurface } from "../shell/LabSurface";

/**
 * What the lab can explain about itself: the chain, and the words it speaks along the way.
 *
 * Two guides ADR 0044 names — reading a comparison, and replay and fork — are deliberately not
 * written yet. Saying so is better than an index that implies a page exists behind every idea.
 */
export function GuidesPage() {
  const surface = useLabSurface();
  return (
    <LabSurface
      surface={surface}
      title="Guides"
      description="The path from an empty database to a two-arm comparison, and the words the application uses along the way — beside the lab's settings rather than inside a shop."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,640px)]">
        <Card title="From nothing to a two-arm comparison">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            The whole chain in dependency order: {SETUP_CHAIN.length} steps from an empty database
            to an experiment you have driven yourself, each one explaining what it is and what
            refuses until it is satisfied. It opens with the fast path —{" "}
            <code className="font-mono">make seed</code>, a command to run in a terminal, which
            fills an empty database with one complete worked example.
          </p>
          <p className="text-[13px]">
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/guides/setup"
            >
              Open the setup guide
            </Link>
          </p>
        </Card>

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

        <Card title="Guide mode">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            With guide mode on, the screens whose vocabulary is particular to this lab — each shop's
            home, the two block libraries, the scenario editor, the starting states, the bench and
            the results — offer to show you around: a short walk through that one screen, lighting
            one thing at a time and saying what it is in the lab's own words. Nothing starts on its
            own, no tour crosses a screen, and nothing about where you got to is stored.
          </p>
          <p className="text-[13px] text-admin-ink-soft">
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to="/settings"
            >
              Lab settings
            </Link>{" "}
            reports what this build can run, and is where guide mode is turned on or off for every
            screen at once.
          </p>
        </Card>
      </div>
    </LabSurface>
  );
}
