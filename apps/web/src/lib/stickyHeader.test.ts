import { afterEach, describe, expect, it } from "vitest";
import themeSource from "../styles.css?raw";
import {
  clearStickyHeader,
  clearStickyStrip,
  STICKY_REPORT_ATTRIBUTE,
  stickyHeaderClasses,
} from "./stickyHeader";

function token(name: string): string | undefined {
  return new RegExp(`--color-${name}:\\s*([^;]+);`).exec(themeSource)?.[1]?.trim();
}

describe("the pinned header's classes", () => {
  it("draw the prototype's header: the canvas over a 1px rule, held at the pane's edge", () => {
    const utilities = stickyHeaderClasses.split(" ");

    // `Workspace.dc.html`:207 — `background: #f6f6f7; border-bottom: 1px solid #e1e3e5`.
    expect(utilities).toEqual(
      expect.arrayContaining(["bg-admin-canvas", "border-b", "border-admin-border"]),
    );
    expect(token("admin-canvas")).toBe("#f6f6f7");
    expect(token("admin-border")).toBe("#e1e3e5");
    // Pulled up by `main`'s own `py-5`, which is where a sticky box is otherwise held.
    expect(utilities).toContain("-top-5");
    // Above the page it scrolls over, below the top bar's `z-20` and every dialog.
    expect(utilities).toContain("z-10");
  });

  it("pin the header only once it has been measured and found to fit", () => {
    const utilities = stickyHeaderClasses.split(" ");

    expect(utilities).toContain("data-[pinned=true]:sticky");
    // A bare `sticky` beside it would pin the header whatever it measured.
    expect(utilities).not.toContain("sticky");
  });
});

describe("clearing a pinned header", () => {
  let observed: ResizeObserverCallback | null = null;
  const watched = new Set<Element>();
  const RealResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    globalThis.ResizeObserver = RealResizeObserver;
    observed = null;
    document.body.replaceChildren();
  });

  function mount(height: number, paneHeight = 600) {
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observed = callback;
      }
      observe(target: Element) {
        watched.add(target);
      }
      unobserve() {}
      disconnect() {
        observed = null;
        watched.clear();
      }
    };
    const pane = document.createElement("main");
    pane.style.overflowY = "auto";
    const wrapper = document.createElement("div");
    const header = document.createElement("header");
    let current = height;
    let room = paneHeight;
    Object.defineProperty(header, "offsetHeight", { get: () => current });
    Object.defineProperty(pane, "clientHeight", { get: () => room });
    wrapper.append(header);
    pane.append(wrapper);
    document.body.append(pane);
    // Only what was observed reports a change, as a real observer does.
    const changed = (target: Element) => {
      if (watched.has(target)) {
        observed?.([{ target } as ResizeObserverEntry], {} as ResizeObserver);
      }
    };
    return {
      pane,
      header,
      resize(next: number) {
        current = next;
        changed(header);
      },
      resizePane(next: number) {
        room = next;
        changed(pane);
      },
    };
  }

  it("pins a header that takes a third of the pane or less, and clears it for what scrolls into view", () => {
    const { pane, header } = mount(112);

    const release = clearStickyHeader(header);

    expect(header.dataset.pinned).toBe("true");
    // Found by walking up past the wrapper to what actually scrolls.
    expect(pane.style.scrollPaddingTop).toBe("120px");
    release?.();
  });

  it("follows the header as it grows, and gives the pane back when the header goes", () => {
    const { pane, header, resize } = mount(112);

    const release = clearStickyHeader(header);
    resize(164);
    expect(pane.style.scrollPaddingTop).toBe("172px");

    release?.();
    expect(pane.style.scrollPaddingTop).toBe("");
    // Nothing is left listening to a header that has gone.
    expect(observed).toBeNull();
  });

  it("does not pin a header that would take more than a third of the pane, and asks for no clearance", () => {
    // 206 of 484px: the agent configuration editor at 200% zoom.
    const { pane, header } = mount(206, 484);

    const release = clearStickyHeader(header);

    expect(header.dataset.pinned).toBe("false");
    expect(pane.style.scrollPaddingTop).toBe("");
    release?.();
  });

  it("decides at exactly a third, and again whenever the pane changes size", () => {
    const { pane, header, resizePane } = mount(200, 600);

    const release = clearStickyHeader(header);
    expect(header.dataset.pinned).toBe("true");

    // A shorter window — or zooming in, which is the same thing to the pane — unpins it.
    resizePane(599);
    expect(header.dataset.pinned).toBe("false");
    expect(pane.style.scrollPaddingTop).toBe("");

    resizePane(900);
    expect(header.dataset.pinned).toBe("true");
    expect(pane.style.scrollPaddingTop).toBe("208px");
    release?.();
  });

  it("gives the same answer however often it is asked, pinned or not", () => {
    // The decision reads two sizes that pinning does not change, so asking again after an
    // unpin cannot flip it back: no oscillation.
    const { header, resize } = mount(300, 600);
    const release = clearStickyHeader(header);
    const answers = [header.dataset.pinned];
    for (let asked = 0; asked < 4; asked += 1) {
      resize(300);
      answers.push(header.dataset.pinned);
    }
    expect(answers).toEqual(["false", "false", "false", "false", "false"]);
    release?.();
  });

  it("decides on the header without its report row, and clears the whole of it", () => {
    // 1366×620 on the objective block editor: 166px of name, chips and actions against a pane
    // of 564, and a failure line that takes it to 189.5 — past the third — when Save fails.
    const { pane, header, resize } = mount(166, 564);
    header.style.rowGap = "5px";
    const report = document.createElement("div");
    report.setAttribute(STICKY_REPORT_ATTRIBUTE, "");
    let reportHeight = 0;
    Object.defineProperty(report, "offsetHeight", { get: () => reportHeight });
    header.append(report);

    const release = clearStickyHeader(header);
    expect(header.dataset.pinned).toBe("true");

    reportHeight = 18.5;
    resize(166 + 5 + 18.5);
    // Still held: the failure rides along with the header rather than unpinning it...
    expect(header.dataset.pinned).toBe("true");
    // ...and the pane clears the header as it now is, failure line included.
    expect(pane.style.scrollPaddingTop).toBe("197.5px");
    release?.();
  });

  it("still lets a header go whose name and actions alone take more than a third", () => {
    const { header } = mount(420, 788);
    const report = document.createElement("div");
    report.setAttribute(STICKY_REPORT_ATTRIBUTE, "");
    Object.defineProperty(report, "offsetHeight", { get: () => 95 });
    header.append(report);

    const release = clearStickyHeader(header);

    expect(header.dataset.pinned).toBe("false");
    release?.();
  });

  it("does not decide again when the header grows, only when the pane is resized", () => {
    // 960×420 on the customer editor: clean, its actions row fits and the header is pinned;
    // the first keystroke swaps "All changes saved" for Discard and Save, and the row wraps.
    const { pane, header, resize, resizePane } = mount(97, 300);

    const release = clearStickyHeader(header);
    expect(header.dataset.pinned).toBe("true");

    resize(141);
    // Past a third of the pane, and still held: the operator's own edit does not let it go...
    expect(header.dataset.pinned).toBe("true");
    // ...while the clearance follows the header as it now is.
    expect(pane.style.scrollPaddingTop).toBe("149px");

    // A resize of the pane is what asks again, on whatever the header then is.
    resizePane(301);
    expect(header.dataset.pinned).toBe("false");
    expect(pane.style.scrollPaddingTop).toBe("");
    release?.();
  });
});

