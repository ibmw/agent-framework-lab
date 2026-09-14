import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DerivedIdField } from "./components/DerivedIdField";
import { uniqueSuggestion } from "./lib/entryIds";

function Harness({
  source,
  taken = [],
  takenPlace = "in the draft",
}: {
  source: string;
  taken?: readonly string[];
  takenPlace?: string;
}) {
  const { value: suggested, takenBase } = uniqueSuggestion(source, taken);
  const [value, setValue] = useState(suggested);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <DerivedIdField
        label="Handle"
        hint="Lowercase with hyphens. Follows the title until you edit it."
        value={value}
        suggested={suggested}
        taken={taken}
        takenBase={takenBase}
        takenPlace={takenPlace}
        required
        onChange={setValue}
      />
      <button type="submit">Save</button>
    </form>
  );
}

describe("DerivedIdField", () => {
  it("follows the source until it is edited", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness source="alpine-shell-jacket" />);

    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket");
    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /saved as alpine-shell-jacket/i,
    );

    rerender(<Harness source="alpine-jacket" />);
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-jacket");

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    rerender(<Harness source="alpine-shell-jacket" />);
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-custom");
  });

  it("lets clear-then-type start a new value rather than appending to the suggestion", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-shell-jacket" />);

    await user.clear(screen.getByLabelText("Handle"));
    expect(screen.getByLabelText("Handle")).toHaveValue("");
    await user.type(screen.getByLabelText("Handle"), "harbour");
    expect(screen.getByLabelText("Handle")).toHaveValue("harbour");
  });

  it("restores the suggestion on blur while empty", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-shell-jacket" />);

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    await user.clear(screen.getByLabelText("Handle"));
    expect(screen.getByLabelText("Handle")).toHaveValue("");

    await user.tab();
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket");
  });

  it("follows the source again on the next source change once emptied", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness source="alpine-shell-jacket" />);

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    await user.clear(screen.getByLabelText("Handle"));
    expect(screen.getByLabelText("Handle")).toHaveValue("");

    rerender(<Harness source="alpine-jacket" />);
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-jacket");
  });

  it("offers the next free id and says why when the source is taken", () => {
    render(<Harness source="alpine-shell-jacket" taken={["alpine-shell-jacket"]} />);

    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket-2");
    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /saved as alpine-shell-jacket-2.*alpine-shell-jacket is already in the draft/i,
    );
  });

  it("hides why the source was taken once the value no longer is the suggestion", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-shell-jacket" taken={["alpine-shell-jacket"]} />);

    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /alpine-shell-jacket is already in the draft/i,
    );
    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-custom");
    expect(screen.getByLabelText("Handle")).not.toHaveAccessibleDescription(
      /alpine-shell-jacket is already in the draft/i,
    );
  });

  it("refuses a value already taken rather than submitting it", async () => {
    const user = userEvent.setup();
    render(<Harness source="alpine-jacket" taken={["alpine-shell-jacket"]} />);

    await user.clear(screen.getByLabelText("Handle"));
    await user.type(screen.getByLabelText("Handle"), "alpine-shell-jacket");

    expect(screen.getByLabelText("Handle")).toHaveAccessibleDescription(
      /alpine-shell-jacket is already in the draft/i,
    );
    expect(screen.getByLabelText("Handle")).toBeInvalid();
    const extraId = screen
      .getByLabelText("Handle")
      .getAttribute("aria-describedby")
      ?.split(" ")
      .at(-1);
    expect(document.getElementById(extraId ?? "")).toHaveClass("text-lab-error");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket");
    expect(screen.getByLabelText("Handle")).toBeInvalid();
  });
});
