import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useId, useState } from "react";
import { describe, expect, it } from "vitest";
import { RefusalLine } from "./components/PrimaryAction";
import { EntryCard, EntryEditNotice, EntryId } from "./components/WorkspaceChrome";
import { useEntryEdit } from "./lib/entryEdit";
import { itemEditButtonClasses } from "./lib/ui";
import { expectNotRefused, expectRefused, submitWithoutPressing } from "./test/refused";

interface Note {
  id: string;
  title: string;
  body: string;
}

const NOTES: Note[] = [
  { id: "returns", title: "Returns", body: "Thirty days." },
  { id: "shipping", title: "Shipping", body: "Two days." },
];

/**
 * A list on the shape every adopting card uses: one builder, called by the add path and the
 * edit path alike, and one editor holding the card's single open row.
 */
function noteEntry(id: string, fields: { title: string; body: string }): Note {
  return { id, title: fields.title, body: fields.body };
}

const TITLE_REFUSAL = "A note needs a title.";

function Harness({
  initial = NOTES,
  saved = NOTES,
  onWrite,
}: {
  initial?: Note[];
  /** What a page's Discard puts back: the notes as the lab holds them. */
  saved?: Note[];
  onWrite?: (notes: Note[]) => void;
}) {
  const [notes, setNotes] = useState(initial);
  const editor = useEntryEdit(notes, {
    keyOf: (note) => note.id,
    labelOf: (note) => note.title,
    fieldsOf: (note) => ({ title: note.title, body: note.body }),
  });
  const notice = useId();

  function write(next: Note[]) {
    setNotes(next);
    onWrite?.(next);
  }

  return (
    <>
      {/* Replaces the list the way a refetch does: same editor instance, new entries. */}
      <button type="button" onClick={() => setNotes(notes.filter((note) => note.id !== "returns"))}>
        Refetch without Returns
      </button>
      {/* Replaces the list the way a page's Discard does: the draft re-read from the lab. */}
      <button type="button" onClick={() => setNotes(saved)}>
        Discard changes
      </button>
      <ul>
        {notes.map((note) => (
          <EntryCard
            key={note.id}
            title={note.title}
            chips={<EntryId value={note.id} />}
            edit={{
              label: note.title,
              open: editor.isOpen(note.id),
              blockedBy: editor.blocked(note.id) ? notice : undefined,
              onOpen: () => editor.begin(note.id),
              onSave: () => {
                if (editor.open) {
                  const fields = editor.open.fields;
                  write(
                    notes.map((entry) =>
                      entry.id === note.id ? noteEntry(note.id, fields) : entry,
                    ),
                  );
                }
                editor.close();
              },
              onCancel: () => editor.close(),
              saveRefusal:
                editor.isOpen(note.id) && editor.open?.fields.title === ""
                  ? { id: "title-refusal", reason: TITLE_REFUSAL }
                  : undefined,
              fields: editor.open ? (
                <>
                  {editor.open.fields.title === "" ? (
                    <RefusalLine id="title-refusal" touched>
                      {TITLE_REFUSAL}
                    </RefusalLine>
                  ) : null}
                  <label>
                    Title
                    <input
                      value={editor.open.fields.title}
                      onChange={(event) =>
                        editor.change({
                          ...(editor.open?.fields ?? { title: "", body: "" }),
                          title: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Body
                    <input
                      value={editor.open.fields.body}
                      onChange={(event) =>
                        editor.change({
                          ...(editor.open?.fields ?? { title: "", body: "" }),
                          body: event.target.value,
                        })
                      }
                    />
                  </label>
                </>
              ) : null,
            }}
            actions={<button type="button">Remove {note.title}</button>}
          >
            <p>{note.body}</p>
          </EntryCard>
        ))}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
    </>
  );
}

describe("EntryCard edit mode", () => {
  it("refuses Save with its reason, reachable, and saves nothing by a press or by Enter", async () => {
    const user = userEvent.setup();
    const writes: Note[][] = [];
    render(<Harness onWrite={(notes) => writes.push(notes)} />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    await user.clear(screen.getByLabelText("Title"));

    const save = screen.getByRole("button", { name: "Save Returns" });
    expectRefused(save, TITLE_REFUSAL);
    await user.click(save);
    save.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    // Enter in a field of the row's form is implicit submission, which clicks this Save.
    await user.type(screen.getByLabelText("Body"), "{Enter}");
    // And a submission without the press is refused by the row's own form handler.
    await submitWithoutPressing(save);
    expect(writes).toEqual([]);
    expect(screen.getByLabelText("Title")).toHaveValue("");

    await user.type(screen.getByLabelText("Title"), "Returns");
    expectNotRefused(save);
  });

  it("opens the row's fields in place, with the identifier still on the header", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Closed, the row is read back rather than typed into.
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.getByText("Thirty days.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));

    expect(screen.getByLabelText("Title")).toHaveValue("Returns");
    expect(screen.getByLabelText("Body")).toHaveValue("Thirty days.");
    // The identifier is displayed, never asked for: it keys the change summary, so an edit
    // hands back the one the entry already had.
    expect(screen.getByText("returns", { selector: "code" })).toBeVisible();
    expect(screen.queryByLabelText("ID")).toBeNull();
    // The read-only body is gone while the fields hold it, and so is the row's Remove.
    expect(screen.queryByText("Thirty days.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Returns" })).toBeNull();
  });

  it("writes the edited fields back under the entry's own id when Save is pressed", async () => {
    const user = userEvent.setup();
    const written: Note[][] = [];
    render(<Harness onWrite={(notes) => written.push(notes)} />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    await user.clear(screen.getByLabelText("Body"));
    await user.type(screen.getByLabelText("Body"), "Sixty days.");
    expect(written).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Save Returns" }));

    expect(written.at(-1)).toEqual([
      { id: "returns", title: "Returns", body: "Sixty days." },
      { id: "shipping", title: "Shipping", body: "Two days." },
    ]);
    // Saved, the row is read-only again and the list's order has not moved.
    expect(screen.queryByLabelText("Body")).toBeNull();
    expect(screen.getByText("Sixty days.")).toBeVisible();
  });

  it("restores the saved entry on Cancel, having written nothing on the way", async () => {
    const user = userEvent.setup();
    const written: Note[][] = [];
    render(<Harness onWrite={(notes) => written.push(notes)} />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    await user.clear(screen.getByLabelText("Body"));
    await user.type(screen.getByLabelText("Body"), "Not this.");
    await user.click(screen.getByRole("button", { name: "Cancel editing Returns" }));

    expect(written).toEqual([]);
    expect(screen.getByText("Thirty days.")).toBeVisible();

    // And the row opens on the saved entry again, not on what Cancel threw away.
    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    expect(screen.getByLabelText("Body")).toHaveValue("Thirty days.");
  });

  it("draws its Edit as the item's pencil, and the open row's Save and Cancel in words", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The row's action is an icon named by the row (ADR 0075)...
    const edit = screen.getByRole("button", { name: "Edit Returns" });
    expect(edit).toHaveTextContent(/^$/);
    expect(edit.className).toBe(itemEditButtonClasses);

    // ...and the open row's answer keeps its words: it is the row's form, not an action on it.
    await user.click(edit);
    expect(screen.getByRole("button", { name: "Save Returns" })).toHaveTextContent("Save");
    expect(screen.getByRole("button", { name: "Cancel editing Returns" })).toHaveTextContent(
      "Cancel",
    );
  });

  it("holds one open row per list, and says why the others cannot be opened", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));

    const other = screen.getByRole("button", { name: "Edit Shipping" });
    expect(other).toBeDisabled();
    expect(other).toHaveAccessibleDescription(/Save or Cancel before opening another row/);
    expect(
      screen.getByText(/Editing Returns\. Save or Cancel before opening another row/),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel editing Returns" }));
    expect(screen.getByRole("button", { name: "Edit Shipping" })).toBeEnabled();
  });

  it("closes an open row whose entry the list no longer holds", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    expect(screen.getByLabelText("Body")).toHaveValue("Thirty days.");

    // PLAN-UX Slice 8 adds a Discard that refetches the draft, and a refetch can drop the
    // entry being edited. A row left open against it would render stale fields and disable
    // every sibling's Edit behind a notice naming an entry that is gone.
    await user.click(screen.getByRole("button", { name: "Refetch without Returns" }));

    expect(screen.queryByLabelText("Body")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Shipping" })).toBeEnabled();
    expect(screen.queryByText(/Save or Cancel before opening another row/)).toBeNull();
  });

  it("moves an untouched open row onto the entry a page's Discard puts back", async () => {
    const user = userEvent.setup();
    const written: Note[][] = [];
    const edited = [{ ...NOTES[0], body: "Sixty days." }, NOTES[1]];
    render(<Harness initial={edited} onWrite={(notes) => written.push(notes)} />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    expect(screen.getByLabelText("Body")).toHaveValue("Sixty days.");

    // The page's Discard re-reads the draft: the lab holds thirty days, not the sixty the
    // discarded draft said. The row holds nothing of the operator's, so it shows the entry.
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByLabelText("Body")).toHaveValue("Thirty days.");
    // And its Save writes what the draft now says rather than the discarded sixty days.
    await user.click(screen.getByRole("button", { name: "Save Returns" }));
    expect(written.at(-1)).toEqual(NOTES);
  });

  it("keeps the fields typed in through a page's Discard, and moves the rest", async () => {
    const user = userEvent.setup();
    const written: Note[][] = [];
    const edited = [{ ...NOTES[0], body: "Sixty days." }, NOTES[1]];
    render(<Harness initial={edited} onWrite={(notes) => written.push(notes)} />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Refunds");

    // The page's Discard undoes what the page's Save would have written, and that has never
    // carried an open row (ADR 0051): the typed title is the operator's and stays. The body was
    // never typed in, so it is the draft's, and it follows the draft back to thirty days.
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByLabelText("Title")).toHaveValue("Refunds");
    expect(screen.getByLabelText("Body")).toHaveValue("Thirty days.");
    // So the row's Save writes the typing and nothing the discard threw away.
    await user.click(screen.getByRole("button", { name: "Save Returns" }));
    expect(written.at(-1)).toEqual([{ ...NOTES[0], title: "Refunds" }, NOTES[1]]);
  });

  it("counts a field typed back to where it started as untouched", async () => {
    const user = userEvent.setup();
    const edited = [{ ...NOTES[0], body: "Sixty days." }, NOTES[1]];
    render(<Harness initial={edited} />);

    await user.click(screen.getByRole("button", { name: "Edit Returns" }));
    await user.clear(screen.getByLabelText("Body"));
    await user.type(screen.getByLabelText("Body"), "Ninety days.");
    await user.clear(screen.getByLabelText("Body"));
    await user.type(screen.getByLabelText("Body"), "Sixty days.");

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    // Nothing of the operator's is left in it, so it is the draft's to move.
    expect(screen.getByLabelText("Body")).toHaveValue("Thirty days.");
  });

  it("saves the row when Enter is pressed in one of its fields", async () => {
    const user = userEvent.setup();
    const written: Note[][] = [];
    render(<Harness onWrite={(notes) => written.push(notes)} />);

    await user.click(screen.getByRole("button", { name: "Edit Shipping" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Shipping and delivery{Enter}");

    expect(written.at(-1)?.[1]).toEqual({
      id: "shipping",
      title: "Shipping and delivery",
      body: "Two days.",
    });
  });
});

/**
 * A row that cannot be edited yet — a create page's parameter, a new scenario's composed block
 * (PLAN-UX Slice 33) — is still the same row: the header line, the lead, the chips and its
 * actions, and no Edit.
 */
describe("EntryCard without edit mode", () => {
  it("draws the row's lead, title and actions, and offers no Edit", () => {
    render(
      <ul>
        <EntryCard
          lead={<span>1</span>}
          title="Read document"
          chips={<EntryId value="read-required-document v1" />}
          actions={<button type="button">Remove read-required-document</button>}
        >
          <p>1 binding to this shop's objects, made in the editor</p>
        </EntryCard>
      </ul>,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Read document" })).toBeVisible();
    expect(screen.getByText("1")).toBeVisible();
    expect(screen.getByText("read-required-document v1", { selector: "code" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove read-required-document" })).toBeVisible();
    expect(screen.getByText(/1 binding to this shop's objects/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });
});
