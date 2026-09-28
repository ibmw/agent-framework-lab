import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Card,
  GateCard,
  PageHeader,
  PublishButton,
  type PublishGate,
  PublishReasons,
} from "./components/WorkspaceChrome";
import { PUBLISH_UNSAVED_REASON } from "./lib/definitionEditor";
import { STICKY_REPORT_ATTRIBUTE, stickyHeaderClasses } from "./lib/stickyHeader";
import { expectBusy, expectNotRefused, expectRefused } from "./test/refused";

/**
 * The workspace's display type, measured.
 *
 * Two headings carry it and nothing in the browser can see whether they still do: a title that
 * silently returns to the sans stack renders perfectly, passes every journey, and is simply the
 * wrong typeface for however long it takes someone to notice. So the numbers are asserted here
 * against `tmp/design-frames/README.md`, *Type* — page titles Georgia 24–27px 700, card titles
 * Georgia 17–18px 700 — and against the prototype for where in each range this workspace's one
 * `PageHeader` and one `Card` land.
 *
 * The two structural facts the type must not disturb are held down in the same queries: the page
 * name is the `h1` the first step of every tour anchors on through `data-tour="page-name"`, and a
 * card's title is an `h2`. Type changes neither.
 */

describe("the page title", () => {
  it("is the level-1 heading the tour anchors on", () => {
    render(<PageHeader title="Tone of voice" />);

    const title = screen.getByRole("heading", { level: 1, name: "Tone of voice" });

    expect(title).toHaveAttribute("data-tour", "page-name");
  });

  it("is drawn in the display face at the prototype's 24px", () => {
    render(<PageHeader title="Tone of voice" />);

    const title = screen.getByRole("heading", { level: 1 });

    expect(title.className).toContain("font-display");
    expect(title.className).toContain("text-2xl");
    expect(title.className).toContain("font-bold");
    expect(title.className).toContain("tracking-[-0.015em]");
    // A size left beside the new one is the shape a half-revert takes; `text-2xl` is not one of
    // the words below, so this holds the title to exactly one size.
    expect(title.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});

describe("an editor's header", () => {
  function EditorHeader({ sticky }: { sticky?: boolean }) {
    return (
      <main>
        <PageHeader
          title="Frontline A"
          chips={<span>Draft v2 in progress</span>}
          actions={
            <>
              <button type="button">Save draft</button>
              <button type="button">Publish v2</button>
            </>
          }
          reasons={<p>Save the draft first.</p>}
          description="Shop-independent."
          sticky={sticky}
        />
        <p>The page it heads.</p>
      </main>
    );
  }

  it("reads its name, its actions, why one is refused, then what the page is, in that order", () => {
    render(<EditorHeader sticky />);

    const header = screen.getByRole("heading", { level: 1, name: "Frontline A" }).closest("header");
    if (header === null) {
      throw new Error("the page name is not in a header");
    }

    const inOrder = [
      screen.getByRole("heading", { level: 1 }),
      screen.getByRole("button", { name: "Save draft" }),
      screen.getByRole("button", { name: "Publish v2" }),
      screen.getByText("Save the draft first."),
      screen.getByText("Shop-independent."),
    ];
    for (const element of inOrder) {
      expect(header).toContainElement(element);
    }
    // Why Publish is refused is pinned with Publish: it is read straight after the actions, not
    // after the description and not in the page below.
    for (const [earlier, later] of inOrder
      .slice(1)
      .map((element, index) => [inOrder[index], element])) {
      expect(
        earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(header).not.toContainElement(screen.getByText("The page it heads."));
  });

  it("marks what its actions report as a report, bounded, so the header holds without it", () => {
    render(<EditorHeader sticky />);

    const row = screen.getByText("Save the draft first.").parentElement;
    // What `clearStickyHeader` leaves out of the height it decides on (ADR 0066).
    expect(row).toHaveAttribute(STICKY_REPORT_ATTRIBUTE);
    // And never taller than a quarter of the window, scrolling within that...
    expect(row).toHaveClass("max-h-[25vh]", "overflow-y-auto");
    // ...as a named region, since an overflowing row is a stop on the keyboard's way through.
    expect(screen.getByRole("region", { name: "What the actions report" })).toBe(row);
  });

  it("is pinned with the create page's own classes, and only where it is asked to be", () => {
    const { unmount } = render(<EditorHeader sticky />);
    const pinned = screen.getByRole("heading", { level: 1 }).closest("header");
    for (const utility of stickyHeaderClasses.split(" ")) {
      expect(pinned).toHaveClass(utility);
    }
    unmount();

    render(<EditorHeader />);
    const scrolling = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(scrolling?.className).not.toMatch(/sticky/);
    expect(scrolling).not.toHaveClass("border-b");
  });
});

describe("a card's title", () => {
  it("is a level-2 heading in the display face at the prototype's 17px", () => {
    render(<Card title="Draft validation">body</Card>);

    const title = screen.getByRole("heading", { level: 2, name: "Draft validation" });

    expect(title.className).toContain("font-display");
    expect(title.className).toContain("text-[17px]");
    expect(title.className).toContain("font-bold");
    expect(title.className).toContain("tracking-[-0.01em]");
    expect(title.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});

/**
 * The first card of every editor's side panel, and of the setup pages' (ADR 0071): a frame over
 * the findings the saved draft's gate returned. It says two things of its own and nothing else —
 * that they are about to change while the gate has not answered for the save (ADR 0065), and
 * that they were read off the saved draft while the screen holds edits the save does not.
 */
describe("the gate card", () => {
  const SAVED_DRAFT = "Read off the saved draft. Save to check what is on screen.";

  it("is a region named by its title, holding what it is handed", () => {
    render(
      <GateCard title="Publish gate" busy={false} dirty={false}>
        <p>No validation findings.</p>
      </GateCard>,
    );

    const card = screen.getByRole("region", { name: "Publish gate" });

    expect(within(card).getByRole("heading", { level: 2, name: "Publish gate" })).toBeVisible();
    expect(within(card).getByText("No validation findings.")).toBeVisible();
  });

  it("is busy while the gate has not answered for the saved draft, and only then", () => {
    const { rerender } = render(
      <GateCard title="Publish gate" busy dirty={false}>
        <p>findings</p>
      </GateCard>,
    );

    expect(screen.getByRole("region", { name: "Publish gate" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    rerender(
      <GateCard title="Publish gate" busy={false} dirty={false}>
        <p>findings</p>
      </GateCard>,
    );

    expect(screen.getByRole("region", { name: "Publish gate" })).not.toHaveAttribute("aria-busy");
  });

  it("says under its title that it reads the saved draft while the editor is dirty", () => {
    render(
      <GateCard title="Publish gate" busy={false} dirty>
        <p>the findings</p>
      </GateCard>,
    );

    const card = screen.getByRole("region", { name: "Publish gate" });
    const note = within(card).getByText(SAVED_DRAFT);

    expect(note).toBeVisible();
    // Between the title and what the card holds, which is what it is to be read with.
    expect(card.querySelector("h2")?.compareDocumentPosition(note)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(note.compareDocumentPosition(within(card).getByText("the findings"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("says nothing of the saved draft while the screen holds what was saved", () => {
    render(
      <GateCard title="Publish gate" busy dirty={false}>
        <p>the findings</p>
      </GateCard>,
    );

    expect(screen.queryByText(/read off the saved/i)).toBeNull();
  });

  it("names what its findings are read off where that is not a draft", () => {
    render(
      <GateCard title="Findings" busy={false} dirty record="order">
        <p>the findings</p>
      </GateCard>,
    );

    expect(
      screen.getByText("Read off the saved order. Save to check what is on screen."),
    ).toBeVisible();
    expect(screen.queryByText(SAVED_DRAFT)).toBeNull();
  });
});

/**
 * Publish, as every editor and the overview draw it (ADR 0063): refused with the first of
 * `PublishReasons`' lines in `title` and the whole block in its description, and natively
 * disabled only while a press — or the gate itself — is in flight.
 */
const VALIDATION_WEIGHT = ["text-[13px]", "font-semibold", "text-lab-error"];

describe("PublishButton", () => {
  const GATE: PublishGate = {
    publishable: true,
    issues: [],
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
  };

  function Publish({
    preview,
    dirty = false,
    publishing = false,
    checking = preview === null,
    onPublish = () => {},
  }: {
    preview: PublishGate | null;
    dirty?: boolean;
    publishing?: boolean;
    checking?: boolean;
    onPublish?: () => void;
  }) {
    return (
      <>
        <PublishButton
          preview={preview}
          dirty={dirty}
          publishing={publishing}
          checking={checking}
          reasonsId="reasons"
          onPublish={onPublish}
        />
        <PublishReasons id="reasons" preview={preview} dirty={dirty} checking={checking} />
      </>
    );
  }

  it("publishes a saved draft the gate accepts", async () => {
    const onPublish = vi.fn();
    render(<Publish preview={GATE} onPublish={onPublish} />);
    const publish = screen.getByRole("button", { name: "Publish v1" });
    expectNotRefused(publish);
    await userEvent.click(publish);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("refuses unsaved edits, the gate's errors, and a draft identical to the last version", async () => {
    const onPublish = vi.fn();
    const { rerender } = render(<Publish preview={GATE} dirty onPublish={onPublish} />);
    const publish = screen.getByRole("button", { name: "Publish v1" });
    expectRefused(publish, PUBLISH_UNSAVED_REASON);
    // At the validation weight, like every reason a refused action gives (ADR 0063).
    expect(screen.getByText(PUBLISH_UNSAVED_REASON)).toHaveClass(...VALIDATION_WEIGHT);
    await userEvent.click(publish);

    rerender(
      <Publish
        preview={{
          ...GATE,
          publishable: false,
          issues: [
            { severity: "error", code: "x", message: "x", path: "x" },
            { severity: "warning", code: "y", message: "y", path: "y" },
          ],
        }}
        onPublish={onPublish}
      />,
    );
    expectRefused(publish, "Resolve 1 error(s) to publish.");
    expect(screen.getByText("Resolve 1 error(s) to publish.")).toHaveClass(...VALIDATION_WEIGHT);
    // The warnings refuse nothing, so they stay muted.
    expect(screen.getByText("1 warning(s) do not block publication.")).toHaveClass(
      "text-admin-muted",
    );
    // Described by the whole block, the warning line included.
    expect(publish).toHaveAccessibleDescription(/1 warning\(s\) do not block publication/);
    await userEvent.click(publish);

    rerender(
      <Publish
        preview={{
          ...GATE,
          latest_published_version: 1,
          next_version: 2,
          matches_latest_published: true,
        }}
        onPublish={onPublish}
      />,
    );
    expectRefused(
      screen.getByRole("button", { name: "Publish v2" }),
      "The draft is identical to v1; there is nothing new to freeze.",
    );
    // A refusal like the other two, at the same weight.
    expect(
      screen.getByText("The draft is identical to v1; there is nothing new to freeze."),
    ).toHaveClass(...VALIDATION_WEIGHT);
    await userEvent.click(screen.getByRole("button", { name: "Publish v2" }));
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("does not call an edited draft identical to the last version: that is the saved draft", () => {
    render(
      <Publish
        preview={{
          ...GATE,
          latest_published_version: 1,
          next_version: 2,
          matches_latest_published: true,
        }}
        dirty
      />,
    );

    const publish = screen.getByRole("button", { name: "Publish v2" });
    expectRefused(publish, PUBLISH_UNSAVED_REASON);
    expect(screen.queryByText(/identical to v1/)).toBeNull();
    expect(publish).toHaveAccessibleDescription(PUBLISH_UNSAVED_REASON);
  });

  it("draws nothing where there is nothing to say, so the header it stands in keeps its spacing", () => {
    render(
      <PageHeader
        title="Frontline A"
        actions={<Publish preview={GATE} />}
        reasons={<PublishReasons id="reasons" preview={GATE} dirty={false} checking={false} />}
        description="Shop-independent."
      />,
    );

    expectNotRefused(screen.getByRole("button", { name: "Publish v1" }));
    expect(document.getElementById("reasons")).toBeNull();
    // The row the reasons would take is empty, and an empty one is not drawn: without it the
    // header's 5px gap would open twice between the name and the description.
    const row = screen.getByText("Shop-independent.").previousElementSibling;
    expect(row).toBeEmptyDOMElement();
    expect(row).toHaveClass("empty:hidden");
  });

  it("is a press in flight, not a refusal, while publishing and while the gate has not answered", () => {
    const { rerender } = render(<Publish preview={GATE} publishing />);
    const publishing = screen.getByRole("button", { name: "Publishing…" });
    expectBusy(publishing);
    expect(screen.queryByText("Checking the draft…")).toBeNull();

    // Busy wins over a refusal: an edit made while publishing does not dress the pressed
    // button as refused or hand it a reason (ADR 0063).
    rerender(<Publish preview={GATE} dirty publishing />);
    expectBusy(publishing);
    expect(publishing.className).not.toContain("border-dashed");

    rerender(<Publish preview={null} />);
    const waiting = screen.getByRole("button", { name: "Publish v1" });
    expectBusy(waiting);
  });

  it("says it is checking the draft where it would otherwise say nothing, and until it answers", () => {
    // The first answer has not arrived.
    const { rerender } = render(<Publish preview={null} checking />);
    const publish = screen.getByRole("button", { name: "Publish v1" });
    expectBusy(publish);
    expect(screen.getByText("Checking the draft…")).toBeVisible();
    expect(publish).toHaveAccessibleDescription("Checking the draft…");

    // A save landed and the gate is being asked about what it wrote: the answer on screen was
    // for the draft before, so its reason is not repeated as though it were this one's.
    rerender(
      <Publish
        preview={{
          ...GATE,
          publishable: false,
          issues: [{ severity: "error", code: "x", message: "x", path: "x" }],
        }}
        checking
      />,
    );
    expectBusy(publish);
    expect(screen.getByText("Checking the draft…")).toBeVisible();
    expect(screen.queryByText("Resolve 1 error(s) to publish.")).toBeNull();
    expect(publish).not.toHaveAttribute("title");

    // Answered: the line gives way to what the gate said.
    rerender(<Publish preview={GATE} checking={false} />);
    expect(screen.queryByText("Checking the draft…")).toBeNull();
    expectNotRefused(publish);
    expect(publish).not.toHaveAccessibleDescription(/./);
  });
});
