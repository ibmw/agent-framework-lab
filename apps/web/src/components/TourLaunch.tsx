import { type Driver, driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Compass } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { TOURS, type TourId, type TourStep, tourAddressAt, tourAt, tourSteps } from "../lib/tours";
import { topBarControlClasses } from "../lib/ui";
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
 * The control is unconditional: every surface with a tour offers it, to everybody, always. It
 * used to be gated by guide mode — a lab-wide preference, derived from whether the lab held a
 * completed comparison. That mode was written for a guide that drew itself on screen unbidden,
 * and once every reading became an offer there was nothing left for it to protect: a lab filled
 * by `make seed` derived the mode off and hid the offer from precisely the reader who had not
 * found it yet (ADR 0046). A control that does nothing until it is pressed needs no opt-out.
 *
 * So this component reads nothing to decide whether to appear. It issues no request, consults no
 * stored preference, and renders the same on the first frame as on every one after it. The one
 * thing it does read is `prefers-reduced-motion`, and that is read when a tour starts rather than
 * when the control is drawn.
 *
 * The overlay itself is `driver.js`, skinned in this application's own tokens by the `.lab-tour`
 * block in `styles.css` rather than shipped as it comes (ADR 0045).
 *
 * There is one mount, in the top bar, and it takes no identifier: the surface's tour is resolved
 * from the location against the table that already names every surface's route, so the tour, its
 * address and its control are one row and no route file names a tour a second time (ADR 0055).
 * Where the location names no tour the control is *absent* rather than disabled, which is the
 * prototype's own `tourAvailable` branch: a disabled offer is one the application never intends
 * to honour.
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

/**
 * Align a step to the foot of the pinned header where the header covers its top.
 *
 * "Covered" is read off the scrolling pane's `scroll-padding-top`, which is exactly the room the
 * pinned header takes (and which is unset where no header is pinned); `block: "start"` honours
 * the same padding, so the step's top lands at the header's foot.
 */
function clearOfPinnedHeader(element: Element) {
  const pane = element.closest("main");
  if (pane === null) {
    return;
  }
  const clearance = Number.parseFloat(getComputedStyle(pane).scrollPaddingTop) || 0;
  if (element.getBoundingClientRect().top < pane.getBoundingClientRect().top + clearance - 1) {
    element.scrollIntoView({ block: "start" });
  }
}

export function TourLaunch() {
  const { pathname } = useLocation();
  const id = tourAt(pathname);
  // The hooks below belong to one tour, so the surface without one returns before any of them
  // rather than running them against an identifier it does not have.
  // Keyed by the address too: a surface behind tabs walks only the steps in scope on the tab
  // the reader stands on, so moving between tabs is a different walk, and one in progress ends.
  return id === null ? null : (
    <SurfaceTour key={`${id}@${tourAddressAt(id, pathname)}`} id={id} pathname={pathname} />
  );
}

function SurfaceTour({ id, pathname }: { id: TourId; pathname: string }) {
  const tour = TOURS[id];
  // The chain step is composed rather than declared, so what this walks is the table's
  // answer for this surface and not the rows as they were typed — and only the steps in scope
  // at this address (`TourStep.at`).
  const steps = useMemo(() => tourSteps(id, pathname), [id, pathname]);
  const active = useRef<Driver | null>(null);
  const launcher = useRef<HTMLButtonElement | null>(null);

  // One container per step, created once. `driver.js` discards its popover between steps, so a
  // container React owns has to outlive the popover that borrows it.
  const hosts = useMemo(() => steps.map(() => document.createElement("div")), [steps]);

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
      // `driver.js` scrolls a step's element into view only when it is outside the *window*,
      // and an element under a pinned header is inside the window and hidden all the same. So
      // the step is brought clear of the header twice over, both before anything is painted:
      //
      // - first `nearest`, which moves nothing already in view and measures "in view" against
      //   the pane's `scroll-padding-top` — the header's height (`lib/stickyHeader.ts`) — so
      //   the library's own check then finds a step that fits on screen and leaves it there;
      // - then, once the library has made its own scroll — synchronously, straight after this
      //   hook — a step taller than the room under the header, which the library has centred
      //   in the window and so pushed up under the header, is aligned to the header's foot.
      //   A microtask, so it lands before the frame the library draws its stage in: one jump.
      onHighlightStarted: (element) => {
        if (element === undefined) {
          return;
        }
        element.scrollIntoView({ block: "nearest" });
        queueMicrotask(() => clearOfPinnedHeader(element));
      },
      steps: steps.map((step, index) => ({
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
  }, [hosts, stop, steps]);

  return (
    <>
      {/* Rendered whether or not a tour is running: the containers are detached, so their
          content is in place before the popover measures itself against it, and an empty
          popover never has to be re-positioned afterwards. */}
      {hosts.map((host, index) =>
        createPortal(<TourBody step={steps[index]} />, host, `${id}-${index}`),
      )}
      <button
        ref={launcher}
        type="button"
        className={topBarControlClasses}
        onClick={start}
        // The words on the control are the same on every surface (ADR 0045); what differs is
        // what it says it would walk, which is the name and — as in the prototype — the tooltip.
        aria-label={`Show me around ${tour.surface}`}
        title={`Show me around ${tour.surface}`}
      >
        <Compass size={17} aria-hidden focusable="false" /> Show me around
      </button>
    </>
  );
}
