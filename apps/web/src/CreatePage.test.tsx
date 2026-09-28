import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CreatePage } from "./components/CreatePage";
import { stickyHeaderClasses } from "./lib/stickyHeader";
import { blockedButtonClasses, neutralPillClasses, outlineButtonClasses } from "./lib/ui";
import { expectNotRefused, expectRefused } from "./test/refused";

/**
 * The create layout itself, over a form of one field (PLAN-UX Slice 12).
 *
 * The four pages that use it are covered where they live — `Shops`, `Orders`, `Customers`
 * and `SupportIdentities` each drive their own — and what is left to this suite is what the
 * layout owns whatever it holds: the blocked state, the reason it carries, the refusal it
 * keeps on screen, what Cancel does, and the title reading back what is being typed.
 */
function Harness({ blocked = true }: { blocked?: boolean }) {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string[]>([]);
  const missing =
    name === "" && blocked ? "The thing needs a name before it can be created." : undefined;
  return (
    <CreatePage
      backTo="/index"
      backLabel="Things"
      breadcrumb="creating a thing"
      title={name}
      untitled="New thing"
      formId="thing-form"
      createLabel="Create thing"
      creating={false}
      creatingLabel="Creating…"
      blockedBy={missing}
      error={created.includes("no") ? "The lab refused that." : null}
    >
      <form
        id="thing-form"
        onSubmit={(event) => {
          event.preventDefault();
          setCreated((entries) => [...entries, name]);
        }}
      >
        <label htmlFor="thing-name">Name</label>
        <input id="thing-name" value={name} onChange={(event) => setName(event.target.value)} />
        <p>{created.length} created</p>
      </form>
    </CreatePage>
  );
}

function renderPage(element: React.ReactElement) {
  const router = createMemoryRouter(
    [
      { path: "/new", element },
      { path: "/index", element: <h1>Things</h1> },
    ],
    { initialEntries: ["/new"] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}

function header(): HTMLElement {
  const found = screen.getByRole("heading", { level: 1 }).closest("header");
  if (!found) throw new Error("the create page has no header");
  return found;
}

describe("the create page's header", () => {
  it("names the index above it, three ways back to it, and says nothing exists yet", () => {
    renderPage(<Harness />);

    const bar = within(header());
    expect(bar.getByLabelText("Back to Things")).toHaveAttribute("href", "/index");
    expect(bar.getByRole("link", { name: "Things" })).toHaveAttribute("href", "/index");
    expect(bar.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/index");
    expect(bar.getByText(/creating a thing/)).toBeVisible();
    expect(bar.getByText("nothing created yet")).toBeVisible();
  });

  it("draws its way back with the editor's own piece, the chip as a neutral pill, Cancel from the button table", () => {
    renderPage(<Harness />);

    const bar = within(header());
    const arrow = bar.getByRole("link", { name: "Back to Things" });
    // The line above the title is the arrow's sibling, as it is on every editor's header.
    expect(arrow.nextElementSibling).toContainElement(bar.getByRole("link", { name: "Things" }));
    expect(arrow.nextElementSibling).toContainElement(
      screen.getByRole("heading", { level: 1, name: "New thing" }),
    );
    expect(bar.getByText("nothing created yet").className).toBe(neutralPillClasses);
    for (const utility of outlineButtonClasses.split(" ")) {
      expect(bar.getByRole("link", { name: "Cancel" })).toHaveClass(utility);
    }
  });

  it("is the name as it is typed, and its stand-in until there is one", async () => {
    const user = userEvent.setup();
    renderPage(<Harness />);

    expect(screen.getByRole("heading", { level: 1, name: "New thing" })).toBeVisible();
    await user.type(screen.getByLabelText("Name"), "Harbour Lane");
    expect(screen.getByRole("heading", { level: 1, name: "Harbour Lane" })).toBeVisible();
  });

  it("is pinned by the same classes an editor's header is", () => {
    renderPage(<Harness />);

    for (const utility of stickyHeaderClasses.split(" ")) {
      expect(header()).toHaveClass(utility);
    }
  });
});

describe("the create page's blocked state", () => {
  it("wears the dashed weight, cannot be pressed, and says why twice", () => {
    renderPage(<Harness />);

    const create = screen.getByRole("button", { name: "Create thing" });
    expectRefused(create, "The thing needs a name before it can be created.");
    for (const utility of blockedButtonClasses.split(" ")) {
      expect(create.className).toContain(utility);
    }
    // `title=` is never the only carrier: the reason is also inline, and it is the control's
    // accessible description (`docs/design-direction.md`, *The form language*).
    expect(create).toHaveAttribute("title", "The thing needs a name before it can be created.");
    expect(create).toHaveAccessibleDescription("The thing needs a name before it can be created.");
    expect(
      within(header()).getByText("The thing needs a name before it can be created."),
    ).toBeVisible();
  });

  it("stays in the tab order, and neither a press nor Enter in the form creates anything", async () => {
    const user = userEvent.setup();
    renderPage(<Harness />);

    const create = screen.getByRole("button", { name: "Create thing" });
    await user.tab(); // the back arrow
    await user.tab(); // the breadcrumb link
    await user.tab(); // Cancel
    await user.tab();
    expect(create).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.click(create);
    expect(screen.getByText("0 created")).toBeVisible();
    // Enter in the body's field is implicit submission, which a browser performs as a click on
    // the form's default button — this header button, associated by `form=`.
    const form = document.getElementById("thing-form") as HTMLFormElement;
    expect(Array.from(form.elements).find((element) => element.tagName === "BUTTON")).toBe(create);
    fireEvent.click(create);
    expect(screen.getByText("0 created")).toBeVisible();
  });

  it("becomes the primary action the moment the form can submit", async () => {
    const user = userEvent.setup();
    renderPage(<Harness />);

    await user.type(screen.getByLabelText("Name"), "Harbour Lane");

    const create = screen.getByRole("button", { name: "Create thing" });
    expectNotRefused(create);
    expect(create).not.toHaveAttribute("title");
    expect(create.className).not.toContain("border-dashed");
    expect(screen.queryByText(/needs a name before/)).toBeNull();
  });

  it("submits the form in the body from the button in the header", async () => {
    const user = userEvent.setup();
    renderPage(<Harness />);

    await user.type(screen.getByLabelText("Name"), "Harbour Lane");
    await user.click(screen.getByRole("button", { name: "Create thing" }));

    expect(screen.getByText("1 created")).toBeVisible();
  });
});

describe("leaving a create page", () => {
  it("asks nothing about a half-typed form", async () => {
    const user = userEvent.setup();
    const { router } = renderPage(<Harness />);

    await user.type(screen.getByLabelText("Name"), "Harbour");
    await user.click(screen.getByRole("link", { name: "Cancel" }));

    // A half-typed create form is not an edit to something that exists, so no prompt stands
    // between the operator and the index (ADR 0051, *Deliberately not here*).
    expect(router.state.location.pathname).toBe("/index");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a refusal under the button rather than navigating", async () => {
    const user = userEvent.setup();
    const { router } = renderPage(<Harness blocked={false} />);

    await user.type(screen.getByLabelText("Name"), "no");
    await user.click(screen.getByRole("button", { name: "Create thing" }));

    const refusal = screen.getByRole("alert");
    expect(refusal).toHaveTextContent("The lab refused that.");
    expect(router.state.location.pathname).toBe("/new");
    expect(screen.getByRole("button", { name: "Create thing" })).toHaveAccessibleDescription(
      "The lab refused that.",
    );
  });
});
