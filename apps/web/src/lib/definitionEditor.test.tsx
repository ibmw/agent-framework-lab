import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { LabApiError } from "../api/client";
import { EditorSaveActions } from "../components/WorkspaceChrome";
import { UnsavedChangesGuard } from "../shell/UnsavedChangesGuard";
import {
  type DefinitionClient,
  type DefinitionGuard,
  useDefinitionEditor,
} from "./definitionEditor";

interface Content {
  text: string;
}

const PREVIEW = {
  latest_published_version: null,
  next_version: 1,
  matches_latest_published: false,
};

/** What the lab holds, per draft, so a discard has something of its own to answer with. */
let stored: Record<string, Content>;
let refuseSave: string | null;
let refuseRead: string | null;
let reads: number;

/**
 * Reads the test can hold open, so a response can be made to land after one it was issued
 * before. Nothing else in the suite can express the race a discard across a change of id runs:
 * MSW and this client both answer in issue order until something holds one back.
 */
let held: { id: string; release: () => void }[] = [];
let holdReads = false;

function releaseRead(id: string) {
  const index = held.findIndex((read) => read.id === id);
  if (index === -1) {
    throw new Error(`no held read of ${id}`);
  }
  const [read] = held.splice(index, 1);
  read.release();
}

const CLIENT: DefinitionClient<Content, Content, typeof PREVIEW> = {
  getDraft: async (id) => {
    reads += 1;
    if (holdReads) {
      await new Promise<void>((resolve) => held.push({ id, release: resolve }));
    }
    if (refuseRead !== null) {
      throw new LabApiError(refuseRead, 503);
    }
    return { content: { ...(stored[id] ?? { text: "" }) } };
  },
  previewDraft: async () => PREVIEW,
  replaceDraft: async (id, payload) => {
    if (refuseSave !== null) {
      throw new LabApiError(refuseSave, 409);
    }
    stored[id] = { ...payload };
    return { content: { ...payload } };
  },
  publish: async () => ({ version: 1 }),
  toPayload: (content) => content,
  unavailable: "The test service is unavailable.",
};

function Editor({ guard }: { guard?: DefinitionGuard }) {
  const { draftId = "" } = useParams();
  const editor = useDefinitionEditor(draftId, CLIENT, guard);
  if (editor.content === null) {
    return <p>Loading…</p>;
  }
  return (
    <>
      <p>Editing {draftId}</p>
      <label>
        Text
        <input
          value={editor.content.text}
          onChange={(event) => editor.edit({ text: event.target.value })}
        />
      </label>
      <EditorSaveActions
        dirty={editor.dirty}
        saving={editor.saving}
        discarding={editor.discarding}
        onSave={() => void editor.save()}
        onDiscard={() => void editor.discard()}
      />
      {editor.error ? <p role="alert">{editor.error}</p> : null}
      <Link to="/elsewhere">Elsewhere</Link>
      <Link to="/sibling">Sibling</Link>
      <Link to="/editor/b">Other draft</Link>
    </>
  );
}

