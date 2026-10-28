/**
 * The header that stays at the top of the scrolling pane while the page under it scrolls: a
 * create page's, and an editor's (`Workspace.dc.html`:207, :387, :890).
 *
 * The prototype draws it `position: sticky; top: 0` on the canvas `#f6f6f7` with a 1px
 * `#e1e3e5` rule under it, 16px tall padding. It is pulled out to the scrolling pane's own
 * edges — `main` pads its content `px-6 py-5` — so the rule spans the width the prototype draws
 * it at rather than stopping inside the page's gutter, and so the header rests flush with the
 * pane's top rather than 20px below it. The top pull applies only where the header is the pane's
 * first child: a workspace that prints its own error line above the page would otherwise have
 * the header's opaque ground drawn over the bottom of that line.
 *
 * It sticks at `-top-5` rather than `top-0` because a sticky box is held inside its scrolling
 * pane's *padding*, not at the pane's edge: at `top: 0` it stopped 20px down, under `main`'s own
 * `py-5`, and the page scrolled past visibly in the strip above it. Pulled up by the padding it
 * pulls its own resting place up by, it meets the top bar as the prototype draws it, whose pane
 * has no padding of its own.
 *
 * `z-10` puts it above the page it scrolls over and below everything that is meant to cover
 * the page: the top bar and its shop menu (`z-20`, outside the pane), the unsaved-changes dialog
 * (`z-50`, fixed), and the tour's overlay, which `driver.js` draws at a z-index in the
 * thousands.
 *
 * **It holds only while its name and actions take a third of the pane or less.** An editor's
 * header wraps to three and four rows where the pane is narrow, and pinned in a short or narrow
 * pane it would leave the page a letterbox — nearly half the pane on a phone. So
 * `clearStickyHeader` measures the header, less what its actions report, against the pane it
 * would cover and pins it only where that takes a third or less; otherwise it scrolls away with
 * the page, as every other header does, and the page reflows instead of being covered (WCAG
 * 1.4.10). Until it has been measured it is not pinned. The prototype, drawn for one desktop
 * frame, is silent here (ADR 0066).
 */
const pinnedGroundClasses =
  "data-[pinned=true]:sticky -top-5 z-10 border-b border-admin-border bg-admin-canvas";

export const stickyHeaderClasses = `${pinnedGroundClasses} -mx-6 first:-mt-5 px-6 py-4`;

/** The most of its pane a header may cover and still be pinned. */
export const MAX_PINNED_SHARE = 1 / 3;

/**
 * What a focused control keeps between itself and the header's rule: the pine focus ring's 2px
 * offset and 2px width, and as much again, so the ring is never drawn against the rule.
 */
const FOCUS_CLEARANCE_PX = 8;

function scrollingAncestor(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") {
      return parent;
    }
  }
  return null;
}

/**
 * The attribute a header's report rows carry: the lines its actions say about themselves — a
 * refusal, a failure, a published version — which come and go with every press.
 */
export const STICKY_REPORT_ATTRIBUTE = "data-sticky-report";

/**
 * The header's height without its report rows: the name, the chips, the actions and the
 * description, which is the part whose height does not move when a press is made.
 *
 * Pinning is decided on this and not on the whole header, because the whole header grows
 * exactly when a press fails: an operator at the foot of a long page presses Save, the error
 * line appears beside it, and a header decided on its full height would cross the limit on that
 * line and scroll away — taking Save and the error with it, at the one moment both are needed.
 * A report row also comes and goes ("Checking the draft…", a line under Publish), so a header
 * decided on it could flap near the limit. Each row is taken out with the gap before it.
 */
function steadyHeight(header: HTMLElement): number {
  const reports = header.querySelectorAll<HTMLElement>(`:scope > [${STICKY_REPORT_ATTRIBUTE}]`);
  if (reports.length === 0) {
    return header.offsetHeight;
  }
  const gap = Number.parseFloat(getComputedStyle(header).rowGap) || 0;
  let steady = header.offsetHeight;
  for (const report of reports) {
    if (report.offsetHeight > 0) {
      steady -= report.offsetHeight + gap;
    }
  }
  return steady;
}

