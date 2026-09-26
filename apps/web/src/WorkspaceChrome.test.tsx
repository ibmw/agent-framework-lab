import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Card,
  PageHeader,
  PublishButton,
  type PublishGate,
  PublishReasons,
} from "./components/WorkspaceChrome";
import { PUBLISH_UNSAVED_REASON } from "./lib/definitionEditor";
import { expectNotRefused, expectRefused } from "./test/refused";

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
    onPublish = () => {},
  }: {
    preview: PublishGate | null;
    dirty?: boolean;
    publishing?: boolean;
    onPublish?: () => void;
  }) {
    return (
      <>
        <PublishButton
          preview={preview}
          dirty={dirty}
          publishing={publishing}
          reasonsId="reasons"
          onPublish={onPublish}
        />
        <PublishReasons id="reasons" preview={preview} dirty={dirty} />
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

  it("is a press in flight, not a refusal, while publishing and while the gate has not answered", () => {
    const { rerender } = render(<Publish preview={GATE} publishing />);
    const publishing = screen.getByRole("button", { name: "Publishing…" });
    expect(publishing).toBeDisabled();
    expect(publishing).not.toHaveAttribute("aria-disabled");
    expect(publishing).not.toHaveAttribute("title");

    // Busy wins over a refusal: an edit made while publishing does not dress the pressed
    // button as refused or hand it a reason (ADR 0063).
    rerender(<Publish preview={GATE} dirty publishing />);
    expect(publishing).toBeDisabled();
    expect(publishing).not.toHaveAttribute("aria-disabled");
    expect(publishing).not.toHaveAttribute("title");

    rerender(<Publish preview={null} />);
    const waiting = screen.getByRole("button", { name: "Publish v1" });
    expect(waiting).toBeDisabled();
    expect(waiting).not.toHaveAttribute("aria-disabled");
    expect(waiting).not.toHaveAttribute("title");
  });
});
