import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useId, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { ConfirmRemove, RemovalNotice } from "./components/ConfirmRemove";
import { FieldHint } from "./components/FieldHint";
import { EditButton, ItemFormRow, ListItem, RemoveButton } from "./components/ItemList";
import {
  formTitle,
  type ItemRefusal,
  refusedProps,
  useEditButtons,
  useFocusAfterCommit,
  useItemForm,
} from "./lib/itemForm";
import { useRemoval } from "./lib/removal";
import { fieldControlClasses } from "./lib/ui";
import {
  itemFormReason,
  METHOD_FORM_REASON,
  type RegisteredWork,
  UnsavedWorkContext,
} from "./lib/unsavedWork";
import { wholeDescription } from "./test/app";
import { expectNotRefused, expectRefused, submitWithoutPressing } from "./test/refused";

/**
 * The shared list (ADR 0074) on a harness of its own: notes with a name and a body, keyed by an
 * id the form never asks, drawn through the same pieces Shop details' method cards and the order
 * editor's lines and events draw through.
 */

interface Note {
  id: string;
  name: string;
  body: string;
}

type NoteFields = { name: string; body: string };

const NOTES: Note[] = [
  { id: "returns", name: "Returns", body: "Thirty days." },
  { id: "shipping", name: "Shipping", body: "Two days." },
];

const NAME_RULE = "A note needs a name.";
const BODY_RULE = "A note needs a body.";
const BLANK: NoteFields = { name: "", body: "" };

function noteRefusal(fields: NoteFields): ItemRefusal<"name" | "body"> | null {
  if (fields.name.trim() === "") {
    return { field: "name", reason: NAME_RULE };
  }
  if (fields.body.trim() === "") {
    return { field: "body", reason: BODY_RULE };
  }
  return null;
}

function Harness({ initial = NOTES }: { initial?: Note[] }) {
  const [notes, setNotes] = useState(initial);
  const ids = notes.map((note) => note.id);
  const nameOf = (id: string) => notes.find((note) => note.id === id)?.name ?? id;
  const form = useItemForm<NoteFields>({
    blank: BLANK,
    ids,
    words: { form: "Notes", entry: "a note", record: "draft" },
    nameOf,
    formOf: (id) => {
      const note = notes.find((entry) => entry.id === id) as Note;
      return { name: note.name, body: note.body };
    },
    typedOf: (fields) => fields.name,
  });
  const removal = useRemoval("notes");
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const nameInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = noteRefusal(form.fields);
  const marked = form.dirty ? refusal : null;

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      setNotes(notes.map((note) => (note.id === editing ? { ...note, ...form.fields } : note)));
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      setNotes([...notes, { id: `note-${notes.length}`, ...form.fields }]);
    }
    form.reset();
  }

  return (
    <>
      <ul>
        {notes.map((note) =>
          removal.isArmed(note.id) ? (
            <ConfirmRemove
              key={note.id}
              as="li"
              title={`Remove ${note.name}?`}
              consequence="It leaves the list."
              onConfirm={removal.confirm(
                () => setNotes(notes.filter((entry) => entry.id !== note.id)),
                `Removed ${note.name}.`,
              )}
              onKeep={removal.keep}
            />
          ) : (
            <ListItem
              key={note.id}
              name={note.name}
              id={note.id}
              detail={note.body}
              editing={form.editing === note.id}
            >
              <EditButton
                name={note.name}
                buttonRef={editButtons.ref(note.id)}
                onEdit={() => {
                  form.begin(note.id, { name: note.name, body: note.body });
                  focusAfterCommit(() => nameInput.current);
                }}
              />
              <RemoveButton
                name={note.name}
                entryKey={note.id}
                removal={removal}
                notice={`Removed ${note.name}.`}
                held={note.id === "shipping" ? "Shipping stays." : undefined}
                describedBy="held-line"
                onRemove={() => setNotes(notes.filter((entry) => entry.id !== note.id))}
              />
            </ListItem>
          ),
        )}
      </ul>
      <p id="held-line">Shipping stays.</p>
      <RemovalNotice removal={removal} />
      <button type="button" onClick={() => setNotes(notes.filter((note) => note.id !== "returns"))}>
        Drop returns elsewhere
      </button>
      <ItemFormRow
        title={formTitle(form.editing, nameOf, "a note")}
        hint="A note is named once and read by everyone."
        editing={form.editing !== null}
        addLabel="Add note"
        refusal={refusal}
        reasonId={reasonId}
        onSubmit={submit}
        onCancel={() => {
          const editing = form.editing;
          form.reset();
          if (editing !== null) {
            focusAfterCommit(() => editButtons.get(editing));
          }
        }}
      >
        <FieldHint label="Name">
          <input
            ref={nameInput}
            className={`${fieldControlClasses} w-full`}
            value={form.fields.name}
            {...refusedProps(marked, "name", reasonId)}
            onChange={(event) => form.update({ name: event.target.value })}
          />
        </FieldHint>
        <FieldHint label="Body">
          <input
            className={`${fieldControlClasses} w-full`}
            value={form.fields.body}
            {...refusedProps(marked, "body", reasonId)}
            onChange={(event) => form.update({ body: event.target.value })}
          />
        </FieldHint>
      </ItemFormRow>
    </>
  );
}