/**
 * A ref callback for a sticky header: it decides whether the header may hold, and keeps what the
 * browser scrolls into view clear of it when it does.
 *
 * **Whether it holds** is decided when the header mounts and again whenever the *pane* changes
 * size — a resized window, a zoom, the rail collapsing — and at no other time. It is the header's
 * steady height, without its report rows, against the pane's: a third or less and it is pinned
 * (`data-pinned="true"`, which is what makes it `sticky`), more and it is not.
 *
 * It is not decided again when the header's own height changes, because the header's height
 * follows the editor's state: going dirty swaps "All changes saved" for Discard and Save, which
 * wraps the actions row on a narrow pane (97 to 141px on most editors), and a save swaps it back.
 * Re-decided on that, a header near the limit pinned while clean and let go on the first
 * keystroke — the operator's Save leaving the screen at the moment it appeared. So the accepted
 * consequence is the other way round: a header that grows after it was pinned — dirty, a report
 * row — stays pinned until the pane is resized, when the decision is made again on whatever the
 * header then is. Nothing the operator does inside the page can flip it, and pinning cannot flip
 * itself: a sticky box and a static one take the same room, so the answer never changes the
 * measurement it was made on.
 *
 * **The clearance.** A pinned header covers the top of its scrolling pane, so a control a
 * keyboard reader tabs up to, or that anything else scrolls into view, would be revealed
 * underneath it — focus that is entirely hidden, which WCAG 2.2's 2.4.11 *Focus Not Obscured*
 * refuses. The pane's `scroll-padding-top` is what every scroll-into-view honours, so it is kept
 * at the header's whole height, report rows included, plus the focus ring — following every
 * change of the header's height, which is what the header is observed for. An unpinned header
 * covers nothing and asks for none.
 *
 * It writes to the pane rather than to the page because the pane is what scrolls, and it puts
 * the pane back as it found it when the header goes, so an index that draws no sticky header is
 * not left with the last editor's clearance.
 */
export function clearStickyHeader(header: HTMLElement | null): (() => void) | undefined {
  if (header === null) {
    return undefined;
  }
  const pane = scrollingAncestor(header);
  if (pane === null) {
    return undefined;
  }
  const decide = () => {
    header.dataset.pinned = String(steadyHeight(header) <= pane.clientHeight * MAX_PINNED_SHARE);
  };
  const clear = () => {
    if (header.dataset.pinned === "true") {
      pane.style.scrollPaddingTop = `${header.offsetHeight + FOCUS_CLEARANCE_PX}px`;
    } else {
      pane.style.removeProperty("scroll-padding-top");
    }
  };
  decide();
  clear();
  const observer = new ResizeObserver((entries) => {
    // The pane's size decides; the header's only moves the clearance.
    if (entries.some((entry) => entry.target === pane)) {
      decide();
    }
    clear();
  });
  observer.observe(header);
  observer.observe(pane);
  return () => {
    observer.disconnect();
    pane.style.removeProperty("scroll-padding-top");
  };
}

/**
 * A ref callback for a strip pinned over the page rather than a header: the results sheet's arm
 * strip (ADR 0080). It is always pinned — one line, so it never letterboxes a pane the way a
 * wrapped header could — and it keeps what the browser scrolls into view clear of it, as
 * `clearStickyHeader` does: the pane's `scroll-padding-top` is the strip's height and the focus
 * ring's clearance, following the strip's height, so a focused control, a chip's jump to its
 * section and a tour step land under the strip rather than behind it (WCAG 2.2's 2.4.11).
 *
 * It puts the pane back as it found it when the strip goes, so a tab without a strip is not left
 * with the sheet's clearance. Where the pane is not found — jsdom, which lays nothing out — or the
 * browser has no `ResizeObserver`, it does nothing.
 */
export function clearStickyStrip(strip: HTMLElement | null): (() => void) | undefined {
  if (strip === null || typeof ResizeObserver === "undefined") {
    return undefined;
  }
  const pane = scrollingAncestor(strip);
  if (pane === null) {
    return undefined;
  }
  const clear = () => {
    pane.style.scrollPaddingTop = `${strip.offsetHeight + FOCUS_CLEARANCE_PX}px`;
  };
  clear();
  const observer = new ResizeObserver(clear);
  observer.observe(strip);
  return () => {
    observer.disconnect();
    pane.style.removeProperty("scroll-padding-top");
  };
}