function renderEditor(guard?: DefinitionGuard) {
  const router = createMemoryRouter(
    [
      {
        element: <UnsavedChangesGuard />,
        children: [
          { path: "/editor/:draftId", element: <Editor guard={guard} /> },
          { path: "/elsewhere", element: <h1>Elsewhere</h1> },
          { path: "/sibling", element: <h1>Sibling</h1> },
        ],
      },
    ],
    { initialEntries: ["/editor/a"] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}

async function editTo(user: ReturnType<typeof userEvent.setup>, text: string) {
  const field = await screen.findByLabelText("Text");
  await user.clear(field);
  await user.type(field, text);
}

beforeEach(() => {
  stored = { a: { text: "one" }, b: { text: "bee" } };
  refuseSave = null;
  refuseRead = null;
  reads = 0;
  held = [];
  holdReads = false;
});

describe("the navigation guard", () => {
  it("lets a clean editor be left without a word", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByLabelText("Text");

    await user.click(screen.getByRole("link", { name: "Elsewhere" }));

    expect(await screen.findByRole("heading", { name: "Elsewhere" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before a navigation strands an edit, and Stay keeps both the page and the edit", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");

    await user.click(screen.getByRole("link", { name: "Elsewhere" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent("This draft has unsaved changes.");
    await user.click(screen.getByRole("button", { name: "Stay on this page" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Text")).toHaveValue("two");
    expect(stored.a.text).toBe("one");
  });

  it("saves and then leaves when the prompt is asked to save", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));

    await user.click(await screen.findByRole("button", { name: "Save and leave" }));

    expect(await screen.findByRole("heading", { name: "Elsewhere" })).toBeInTheDocument();
    expect(stored.a.text).toBe("two");
  });

  it("keeps the navigation pending and says why when the save is refused", async () => {
    const user = userEvent.setup();
    refuseSave = "That version has moved on.";
    renderEditor();
    await editTo(user, "two");
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));

    await user.click(await screen.findByRole("button", { name: "Save and leave" }));

    // Still on the editor, still asking, and the refusal is in the prompt rather than behind it.
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await waitFor(() => expect(prompt).toHaveTextContent("That version has moved on."));
    expect(screen.queryByRole("heading", { name: "Elsewhere" })).toBeNull();
    expect(screen.getByLabelText("Text")).toHaveValue("two");
  });

  it("discards by reading the draft back, and then leaves", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");
    const readsBefore = reads;
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));

    await user.click(await screen.findByRole("button", { name: "Discard and leave" }));

    expect(await screen.findByRole("heading", { name: "Elsewhere" })).toBeInTheDocument();
    await waitFor(() => expect(reads).toBe(readsBefore + 1));
    expect(stored.a.text).toBe("one");
  });

  it("stays quiet when the destination can still save the draft", async () => {
    const user = userEvent.setup();
    renderEditor({
      label: "The shop draft has unsaved changes.",
      reaches: (pathname) => pathname === "/sibling",
    });
    await editTo(user, "two");

    await user.click(screen.getByRole("link", { name: "Sibling" }));
    expect(await screen.findByRole("heading", { name: "Sibling" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never lets a discarded draft's re-read land on the draft opened after it", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");

    // Both reads are held, so the test chooses the order they answer in. Nothing else in the
    // suite can: the discard is fired and not awaited, and the editor that issued it is the
    // `/editor/:draftId` route's own component, which a sibling id reuses rather than remounts.
    holdReads = true;
    await user.click(screen.getByRole("link", { name: "Other draft" }));
    await user.click(await screen.findByRole("button", { name: "Discard and leave" }));
    await screen.findByText("Editing b");

    // B's load answers first, then A's re-read — which is now for a draft this editor left.
    releaseRead("b");
    expect(await screen.findByLabelText("Text")).toHaveValue("bee");
    releaseRead("a");

    // A's content never reaches B's editor, so the next Save cannot write it under B's id.
    await waitFor(() => expect(held).toHaveLength(0));
    expect(screen.getByLabelText("Text")).toHaveValue("bee");
    await user.type(screen.getByLabelText("Text"), "!");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(stored.b.text).toBe("bee!"));
    expect(stored.a.text).toBe("one");
  });

  it("keeps what was typed while a discard was still reading", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");

    holdReads = true;
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    // The operator changes their mind mid-read. The read is for a draft that has moved on.
    await user.type(screen.getByLabelText("Text"), "!");
    releaseRead("a");

    await waitFor(() => expect(held).toHaveLength(0));
    expect(screen.getByLabelText("Text")).toHaveValue("two!");
  });

  it("puts the flag back when the re-read is refused, so the edit is still savable", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");
    refuseRead = "The draft could not be read.";

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The draft could not be read.");
    // The edits are still on screen and still the only copy of themselves, so they are still
    // offered a Save and still guarded.
    expect(screen.getByLabelText("Text")).toHaveValue("two");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(screen.queryByText("All changes saved")).toBeNull();
    refuseRead = null;
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));
    expect(await screen.findByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  });

  it("can be asked to save a second time after the first was refused", async () => {
    const user = userEvent.setup();
    refuseSave = "That version has moved on.";
    renderEditor();
    await editTo(user, "two");
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));
    await user.click(await screen.findByRole("button", { name: "Save and leave" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toHaveTextContent(
        "That version has moved on.",
      ),
    );

    // Whatever refused it has passed. The prompt's Save works the second time and leaves.
    refuseSave = null;
    await user.click(screen.getByRole("button", { name: "Save and leave" }));

    expect(await screen.findByRole("heading", { name: "Elsewhere" })).toBeInTheDocument();
    expect(stored.a.text).toBe("two");
  });

  it("takes the focus, and answers Escape the way Stay does", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");

    await user.click(screen.getByRole("link", { name: "Elsewhere" }));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveFocus();

    // Tab reaches every choice and comes back round rather than escaping behind the prompt.
    await user.tab();
    expect(screen.getByRole("button", { name: "Stay on this page" })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save and leave" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Stay on this page" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Text")).toHaveValue("two");
  });

  it("asks the browser before a reload while there is an edit, and not before", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByLabelText("Text");

    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    await editTo(user, "two");
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).toBe(true);
  });
});

describe("discarding from the editor's own header", () => {
  it("returns the draft to what the lab holds, and reports itself saved again", async () => {
    const user = userEvent.setup();
    renderEditor();
    await editTo(user, "two");
    expect(screen.queryByText("All changes saved")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(screen.getByLabelText("Text")).toHaveValue("one"));
    expect(await screen.findByText("All changes saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
  });

  it("offers nothing to discard while the draft matches the lab", async () => {
    renderEditor();
    await screen.findByLabelText("Text");

    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });
});