/** A register that records what the form declares, as the workspace's guard would read it. */
function withRegister(children: ReactNode) {
  const items = { current: [] as RegisteredWork[] };
  const register = {
    items,
    register: (work: RegisteredWork) => {
      items.current = [...items.current, work];
      return () => {
        items.current = items.current.filter((entry) => entry !== work);
      };
    },
  };
  return {
    ui: <UnsavedWorkContext.Provider value={register}>{children}</UnsavedWorkContext.Provider>,
    declared: () => items.current.map((work) => work.read()),
  };
}

function item(name: string): HTMLElement {
  return screen.getByText(name, { selector: "span" }).closest("li") as HTMLElement;
}

describe("the list item", () => {
  it("reads the name, the key in monospace and one detail line", () => {
    render(<Harness />);

    const returns = item("Returns");
    expect(within(returns).getByText("returns", { selector: "code" })).toBeVisible();
    expect(within(returns).getByText("Thirty days.")).toBeVisible();
  });

  it("names its pencil and its trash by the entry", () => {
    render(<Harness />);

    const returns = within(item("Returns"));
    const edit = returns.getByRole("button", { name: "Edit Returns" });
    const remove = returns.getByRole("button", { name: "Remove Returns" });
    expect(edit).toHaveAttribute("title", "Edit Returns");
    expect(remove).toHaveAttribute("title", "Remove Returns");
    expect(remove).toBeEnabled();
  });

  it("holds a trash natively, titled and described by the reason", () => {
    render(<Harness />);

    const remove = within(item("Shipping")).getByRole("button", { name: "Remove Shipping" });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute("title", "Shipping stays.");
    expect(remove).toHaveAccessibleDescription("Shipping stays.");
  });

  it("is aria-current only while the form holds it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(item("Returns")).not.toHaveAttribute("aria-current");

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    expect(item("Returns")).toHaveAttribute("aria-current", "true");
    expect(item("Shipping")).not.toHaveAttribute("aria-current");

    await user.click(screen.getByRole("button", { name: "Edit Shipping" }));
    expect(item("Returns")).not.toHaveAttribute("aria-current");
    expect(item("Shipping")).toHaveAttribute("aria-current", "true");
  });

  it("asks twice before it goes, the confirm in its place", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Remove Returns" }));
    const confirm = screen.getByRole("group", { name: "Remove Returns?" });
    expect(confirm.closest("li")).not.toBeNull();
    expect(confirm).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Remove it" }));
    expect(screen.queryByText("Thirty days.")).toBeNull();
    expect(screen.getByText("Removed Returns.")).toHaveFocus();
  });
});

describe("what an item carries beyond its name, key and line", () => {
  function Single({ label }: { label?: string }) {
    const removal = useRemoval("single");
    return (
      <ul>
        <ListItem name="Home" id="home" detail={null} tag={<span>Default</span>} editing={false}>
          <RemoveButton
            name="Home"
            label={label}
            entryKey="home"
            removal={removal}
            notice="Removed Home."
            onRemove={() => undefined}
          />
        </ListItem>
      </ul>
    );
  }

  it("stands a tag beside the name, ahead of the key, and draws no detail line for none", () => {
    render(<Single />);

    const home = item("Home");
    const name = within(home).getByText("Home", { selector: "span" });
    const tag = within(home).getByText("Default");
    const key = within(home).getByText("home", { selector: "code" });
    expect(name.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tag.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tag.parentElement).toBe(name.parentElement);
    // The name's line is the item's only line.
    expect(name.parentElement?.parentElement?.children).toHaveLength(1);
  });

  it("keeps a detail's line breaks only where the list asks", () => {
    render(
      <ul>
        <ListItem name="Plain" id="plain" detail={"One.\nTwo."} editing={false}>
          {null}
        </ListItem>
        <ListItem name="Kept" id="kept" detail={"One.\nTwo."} multiline editing={false}>
          {null}
        </ListItem>
      </ul>,
    );

    const [plain, kept] = screen.getAllByText(/One\./);
    expect(plain).not.toHaveClass("whitespace-pre-line");
    expect(kept).toHaveClass("whitespace-pre-line");
  });

  it("names a trash by the list's own words where it gives them", () => {
    render(<Single label="Remove the home entry" />);

    const remove = within(item("Home")).getByRole("button", { name: "Remove the home entry" });
    expect(remove).toHaveAttribute("title", "Remove the home entry");
    expect(within(item("Home")).queryByRole("button", { name: "Remove Home" })).toBeNull();
  });
});

