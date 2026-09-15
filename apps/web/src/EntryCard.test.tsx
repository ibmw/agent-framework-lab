import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useId, useState } from "react";
import { describe, expect, it } from "vitest";
import { EntryCard, EntryEditNotice, EntryId } from "./components/WorkspaceChrome";
import { useEntryEdit } from "./lib/entryEdit";

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

function Harness({
  initial = NOTES,
  onWrite,
}: {
  initial?: Note[];
  onWrite?: (notes: Note[]) => void;
}) {
  const [notes, setNotes] = useState(initial);
  const editor = useEntryEdit<{ title: string; body: string }>(notes.map((note) => note.id));
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
              onOpen: () => editor.begin(note.id, note.title, { ...note }),
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
              fields: editor.open ? (
                <>
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
