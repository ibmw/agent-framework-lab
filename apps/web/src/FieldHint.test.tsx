import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FieldGroup, FieldGroupHint, FieldHint, FieldRows } from "./components/FieldHint";

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

  it("draws a refusal at the validation weight and marks the control invalid (ADR 0063)", () => {
    const { rerender } = render(
      <FieldHint label="Handle" hint="Lowercase with hyphens." extra="Taken." extraTone="error">
        <input />
      </FieldHint>,
    );
    expect(screen.getByRole("alert")).toHaveClass("text-[13px]", "font-semibold", "text-lab-error");
    expect(screen.getByLabelText("Handle")).toHaveAttribute("aria-invalid", "true");

    // A preview is not a refusal: small, normal, and the control is not invalid.
    rerender(
      <FieldHint label="Handle" hint="Lowercase with hyphens." extra="Saved as `h`.">
        <input />
      </FieldHint>,
    );
    expect(screen.getByLabelText("Handle")).not.toHaveAttribute("aria-invalid");
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

/**
 * The form row the workspace refresh draws 107 times.
 *
 * These are `FieldHint`'s assertions again from the other arrangement, deliberately: the two
 * share one implementation of the contract, and the way that stays true is that both are held
 * to it. What is new here is the geometry and the group.
 */
describe("Field", () => {
  function row(container: HTMLElement) {
    const element = container.firstElementChild as HTMLElement;
    const [left, right] = Array.from(element.children) as HTMLElement[];
    return { element, left, right };
  }

  it("binds the label to the control it names", () => {
    render(
      <Field label="Title">
        <input />
      </Field>,
    );

    const label = screen.getByText("Title");
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe(screen.getByLabelText("Title").id);
  });

  it("takes the id a control already has rather than binding to one it does not use", () => {
    render(
      <Field label="Title" htmlFor="given">
        <input id="given" />
      </Field>,
    );

    expect(screen.getByLabelText("Title").id).toBe("given");
  });

  it("puts the hint in the control's accessible description, as the stacked field does", () => {
    render(
      <Field label="Handle" hint="Lowercase with hyphens. Tools address the product by this.">
        <input />
      </Field>,
    );

    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /lowercase with hyphens.*tools address the product/i,
    );
    expect(screen.getByLabelText("Handle")).not.toHaveAccessibleName(/lowercase/i);
  });

  it("describes a row with no rule by nothing at all", () => {
    render(
      <Field label="Category">
        <input />
      </Field>,
    );

    // Not "points at an empty paragraph": a row without a hint must not leave an id in
    // `aria-describedby` for a paragraph it never rendered.
    expect(screen.getByLabelText("Category")).toHaveAccessibleDescription("");
    for (const id of screen
      .getByLabelText("Category")
      .getAttribute("aria-describedby")
      ?.split(" ") ?? []) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("marks the minority as optional", () => {
    render(
      <Field label="Price" hint="Leave empty to add in the editor." optional>
        <input />
      </Field>,
    );

    expect(screen.getByLabelText("Price (optional)")).toHaveAccessibleDescription(
      /leave empty to add in the editor/i,
    );
  });

  it("keeps a refusal in the description, announced, and beneath the control", () => {
    const { container } = render(
      <Field
        label="Handle"
        hint="Lowercase with hyphens."
        extra="alpine-shell-jacket is already in the draft."
        extraTone="error"
      >
        <input />
      </Field>,
    );

    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(/already in the draft/i);
    expect(screen.getByLabelText("Handle")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/already in the draft/i);
    expect(screen.getByRole("alert")).toHaveClass("text-[13px]", "font-semibold", "text-lab-error");
    // The handoff puts a validation message under the control, not under the label.
    expect(row(container).right).toContainElement(screen.getByRole("alert"));
  });

  it("keeps the second line mounted so a later preview announces", () => {
    const { rerender } = render(
      <Field label="Name" hint="Saved as a lowercase slug.">
        <input />
      </Field>,
    );
    const describedBy = screen.getByLabelText("Name").getAttribute("aria-describedby");

    rerender(
      <Field label="Name" hint="Saved as a lowercase slug." extra="Saved as identify-entity.">
        <input />
      </Field>,
    );

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(/saved as identify-entity/i);
    expect(screen.getByLabelText("Name").getAttribute("aria-describedby")).toBe(describedBy);
  });

  it("puts the label and its hint in one column and the control in the other", () => {
    const { container } = render(
      <Field label="Slug" hint="Lowercase letters, digits and single hyphens.">
        <input />
      </Field>,
    );
    const { left, right } = row(container);

    expect(left).toContainElement(screen.getByText("Slug"));
    expect(left).toContainElement(
      screen.getByText(/lowercase letters, digits and single hyphens/i),
    );
    expect(right).toContainElement(screen.getByLabelText("Slug"));
  });

  it("ships the declaration that stacks it, which is as far as a test without layout goes", () => {
    const { container } = render(
      <Field label="Slug" hint="Lowercase letters, digits and single hyphens.">
        <input />
      </Field>,
    );
    const { element, left, right } = row(container);

    // jsdom computes no layout, so this proves no wrap. It is a drift guard: the rendered
    // row is still a wrapping flex box whose two columns each carry a basis they may fall
    // below. `lib/ui.test.ts` holds those bases to the handoff's numbers.
    expect(element.className).toContain("flex-wrap");
    expect(element.className).toContain("items-start");
    expect(left.className).toContain("flex-[1_1_210px]");
    expect(right.className).toContain("flex-[2_1_330px]");
    // A column that cannot shrink below its content is a column that never lets the row wrap.
    expect(left.className).toContain("min-w-0");
    expect(right.className).toContain("min-w-0");
  });
});

describe("FieldGroup", () => {
  it("names a group of controls without a `for` pointing at nothing", () => {
    const { container } = render(
      <FieldGroup label="Support channels" hint="A shop must answer somewhere.">
        <label>
          <input type="checkbox" /> Chat
        </label>
      </FieldGroup>,
    );

    expect(screen.getByRole("group", { name: "Support channels" })).toHaveAccessibleDescription(
      /a shop must answer somewhere/i,
    );
    // The group's own name is not a label element, so it cannot be a dangling `for`. The only
    // label in this row is the checkbox's own.
    const dangling = Array.from(container.querySelectorAll("label[for]")).filter(
      (element) => document.getElementById(element.getAttribute("for") ?? "") === null,
    );
    expect(dangling).toEqual([]);
  });

  it("is the same row as a field, so a group and a field line up", () => {
    const { container } = render(
      <FieldGroup label="Currencies">
        <span>EUR</span>
      </FieldGroup>,
    );
    const element = container.firstElementChild as HTMLElement;

    expect(element.className).toContain("flex-wrap");
    expect((element.children[0] as HTMLElement).className).toContain("flex-[1_1_210px]");
    expect((element.children[1] as HTMLElement).className).toContain("flex-[2_1_330px]");
  });
});

/**
 * The opt-in that lets a field which labels itself join a card on the pattern.
 *
 * Only `LocaleField` and `CurrencyField` forward it, and only the two cards this slice
 * converted pass it. The default is what every other consumer keeps getting, which is the
 * whole point of it being opt-in.
 */
describe("the arrangement a self-labelling field asks for", () => {
  it("stacks unless a caller says otherwise", () => {
    const { container } = render(
      <FieldHint label="Locale" hint="Pick a locale from the list.">
        <input />
      </FieldHint>,
    );

    expect((container.firstElementChild as HTMLElement).className).not.toContain("flex-wrap");
    expect(screen.getByLabelText("Locale")).toHaveAccessibleDescription(/pick a locale/i);
  });

  it("draws the row on request, with the description unchanged", () => {
    const { container } = render(
      <FieldHint
        label="Locale"
        hint="Pick a locale from the list."
        extra="English (UK)"
        arrangement="row"
      >
        <input />
      </FieldHint>,
    );

    expect((container.firstElementChild as HTMLElement).className).toContain("flex-wrap");
    expect(screen.getByLabelText("Locale")).toHaveAccessibleDescription(
      /pick a locale from the list.*english \(uk\)/i,
    );
  });

  it("does the same for a group, which stays one group either way", () => {
    for (const arrangement of ["stacked", "row"] as const) {
      const { container, unmount } = render(
        <FieldGroupHint
          legend="Currencies"
          hint="A shop sells in at least one."
          arrangement={arrangement}
        >
          <input type="checkbox" aria-label="EUR" />
        </FieldGroupHint>,
      );

      expect(screen.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
        /a shop sells in at least one/i,
      );
      expect((container.firstElementChild as HTMLElement).className.includes("flex-wrap")).toBe(
        arrangement === "row",
      );
      unmount();
    }
  });
});

describe("FieldRows", () => {
  it("drops the first row's rule, which the card already drew under its heading", () => {
    const { container } = render(
      <FieldRows>
        <Field label="Name">
          <input />
        </Field>
      </FieldRows>,
    );

    expect((container.firstElementChild as HTMLElement).className).toContain(
      "[&>:first-child]:border-t-0",
    );
  });

  it("makes a run of rows one child of whatever lays the card out", () => {
    const { container } = render(
      <div className="grid gap-3">
        <FieldRows>
          <Field label="Name">
            <input />
          </Field>
          <Field label="Slug">
            <input />
          </Field>
        </FieldRows>
      </div>,
    );

    // Two rows, one grid item: the card's gap applies around the run and not between the
    // rows, which carry their own padding and their own rule.
    expect(container.firstElementChild?.children).toHaveLength(1);
    expect(container.firstElementChild?.firstElementChild?.children).toHaveLength(2);
  });
});