describe("the form row", () => {
  it("is a group named Add a … with its hint, whose submit adds", () => {
    render(<Harness />);

    const form = screen.getByRole("group", { name: "Add a note" });
    expect(form).toHaveAccessibleDescription(/A note is named once and read by everyone\./);
    expect(within(form).getByRole("button", { name: "Add note" })).toBeVisible();
    expect(within(form).queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(within(form).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("is named Edit {name} while editing, with Save changes and Cancel, focus on its first field", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));

    const form = screen.getByRole("group", { name: "Edit Returns" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Returns");
    expect(within(form).getByLabelText("Name")).toHaveFocus();
    expect(within(form).getByRole("button", { name: "Save changes" })).toBeVisible();
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(within(form).queryByRole("button", { name: "Add note" })).toBeNull();
  });

  it("saves where the entry stands and cancels to nothing, both handing focus back to the Edit", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    await user.type(screen.getByLabelText("Name"), " policy");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      expect.stringContaining("Returns policy"),
      expect.stringContaining("Shipping"),
    ]);
    expect(screen.getByRole("button", { name: "Edit Returns policy" })).toHaveFocus();
    expect(screen.getByRole("group", { name: "Add a note" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Edit Shipping" }));
    await user.type(screen.getByLabelText("Name"), " never");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Shipping", { selector: "span" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit Shipping" })).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("says the first rule broken in one line after the buttons, the blank form marking nothing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const add = screen.getByRole("button", { name: "Add note" });
    const name = screen.getByLabelText("Name");
    const body = screen.getByLabelText("Body");

    expectRefused(add, NAME_RULE);
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(body).not.toHaveAttribute("aria-invalid");
    // One line, in the polite region after the button.
    const region = add.nextElementSibling as HTMLElement;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent(NAME_RULE);

    await user.type(body, "Read me.");
    expectRefused(add, NAME_RULE);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(wholeDescription(NAME_RULE));
    expect(body).not.toHaveAttribute("aria-invalid");

    await user.clear(body);
    await user.type(name, "FAQ");
    expectRefused(add, BODY_RULE);
    expect(body).toHaveAttribute("aria-invalid", "true");
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(screen.getAllByText(BODY_RULE)).toHaveLength(1);

    await user.click(add);
    await submitWithoutPressing(add);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    await user.type(body, "Read me.");
    expectNotRefused(add);
    expect(region).toBeEmptyDOMElement();
    await user.click(add);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the form's state", () => {
  it("empties the form when the entry it edits leaves the list", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    await user.type(screen.getByLabelText("Name"), " typed");
    await user.click(screen.getByRole("button", { name: "Drop returns elsewhere" }));

    const form = screen.getByRole("group", { name: "Add a note" });
    expect(within(form).getByLabelText("Name")).toHaveValue("");
    expect(within(form).queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("is unsaved work while it holds something it was not filled with, in the list's words", async () => {
    const user = userEvent.setup();
    const { ui, declared } = withRegister(<Harness />);
    render(ui);
    expect(declared()).toEqual([]);

    await user.type(screen.getByLabelText("Body"), "Read me.");
    expect(declared().map((work) => work.label)).toEqual([
      "The Notes form holds a note that has not been added to the draft.",
    ]);
    await user.type(screen.getByLabelText("Name"), "FAQ");
    expect(declared().map((work) => work.label)).toEqual([
      "The Notes form holds “FAQ”, which has not been added to the draft.",
    ]);
    const [work] = declared();
    expect(work.save).toBeUndefined();
    expect(work.unsavable).toBe(itemFormReason("a note", "draft"));

    // Loaded and unchanged is not unsaved; changed, it is an edit.
    await user.click(screen.getByRole("button", { name: "Edit Shipping" }));
    expect(declared()).toEqual([]);
    await user.type(screen.getByLabelText("Body"), " Or three.");
    expect(declared().map((entry) => entry.label)).toEqual([
      "The Notes form holds an edit to Shipping that has not reached the draft.",
    ]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(declared()).toEqual([]);
  });

  it("words the prompt's reason from the list's noun, Shop details' word for word", () => {
    expect(METHOD_FORM_REASON).toBe(
      "A method typed in its form cannot be saved from here: nothing in the form has reached the draft yet. Stay, then press the form's Add or Save changes, or Cancel an edit.",
    );
    expect(itemFormReason("an event", "order")).toBe(
      "An event typed in its form cannot be saved from here: nothing in the form has reached the order yet. Stay, then press the form's Add or Save changes, or Cancel an edit.",
    );
  });
});
