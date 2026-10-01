import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ButtonIcon } from "./components/ButtonIcon";
import { EditorSaveActions, EntryEditButtons } from "./components/WorkspaceChrome";
import { type ButtonVerb, buttonIcon, itemEditButtonClasses } from "./lib/ui";

const VERBS = Object.keys(buttonIcon) as ButtonVerb[];

describe("a button's glyph", () => {
  it.each(VERBS)("%s adds nothing to the button's accessible name", (verb) => {
    render(
      <button type="button">
        <ButtonIcon verb={verb} />
        Save draft
      </button>,
    );

    expect(screen.getByRole("button")).toHaveAccessibleName("Save draft");
  });

  it.each(VERBS)("%s is hidden from assistive technology and is not a tab stop", (verb) => {
    const { container } = render(<ButtonIcon verb={verb} />);
    const glyph = container.querySelector("svg");

    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveAttribute("focusable", "false");
  });

  it("leaves a control that is named by an attribute named by that attribute", () => {
    render(
      <button type="button" aria-label="Remove the returns policy">
        <ButtonIcon verb="delete" />
        Remove
      </button>,
    );

    expect(screen.getByRole("button", { name: "Remove the returns policy" })).toBeInTheDocument();
  });
});

/**
 * The two shared controls the whole workspace saves and edits through. Their names are what
 * every page spec and every Playwright journey reaches for, so the glyphs are checked here
 * against the names rather than against the drawings.
 */
describe("the shared editor controls keep their names", () => {
  it("names Save draft and Discard changes after the words, not the drawings", () => {
    render(
      <EditorSaveActions
        dirty
        saving={false}
        discarding={false}
        onSave={() => {}}
        onDiscard={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
    for (const control of screen.getAllByRole("button")) {
      expect(control.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("keeps a row's Edit and Save named after the entry they act on, the Edit a pencil", () => {
    const { rerender } = render(
      <EntryEditButtons
        label="the returns policy"
        open={false}
        onOpen={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );

    // The pencil an item draws: the verb is the name and the title, and nothing is written
    // (ADR 0075).
    const edit = screen.getByRole("button", { name: "Edit the returns policy" });
    expect(edit).toHaveTextContent(/^$/);
    expect(edit).toHaveAttribute("title", "Edit the returns policy");
    expect(edit.className).toBe(itemEditButtonClasses);
    expect(edit.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    rerender(
      <EntryEditButtons
        label="the returns policy"
        open
        onOpen={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Save the returns policy" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel editing the returns policy" }),
    ).toBeInTheDocument();
  });
});
