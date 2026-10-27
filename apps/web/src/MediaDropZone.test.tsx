import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MediaDropZone } from "./components/MediaDropZone";
import { expectRefusalWeight } from "./test/refused";
import { RefusingForm } from "./test/refusingForm";

const FORM_REFUSAL = "Fill the field before adding.";

/** A media form with nothing chosen yet, whose *Add* is refused for want of an image. */
function NoImageYet() {
  return (
    <RefusingForm reason={FORM_REFUSAL}>
      {(refusedBy) => (
        <>
          <MediaDropZone
            label="Image"
            hint="A JPEG, PNG or WebP."
            chosen={null}
            fixed={false}
            uploading={false}
            status=""
            refused={false}
            refusedBy={refusedBy}
            onFile={() => {}}
          />
          <label>
            Alt text
            <input />
          </label>
        </>
      )}
    </RefusingForm>
  );
}

describe("MediaDropZone named by a form's refusal (ADR 0078)", () => {
  it("marks the picker invalid only while the form's line is drawn as the refusal", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NoImageYet />);
    const add = screen.getByRole("button", { name: "Add entry" });
    const picker = screen.getByLabelText("Browse…");
    expectRefusalWeight(add, "hint");
    expect(picker).not.toHaveAttribute("aria-invalid");
    expect(picker).not.toHaveAccessibleDescription(expect.stringContaining(FORM_REFUSAL));

    // An edit elsewhere in the form touches it, and the field the refusal names says so.
    await user.type(screen.getByLabelText("Alt text"), "Hood up");
    expectRefusalWeight(add, "touched");
    expect(picker).toHaveAttribute("aria-invalid", "true");
    expect(picker).toHaveAccessibleDescription(expect.stringContaining(FORM_REFUSAL));
    unmount();

    render(<NoImageYet />);
    const pressed = screen.getByRole("button", { name: "Add entry" });
    await user.click(pressed);
    expectRefusalWeight(pressed, "touched");
    expect(screen.getByLabelText("Browse…")).toHaveAttribute("aria-invalid", "true");
  });
});
