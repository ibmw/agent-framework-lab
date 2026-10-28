import type { ExperimentNoteSchema } from "@agent-lab/contracts";
import { type FormEvent, useId, useState } from "react";
import { describeApiError } from "../api/client";
import { addExperimentNote } from "../api/experiments";
import type { Annotate } from "../lib/annotate";
import { NOTE_MAX_LENGTH } from "../lib/fieldRules";
import { pythonStrip } from "../lib/pythonText";
import { useRefusalTouch } from "../lib/refusalTouch";
import {
  formatTimestamp,
  sheetFootLineClasses,
  sheetNoteBodyClasses,
  sheetNoteFormClasses,
  sheetNoteItemClasses,
  sheetNoteLabelClasses,
  sheetNoteListClasses,
  sheetNotesBodyClasses,
  sheetNotesColumnClasses,
  sheetNoteTimeClasses,
  textAreaClasses,
} from "../lib/ui";
import { SheetCard } from "./ArmSheet";
import { ButtonIcon } from "./ButtonIcon";
import { PrimaryAction, RefusalLine } from "./PrimaryAction";

/** Why *Add note* is refused: an empty note says nothing about the run. */
const NOTE_EMPTY = "Write the note before adding it.";

/**
 * *Notes*, the sheet's last section (ADR 0080; sheet mockup :226–238): the composer first, then
 * each note's body over its time.
 *
 * What a reviewer concluded, beside what the run did, and not evidence. A note is appended and
 * never edited, because it is what a reviewer thought when they read this run (ADR 0036). The
 * write answers with everything written on the run, which replaces what is on screen; this
 * section never merges a response into a list of its own. The tags the run is filed under are
 * the header's (`RunTags`), and one write at a time goes for either (`annotating`).
 */
export function NotesSection({
  shopId,
  experimentId,
  notes,
  annotate,
  annotating,
}: {
  shopId: string;
  experimentId: string;
  notes: ExperimentNoteSchema[];
  annotate: Annotate;
  /** A note or a tag write is in flight. */
  annotating: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const reasonId = useId();
  const empty = pythonStrip(note) === "";
  // The refusal is a hint until the operator types or presses Add note, and again once an add has
  // emptied the box (ADR 0078).
  const touch = useRefusalTouch();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // The button refuses an empty note itself (ADR 0063), and holds while a write is in flight
    // (ADR 0065); a submission that arrives some other way is refused here too, rather than sent
    // for the lab to refuse or sent twice.
    if (empty || annotating) {
      return;
    }
    setError(null);
    try {
      // The box empties only because the write was accepted, so nothing typed is ever lost.
      if (
        await annotate(() => addExperimentNote(shopId, experimentId, { body: pythonStrip(note) }))
      ) {
        setNote("");
        touch.reset();
      }
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This note could not be saved."));
    }
  };

  return (
    <SheetCard
      id="notes"
      title="Notes"
      note="What a reviewer concluded, stored beside the record rather than in it."
      tour="results-notes"
    >
      <div className={sheetNotesBodyClasses}>
        <div className={sheetNotesColumnClasses}>
          <form
            className={sheetNoteFormClasses}
            onSubmit={(event) => void submit(event)}
            {...touch.watch}
          >
            <label className={sheetNoteLabelClasses} htmlFor={fieldId}>
              Add a note
            </label>
            <textarea
              maxLength={NOTE_MAX_LENGTH}
              id={fieldId}
              className={`${textAreaClasses} w-full`}
              placeholder="What this run showed, in your own words…"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="grid justify-items-start gap-1.5">
              <PrimaryAction
                variant="outline"
                type="submit"
                refusal={empty ? { id: reasonId, reason: NOTE_EMPTY } : null}
                busy={annotating}
              >
                <ButtonIcon verb="create" />
                Add note
              </PrimaryAction>
              {empty ? (
                <RefusalLine id={reasonId} touched={touch.touched}>
                  {NOTE_EMPTY}
                </RefusalLine>
              ) : null}
              {/* Said beside the press that failed, with what was typed still in the box. */}
              {error ? (
                <p role="alert" className={sheetFootLineClasses.error}>
                  {error}
                </p>
              ) : null}
            </div>
          </form>

          {notes.length > 0 ? (
            <ol aria-label="Notes on this run" className={sheetNoteListClasses}>
              {notes.map((entry) => (
                <li key={entry.note_id} className={sheetNoteItemClasses}>
                  <p className={sheetNoteBodyClasses}>{entry.body}</p>
                  <p className={sheetNoteTimeClasses}>{formatTimestamp(entry.created_at)}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </SheetCard>
  );
}