describe("clearing the results sheet's pinned strip", () => {
  let observed: ResizeObserverCallback | null = null;
  const RealResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    globalThis.ResizeObserver = RealResizeObserver;
    observed = null;
    document.body.replaceChildren();
  });

  function mount(height: number) {
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observed = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        observed = null;
      }
    };
    const pane = document.createElement("main");
    pane.style.overflowY = "auto";
    const column = document.createElement("div");
    const strip = document.createElement("div");
    let current = height;
    Object.defineProperty(strip, "offsetHeight", { get: () => current });
    column.append(strip);
    pane.append(column);
    document.body.append(pane);
    return {
      pane,
      strip,
      resize(next: number) {
        current = next;
        observed?.([{ target: strip as Element } as ResizeObserverEntry], {} as ResizeObserver);
      },
    };
  }

  it("keeps what scrolls into view clear of the strip, and follows its height", () => {
    const { pane, strip, resize } = mount(41);

    const release = clearStickyStrip(strip);
    // The strip and the focus ring's clearance, on the pane that scrolls.
    expect(pane.style.scrollPaddingTop).toBe("49px");

    resize(60);
    expect(pane.style.scrollPaddingTop).toBe("68px");

    release?.();
    // A tab without the strip is not left with its clearance, nor anything listening.
    expect(pane.style.scrollPaddingTop).toBe("");
    expect(observed).toBeNull();
  });

  it("asks nothing of a page with no pane that scrolls", () => {
    const strip = document.createElement("div");
    document.body.append(strip);

    expect(clearStickyStrip(strip)).toBeUndefined();
    expect(clearStickyStrip(null)).toBeUndefined();
  });
});
