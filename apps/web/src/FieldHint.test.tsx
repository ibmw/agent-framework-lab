import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldHint } from "./components/FieldHint";

describe("FieldHint", () => {
  it("puts the hint in the control's accessible description", () => {
    render(
      <FieldHint
        label="Handle"
        hint="Lowercase with hyphens. Tools address the product by this handle."
      >
        <input />
      </FieldHint>,
    );

    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /lowercase with hyphens.*tools address the product/i,
    );
  });

  it("keeps the accessible name on the label, so a pointer is not required to read the rule", () => {
    render(
      <FieldHint label="Slug" hint="Follows the name until you edit it.">
        <input />
      </FieldHint>,
    );

    expect(screen.getByLabelText("Slug", { exact: true })).toBeVisible();
    expect(screen.getByLabelText("Slug")).not.toHaveAccessibleName(/follows the name/i);
  });

  it("puts a live extra line in the control's accessible description", () => {
    render(
      <FieldHint
        label="Name"
        hint="Saved as a lowercase slug."
        extra={
          <>
            Saved as <code>identify-entity</code>.
          </>
        }
      >
        <input />
      </FieldHint>,
    );

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/saved as identify-entity/i);
  });

  it("keeps the extra live region mounted so a later preview can announce", () => {
    const { rerender } = render(
      <FieldHint label="Name" hint="Saved as a lowercase slug.">
        <input />
      </FieldHint>,
    );
    const describedBy = screen.getByLabelText("Name").getAttribute("aria-describedby");
    expect(describedBy?.split(" ")).toHaveLength(2);

    rerender(
      <FieldHint
        label="Name"
        hint="Saved as a lowercase slug."
        extra={
          <>
            Saved as <code>identify-entity</code>.
          </>
        }
      >
        <input />
      </FieldHint>,
    );

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/saved as identify-entity/i);
    expect(screen.getByLabelText("Name").getAttribute("aria-describedby")).toBe(describedBy);
  });

  it("uses the create-error treatment on an extra collision line", () => {
    render(
      <FieldHint
        label="Handle"
        hint="Lowercase with hyphens."
        extra="alpine-shell-jacket is already in the draft."
        extraTone="error"
      >
        <input />
      </FieldHint>,
    );

    const extraId = screen
      .getByLabelText("Handle")
      .getAttribute("aria-describedby")
      ?.split(" ")
      .at(-1);
    expect(document.getElementById(extraId ?? "")).toHaveClass("text-lab-error");
    expect(screen.getByRole("alert")).toHaveTextContent(/already in the draft/i);
    expect(document.getElementById(extraId ?? "")).not.toHaveAttribute("aria-live");
  });

  it("marks the minority as optional, the way the product editor writes price", () => {
    render(
      <FieldHint label="Price" hint="Leave empty to add in the editor." optional>
        <input />
      </FieldHint>,
    );

    expect(screen.getByLabelText("Price (optional)")).toHaveAccessibleDescription(
      /leave empty to add in the editor/i,
    );
  });
});
