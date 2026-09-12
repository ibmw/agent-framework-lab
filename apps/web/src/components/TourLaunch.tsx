import { type Driver, driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Compass } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useGuideMode } from "../lib/guide";
import { TOURS, type TourId, type TourStep } from "../lib/tours";
import { subtleButtonClasses } from "../lib/ui";
import { GuideProse } from "./GuideProse";

/**
 * The control that shows an operator around the screen they are already standing on.
 *
 * Nothing starts unbidden: there is no first-run tour, no auto-start, and no walk that crosses a
 * route. A tour is launched from the surface it describes, which is also the proof that the
 * surface exists — a walkthrough spanning routes would have to navigate for the reader and hold
 * its position across the move, and the second of those is the stored progress ADR 0044 refused
 * and ADR 0045 still refuses.
 *
 * Guide mode is the one from `lib/guide.ts` — derived from the record, overridden by an
 * operator's stored disagreement — and not a second mode. An operator who turned the guide off
 * turned these controls off on every surface at once, and a stored disagreement answers without
 * reading anything at all.
 *
 * The overlay itself is `driver.js`, skinned in this application's own tokens by the `.lab-tour`
 * block in `styles.css` rather than shipped as it comes (ADR 0045).
 */

/**
 * One step's copy, rendered by React into a container the popover borrows.
 *
 * `driver.js` builds a fresh popover for every step and writes its description as HTML, so the
 * copy cannot simply be handed over as a string without losing the glossary. Each step instead
 * owns a detached container that React keeps filled, and the popover is given that container to
 * hold; the words a tour sends a reader to look up are therefore rendered by `GuideProse` — the
 * one renderer of guide copy — exactly as they were inside an explainer.
 *
 * Nothing is added here that `lib/tours.ts` did not declare. A popover shows that step's
 * paragraphs and nothing else, so the table stays the only place a tour is written down and
 * every word a reader sees is covered by the copy tests over it.
 */
function TourBody({ step }: { step: TourStep }) {
  return (
    <>
      {step.body.map((paragraph, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: position is a paragraph's identity
        <GuideProse key={index} text={paragraph} className="lab-tour-paragraph" />
      ))}
    </>
  );
}

export function TourLaunch({ id }: { id: TourId }) {
  const on = useGuideMode();
  const tour = TOURS[id];
  const active = useRef<Driver | null>(null);
  const launcher = useRef<HTMLButtonElement | null>(null);

  // One container per step, created once. `driver.js` discards its popover between steps, so a
  // container React owns has to outlive the popover that borrows it.
  const hosts = useMemo(() => tour.steps.map(() => document.createElement("div")), [tour.steps]);

  const stop = useCallback(() => {
    active.current?.destroy();
    active.current = null;
  }, []);

  // Leaving the surface takes the overlay with it. A popover pinned to a page that has been
  // routed away from would be the staleness this pattern is on probation for.
  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    stop();
    const instance = driver({
      popoverClass: "lab-tour",
      // The lab's own pine, read from the token rather than restated as a hex literal.
      overlayColor: "var(--color-lab-ink)",
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      // `driver.js` tweens the stage cut-out from JavaScript rather than from CSS, so the
      // reduced-motion rule in `styles.css` cannot reach it and the preference has to be read.
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      showProgress: true,
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      steps: tour.steps.map((step, index) => ({
        element: step.anchor,
        popover: {
          title: step.title,
          // Non-empty so the description element is shown at all; what it actually holds is the
          // container below, which React has already filled.
          description: " ",
          onPopoverRender: (popover) => popover.description.replaceChildren(hosts[index]),
        },
      })),
      // Escape, the close button and a click on the dim all arrive here, and a tour dismissed by
      // any of them has to give the keyboard back. `driver.js` restores focus to the element it
      // bookmarked last, and it overwrites that bookmark on every step move with the popover
      // button that was just clicked — a node it then removes — so a tour that was stepped
      // through leaves focus on the document, and a reader who pressed Escape is back at the top
      // of the page with no idea where. They came from this control, so they are put back on it,
      // in a microtask because the library restores focus itself after this hook returns.
      //
      // This hook rather than `onDestroyed`, which 1.8.0 skips whenever it has already cleared
      // its active step — which is exactly the stepped-through case. Taking it means owning the
      // teardown it would otherwise do, which is what `stop` is. A programmatic destroy does not
      // come through here, and should not: that is the surface unmounting or a tour being
      // restarted, and neither is a dismissal.
      onDestroyStarted: () => {
        stop();
        queueMicrotask(() => launcher.current?.focus());
      },
      onDestroyed: () => {
        active.current = null;
      },
    });
    active.current = instance;
    instance.drive();
  }, [hosts, stop, tour.steps]);

  return (
    <>
      {/* Rendered whether or not a tour is running, and whether or not one can be: the
          containers are detached, so their content is in place before the popover measures
          itself against it, and an empty popover never has to be re-positioned afterwards. */}
      {hosts.map((host, index) =>
        createPortal(<TourBody step={tour.steps[index]} />, host, `${id}-${index}`),
      )}
      {on ? (
        <button
          ref={launcher}
          type="button"
          className={subtleButtonClasses}
          onClick={start}
          aria-label={`Show me around ${tour.surface}`}
        >
          <Compass size={13} aria-hidden /> Show me around
        </button>
      ) : null}
    </>
  );
}
